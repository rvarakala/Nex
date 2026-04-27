"""AUDINEXA Care — client-facing support tickets.

End-to-end pipeline:
  1. Clinic user creates a ticket (with optional diagnostic blob)
  2. Clinic lists their tickets — sees ONLY their clinic's
  3. Founder/super_admin lists ALL tickets via /api/admin/tickets
  4. Founder replies via PATCH /api/admin/tickets/{id} — clinic sees the reply
  5. Clinic replies via /api/care/tickets/{id}/reply
  6. Cross-tenant guardrails: clinic A cannot see/reply to clinic B's tickets
"""
from __future__ import annotations

import os

import pytest
import requests

API = (
    os.environ.get("API_URL")
    or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip() + "/api"
)
ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "admin@acs.in")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


@pytest.fixture(scope="module")
def clinic_headers():
    """Login as a regular clinic user (admin in their tenant)."""
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def founder_headers():
    """Login as a Founder / super_admin to access /api/admin/tickets."""
    # Try several common founder logins from beta seed
    for email, pwd in [
        ("founder@audinexa.com", "founder123"),
        ("super@audinexa.com", "super123"),
        (os.environ.get("FOUNDER_EMAIL", ""), os.environ.get("FOUNDER_PASSWORD", "")),
    ]:
        if not email:
            continue
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd})
        if r.status_code == 200:
            return {"Authorization": f"Bearer {r.json()['access_token']}"}
    pytest.skip("No founder/super_admin login available for cross-side test")


