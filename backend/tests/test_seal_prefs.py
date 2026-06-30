"""Tests for the seal-placement-preferences endpoints + their integration
with the audiogram-PDF + stock-transfer endpoints.

Endpoints under test:
  GET  /api/settings/me/seal-prefs
  PUT  /api/settings/me/seal-prefs
"""
from __future__ import annotations

import os

import pytest
import requests

API = os.environ.get("API_URL") or os.environ.get(
    "REACT_APP_BACKEND_URL", "http://localhost:8001"
).rstrip("/") + "/api"

TEST_EMAIL = "owner@thesoundclinic.in"
TEST_PASSWORD = "demo123"


@pytest.fixture(scope="module")
def headers():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(autouse=True)
def _reset_prefs(headers):
    """Reset to empty before each test so they're order-independent."""
    requests.put(
        f"{API}/settings/me/seal-prefs",
        headers=headers,
        json={"include_on": []},
        timeout=10,
    )
    yield


def test_get_initial_prefs_returns_valid_doc_types(headers):
    r = requests.get(f"{API}/settings/me/seal-prefs", headers=headers, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["include_on"] == []
    assert sorted(body["valid_doc_types"]) == ["audiogram", "challan", "invoice"]
    assert isinstance(body["has_seal"], bool)


def test_put_persists_and_get_returns_same(headers):
    r = requests.put(
        f"{API}/settings/me/seal-prefs",
        headers=headers,
        json={"include_on": ["audiogram", "invoice"]},
        timeout=10,
    )
    assert r.status_code == 200
    assert sorted(r.json()["include_on"]) == ["audiogram", "invoice"]

    r2 = requests.get(f"{API}/settings/me/seal-prefs", headers=headers, timeout=10)
    assert sorted(r2.json()["include_on"]) == ["audiogram", "invoice"]


def test_put_rejects_unknown_doc_type(headers):
    r = requests.put(
        f"{API}/settings/me/seal-prefs",
        headers=headers,
        json={"include_on": ["audiogram", "bogus"]},
        timeout=10,
    )
    assert r.status_code == 400
    assert "bogus" in r.text


def test_put_dedupes_and_normalises_case(headers):
    r = requests.put(
        f"{API}/settings/me/seal-prefs",
        headers=headers,
        json={"include_on": ["INVOICE", "invoice", "Invoice", "challan", ""]},
        timeout=10,
    )
    assert r.status_code == 200
    # Order preserved, but dedup'd to ["invoice","challan"]
    assert r.json()["include_on"] == ["invoice", "challan"]


def test_auth_me_exposes_seal_include_on(headers):
    requests.put(
        f"{API}/settings/me/seal-prefs",
        headers=headers,
        json={"include_on": ["challan"]},
        timeout=10,
    )
    me = requests.get(f"{API}/auth/me", headers=headers, timeout=10).json()
    me_user = me.get("user") or me
    assert me_user.get("seal_include_on") == ["challan"]


def test_empty_payload_clears_prefs(headers):
    # Set some prefs first
    requests.put(
        f"{API}/settings/me/seal-prefs",
        headers=headers,
        json={"include_on": ["audiogram", "invoice", "challan"]},
        timeout=10,
    )
    # Then clear
    r = requests.put(
        f"{API}/settings/me/seal-prefs",
        headers=headers,
        json={"include_on": []},
        timeout=10,
    )
    assert r.status_code == 200
    assert r.json()["include_on"] == []
