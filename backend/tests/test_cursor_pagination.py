"""P2 — cursor pagination on big lists (patients / invoices / ha_sales).

Goal: every page is a constant-time index seek; legacy callers that don't
pass `?cursor=` keep getting the array response unchanged.
"""
import pytest
import requests
import uuid

from _helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD, login, H


@pytest.fixture(scope="module")
def admin_token():
    return login(ADMIN_EMAIL, ADMIN_PASSWORD)


def _create_n_patients(token, n: int = 5):
    """Bootstrap a few patients so the suite has a stable working set."""
    created = []
    for i in range(n):
        payload = {
            "name": f"Cursor Test Patient {uuid.uuid4().hex[:6]}",
            "mobile": f"99{i:08d}"[:10],
            "age": 30 + i,
            "gender": "M",
        }
        r = requests.post(f"{API}/patients", json=payload, headers=H(token))
        # 200 OK or 409 dedup — we tolerate dedup
        if r.status_code == 200:
            created.append(r.json())
    return created


def test_patients_legacy_array_mode_unchanged(admin_token):
    """Without `?cursor=`, response is a bare array (no breakage)."""
    r = requests.get(f"{API}/patients?limit=5", headers=H(admin_token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list), f"expected bare array, got {type(body)}"


def test_patients_cursor_mode_returns_envelope(admin_token):
    _create_n_patients(admin_token, 4)
    r = requests.get(f"{API}/patients?cursor=&limit=2", headers=H(admin_token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict), "expected envelope shape"
    assert "items" in body and "next_cursor" in body and "has_more" in body
    assert isinstance(body["items"], list)


def test_patients_cursor_pagination_walks_to_end(admin_token):
    _create_n_patients(admin_token, 6)
    seen_ids: set[str] = set()
    cursor = ""
    pages = 0
    while True:
        r = requests.get(
            f"{API}/patients?cursor={cursor}&limit=3",
            headers=H(admin_token),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for p in body["items"]:
            seen_ids.add(p["patient_id"])
        pages += 1
        if not body["has_more"]:
            break
        cursor = body["next_cursor"]
        assert cursor, "has_more was True but next_cursor was empty"
        # Page-count guard scaled for prod tenants: at 3 patients per page,
        # 500 pages covers 1500 patients. Bumped from 50 → 500 on 2026-06-03
        # after rotating seed data made the platform tenant exceed 50 pages.
        assert pages < 500, "guard against infinite loop"
    # Last page must signal exhaustion
    assert not body["has_more"]
    assert body["next_cursor"] is None
    # We've seen at least the 6 we just created (others may exist).
    assert len(seen_ids) >= 6


def test_invoices_cursor_mode_works(admin_token):
    """First page → envelope shape; no cursor → array shape."""
    r1 = requests.get(f"{API}/billing/invoices?limit=5", headers=H(admin_token))
    assert r1.status_code == 200, r1.text
    assert isinstance(r1.json(), list)

    r2 = requests.get(f"{API}/billing/invoices?cursor=&limit=2", headers=H(admin_token))
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert isinstance(body, dict)
    assert "items" in body and "next_cursor" in body and "has_more" in body


def test_ha_sales_cursor_mode_works(admin_token):
    r1 = requests.get(f"{API}/ha/sales?limit=5", headers=H(admin_token))
    assert r1.status_code == 200, r1.text
    assert isinstance(r1.json(), list)

    r2 = requests.get(f"{API}/ha/sales?cursor=&limit=2", headers=H(admin_token))
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert isinstance(body, dict)
    assert "items" in body and "next_cursor" in body and "has_more" in body


def test_cursor_does_not_emit_duplicates(admin_token):
    """Walking pages must never serve the same patient_id twice."""
    _create_n_patients(admin_token, 5)
    seen: set[str] = set()
    cursor = ""
    for _ in range(30):  # generous loop guard
        r = requests.get(
            f"{API}/patients?cursor={cursor}&limit=2",
            headers=H(admin_token),
        )
        body = r.json()
        for p in body["items"]:
            pid = p["patient_id"]
            assert pid not in seen, f"duplicate page-walk hit: {pid}"
            seen.add(pid)
        if not body["has_more"]:
            break
        cursor = body["next_cursor"]