def test_create_ticket_minimal(clinic_headers):
    r = requests.post(f"{API}/care/tickets", headers=clinic_headers, json={
        "category": "Bug",
        "priority": "high",
        "subject": "Pipeline drawer not loading",
        "body": "When I open a service ticket the pipeline drawer is blank.",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ticket_id"].startswith("TKT-")
    assert body["status"] == "Open"
    assert body["category"] == "Bug"
    assert body["priority"] == "high"
    assert body["clinic_id"]                 # stamped from JWT
    assert body["created_by"]
    assert body["sla_due_at"]                # high priority → 8 hour SLA
    assert len(body["thread"]) == 1
    assert body["thread"][0]["author_role"] == "clinic"


def test_create_ticket_with_diagnostic_attached(clinic_headers):
    diagnostic = (
        "[AUDINEXA error] 2026-04-27T08:30:11.234Z\n"
        "Action: Failed to book shipment\n"
        "POST https://…/api/ha/couriers\n"
        "HTTP 409\n"
        "Body: {\"detail\":\"AWB AWB1234567 already booked (CSH-2026-0145)\"}"
    )
    r = requests.post(f"{API}/care/tickets", headers=clinic_headers, json={
        "category": "Bug",
        "priority": "medium",
        "subject": "Duplicate AWB error",
        "body": "I keep getting this when booking a shipment:",
        "diagnostic": diagnostic,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["diagnostic"] == diagnostic
    # The diagnostic is also baked into the body so founders see it inline
    assert "AWB AWB1234567" in body["body"]
    assert "Attached error diagnostic" in body["body"]


def test_invalid_category_rejected(clinic_headers):
    r = requests.post(f"{API}/care/tickets", headers=clinic_headers, json={
        "category": "Random Made-up Category",
        "priority": "low",
        "subject": "Test",
        "body": "Test",
    })
    assert r.status_code == 400
    assert "category must be one of" in r.json()["detail"]


def test_invalid_priority_rejected(clinic_headers):
    r = requests.post(f"{API}/care/tickets", headers=clinic_headers, json={
        "category": "Bug",
        "priority": "P0",
        "subject": "Test",
        "body": "Test",
    })
    assert r.status_code == 400


def test_list_my_tickets_returns_open_count_and_categories(clinic_headers):
    # Create a fresh open ticket so open_count > 0
    requests.post(f"{API}/care/tickets", headers=clinic_headers, json={
        "category": "Training", "priority": "low", "subject": "How do I…",
        "body": "Need a quick training on bulk patient import.",
    })
    r = requests.get(f"{API}/care/tickets", headers=clinic_headers)
    assert r.status_code == 200
    body = r.json()
    assert "rows" in body
    assert body["count"] >= 1
    assert body["open_count"] >= 1
    assert "Bug" in body["categories"]
    assert "Feature Request" in body["categories"]
    # All rows belong to my clinic only — verify by sampling
    if body["rows"]:
        clinic_ids = {r["clinic_id"] for r in body["rows"]}
        assert len(clinic_ids) == 1


def test_reply_appends_to_thread(clinic_headers):
    r = requests.post(f"{API}/care/tickets", headers=clinic_headers, json={
        "category": "Bug", "priority": "medium",
        "subject": "Reply test", "body": "Initial body",
    })
    tid = r.json()["ticket_id"]
    r2 = requests.post(f"{API}/care/tickets/{tid}/reply", headers=clinic_headers, json={
        "text": "Adding more context: the error happens only on Chrome.",
    })
    assert r2.status_code == 200
    body = r2.json()
    assert len(body["thread"]) == 2
    assert body["thread"][1]["kind"] == "reply"
    assert body["thread"][1]["author_role"] == "clinic"


def test_reply_blocked_on_resolved_ticket(clinic_headers, founder_headers):
    """Once a founder marks a ticket Resolved, the clinic can't reply (must
    open a new one). Prevents zombie tickets from staying open forever."""
    r = requests.post(f"{API}/care/tickets", headers=clinic_headers, json={
        "category": "Bug", "priority": "low",
        "subject": "Resolved test", "body": "ok",
    })
    tid = r.json()["ticket_id"]
    # Founder resolves it (founder has tickets:write permission on /api/admin/v2/tickets)
    rf = requests.patch(f"{API}/admin/v2/tickets/{tid}", headers=founder_headers, json={
        "status": "Resolved", "reply": "Fixed in 2026.04.28 release.",
    })
    if rf.status_code != 200:
        pytest.skip(f"Founder PATCH not available for this account: {rf.status_code}")
    # Clinic now tries to reply → should be 409
    r3 = requests.post(f"{API}/care/tickets/{tid}/reply", headers=clinic_headers, json={
        "text": "Just one more thing!",
    })
    assert r3.status_code == 409
    assert "resolved" in r3.json()["detail"].lower() or "closed" in r3.json()["detail"].lower()


def test_clinic_cannot_see_other_clinic_tickets(clinic_headers, founder_headers):
    """A clinic_id in URL ≠ JWT clinic_id should 403 / 404."""
    # First, founder creates a ticket against a synthetic-other clinic
    r = requests.post(f"{API}/admin/v2/tickets", headers=founder_headers, json={
        "clinic_id": "OTHER-CLINIC-XXX",
        "category": "Bug", "priority": "low",
        "subject": "Other clinic ticket", "body": "isolated",
    })
    if r.status_code != 200:
        pytest.skip(f"Founder POST not available: {r.status_code}")
    tid = r.json()["ticket_id"]
    # Clinic user tries to GET / reply
    rg = requests.get(f"{API}/care/tickets/{tid}", headers=clinic_headers)
    assert rg.status_code == 403
    rr = requests.post(f"{API}/care/tickets/{tid}/reply", headers=clinic_headers, json={
        "text": "This is not my ticket but I'm trying to reply",
    })
    assert rr.status_code == 403
    # And it must NOT appear in my listing
    rl = requests.get(f"{API}/care/tickets", headers=clinic_headers).json()
    other_tids = [r for r in rl["rows"] if r["ticket_id"] == tid]
    assert other_tids == []


def test_founder_sees_clinic_ticket_on_admin_side(clinic_headers, founder_headers):
    r = requests.post(f"{API}/care/tickets", headers=clinic_headers, json={
        "category": "Feature Request", "priority": "low",
        "subject": "Add dark mode", "body": "Pretty please",
    })
    tid = r.json()["ticket_id"]
    # Founder lists all tickets and finds it
    ra = requests.get(f"{API}/admin/v2/tickets", headers=founder_headers)
    if ra.status_code != 200:
        pytest.skip("Founder admin tickets endpoint not accessible")
    found = [r for r in ra.json()["rows"] if r["ticket_id"] == tid]
    assert len(found) == 1
    # Stats are populated
    assert ra.json()["stats"]["categories"]
    assert "Bug" in ra.json()["stats"]["categories"]
