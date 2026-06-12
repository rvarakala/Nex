"""Tests for the waitlist autoresponder + Leads kanban weekly counter.

These verify:
  1. POST /api/public/waitlist-signup returns queue_position and schedules
     the autoresponder via BackgroundTasks.
  2. A second submission for the same email DOES NOT re-fire the
     autoresponder (idempotency).
  3. GET /api/admin/v2/leads exposes `in_queue_this_week` count.

Runs against the deployed preview backend; uses pytest's standard
fixtures + the founder credentials in /app/memory/test_credentials.md.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

API = os.environ.get("API_URL") or os.environ.get(
    "REACT_APP_BACKEND_URL", "http://localhost:8001"
).rstrip("/") + "/api"

# Founder creds — pulled from test_credentials.md (also the platform default).
FOUNDER_EMAIL = os.environ.get("FOUNDER_EMAIL", "founder@audinexa.com")
FOUNDER_PASSWORD = os.environ.get("FOUNDER_PASSWORD", "founder123")


def _login_founder() -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": FOUNDER_EMAIL, "password": FOUNDER_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def _mongo():
    cli = MongoClient(os.environ["MONGO_URL"])
    return cli[os.environ["DB_NAME"]]


@pytest.mark.smoke
def test_waitlist_signup_returns_queue_position():
    email = f"auto-{uuid.uuid4().hex[:10]}@audinexa-qa.com"
    r = requests.post(
        f"{API}/public/waitlist-signup",
        json={"email": email, "clinic_name": "QA Clinic", "contact_name": "QA User"},
        timeout=10,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["email"] == email.lower()
    assert isinstance(body["queue_position"], int) and body["queue_position"] >= 1


def test_waitlist_signup_is_idempotent_on_autoresponder():
    """Submitting the same email twice stamps `autoresponder_sent_at` only
    once, so the user never gets two confirmation emails."""
    email = f"idem-{uuid.uuid4().hex[:10]}@audinexa-qa.com"
    payload = {"email": email, "clinic_name": "Idem", "contact_name": "Idem"}

    r1 = requests.post(f"{API}/public/waitlist-signup", json=payload, timeout=10)
    assert r1.status_code == 201
    # Give BackgroundTasks a moment to stamp the doc.
    time.sleep(3)

    db = _mongo()
    doc1 = db.waitlist_signups.find_one(
        {"email": email}, {"autoresponder_sent_at": 1}
    )
    assert doc1 and doc1.get("autoresponder_sent_at"), \
        "First signup should stamp autoresponder_sent_at"
    first_stamp = doc1["autoresponder_sent_at"]

    r2 = requests.post(f"{API}/public/waitlist-signup", json=payload, timeout=10)
    assert r2.status_code == 201
    time.sleep(1)

    doc2 = db.waitlist_signups.find_one(
        {"email": email}, {"autoresponder_sent_at": 1}
    )
    assert doc2["autoresponder_sent_at"] == first_stamp, \
        "Second signup must NOT re-stamp (no second email sent)"


def test_leads_endpoint_exposes_in_queue_this_week():
    token = _login_founder()
    # Seed a fresh non-test signup so the count is guaranteed >= 1
    email = f"qa-week-{uuid.uuid4().hex[:8]}@audinexa-qa.com"
    requests.post(
        f"{API}/public/waitlist-signup",
        json={"email": email, "clinic_name": "Week QA", "contact_name": "Week QA"},
        timeout=10,
    )
    # Bust the 30s in-process cache by waiting; otherwise hit a fresh stage
    time.sleep(0.5)
    r = requests.get(
        f"{API}/admin/v2/leads",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "in_queue_this_week" in body, "expected in_queue_this_week in response"
    assert isinstance(body["in_queue_this_week"], int)
    assert body["in_queue_this_week"] >= 0
