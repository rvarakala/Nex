"""Backend tests for the Referral Corner — access control, dashboard,
cut config + CSV export.

These run against the deployed preview backend and exercise:
  GET    /api/referrals/access
  GET    /api/referrals/dashboard
  PATCH  /api/referrals/doctors/{doctor_id}/cut-config
  GET    /api/referrals/payout-report.csv
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

API = os.environ.get("API_URL") or os.environ.get(
    "REACT_APP_BACKEND_URL", "http://localhost:8001"
).rstrip("/") + "/api"

OWNER_EMAIL = "owner@thesoundclinic.in"
OWNER_PASSWORD = "demo123"


@pytest.fixture(scope="module")
def owner_headers():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_owner_has_access(owner_headers):
    r = requests.get(f"{API}/referrals/access", headers=owner_headers, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["has_access"] is True
    assert body["is_owner"] is True
    assert body["role"] == "clinic_owner"


def test_dashboard_returns_window_totals_and_rows(owner_headers):
    r = requests.get(
        f"{API}/referrals/dashboard",
        params={"start": "2025-01-01", "end": "2026-12-31"},
        headers=owner_headers,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "window" in body
    assert body["window"]["start"] == "2025-01-01"
    # The backend clamps end to "now" to prevent silent zero-result
    # queries from future-dated filters. So end may equal the requested
    # 2026-12-31 OR the current date — both are acceptable.
    assert body["window"]["end"] <= "2026-12-31"
    totals = body["totals"]
    for k in ("patient_count", "diagnostics_revenue", "ha_sales_revenue",
              "diagnostics_payout", "ha_payout", "total_payout"):
        assert k in totals
        assert totals[k] >= 0


def test_dashboard_rejects_inverted_window(owner_headers):
    r = requests.get(
        f"{API}/referrals/dashboard",
        params={"start": "2026-12-31", "end": "2025-01-01"},
        headers=owner_headers,
        timeout=10,
    )
    assert r.status_code == 400


def test_owner_can_update_cut_config(owner_headers):
    # Use the seeded demo doctor
    doctor_id = "DR-DEMO-IYER"
    r = requests.patch(
        f"{API}/referrals/doctors/{doctor_id}/cut-config",
        headers=owner_headers,
        json={
            "diag_cut_mode": "percent", "diag_cut_value": 12.5,
            "ha_cut_mode": "flat", "ha_cut_value": 1500,
        },
        timeout=10,
    )
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    # Verify it landed: dashboard should now reflect 12.5% on diag
    rd = requests.get(
        f"{API}/referrals/dashboard?start=2025-01-01&end=2026-12-31",
        headers=owner_headers, timeout=15,
    ).json()
    iyer = next((r for r in rd["rows"] if r["doctor_id"] == doctor_id), None)
    assert iyer is not None
    assert iyer["diag_cut_mode"] == "percent"
    assert iyer["diag_cut_value"] == 12.5
    assert iyer["ha_cut_mode"] == "flat"
    assert iyer["ha_cut_value"] == 1500

    # Restore the seed config so other tests stay stable
    requests.patch(
        f"{API}/referrals/doctors/{doctor_id}/cut-config",
        headers=owner_headers,
        json={
            "diag_cut_mode": "percent", "diag_cut_value": 10.0,
            "ha_cut_mode": "percent", "ha_cut_value": 5.0,
        },
        timeout=10,
    )


def test_cut_config_rejects_percent_over_100(owner_headers):
    r = requests.patch(
        f"{API}/referrals/doctors/DR-DEMO-IYER/cut-config",
        headers=owner_headers,
        json={"diag_cut_mode": "percent", "diag_cut_value": 150,
              "ha_cut_mode": None, "ha_cut_value": 0},
        timeout=10,
    )
    assert r.status_code == 400


def test_cut_config_clamps_negative_to_zero(owner_headers):
    """Negative values would create awkward 'doctor owes the clinic' rows.
    We clamp at 0 on the server."""
    r = requests.patch(
        f"{API}/referrals/doctors/DR-DEMO-IYER/cut-config",
        headers=owner_headers,
        json={"diag_cut_mode": "flat", "diag_cut_value": -500,
              "ha_cut_mode": None, "ha_cut_value": 0},
        timeout=10,
    )
    assert r.status_code == 200
    # Now confirm 0 was persisted
    rd = requests.get(
        f"{API}/referrals/dashboard?start=2025-01-01&end=2026-12-31",
        headers=owner_headers, timeout=15,
    ).json()
    iyer = next((r for r in rd["rows"] if r["doctor_id"] == "DR-DEMO-IYER"), None)
    assert iyer["diag_cut_value"] == 0.0

    # Restore seed
    requests.patch(
        f"{API}/referrals/doctors/DR-DEMO-IYER/cut-config",
        headers=owner_headers,
        json={"diag_cut_mode": "percent", "diag_cut_value": 10.0,
              "ha_cut_mode": "percent", "ha_cut_value": 5.0},
        timeout=10,
    )


def test_cut_config_404_for_unknown_doctor(owner_headers):
    r = requests.patch(
        f"{API}/referrals/doctors/DR-NONEXISTENT-9999/cut-config",
        headers=owner_headers,
        json={"diag_cut_mode": "percent", "diag_cut_value": 10,
              "ha_cut_mode": None, "ha_cut_value": 0},
        timeout=10,
    )
    assert r.status_code == 404


def test_csv_export_diagnostics(owner_headers):
    r = requests.get(
        f"{API}/referrals/payout-report.csv",
        params={"start": "2025-01-01", "end": "2026-12-31", "report_type": "diagnostics"},
        headers=owner_headers,
        timeout=20,
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    text = r.content.decode("utf-8")
    assert "AUDINEXA — Referral Payout Report (DIAGNOSTICS)" in text
    # The export filters to non-zero payouts, so Dr. Mehta (no cut) shouldn't appear
    assert "Mehta" not in text or "Dr. Mehta" not in text


def test_csv_export_combined(owner_headers):
    r = requests.get(
        f"{API}/referrals/payout-report.csv",
        params={"start": "2025-01-01", "end": "2026-12-31", "report_type": "both"},
        headers=owner_headers,
        timeout=20,
    )
    assert r.status_code == 200
    text = r.content.decode("utf-8")
    assert "BOTH" in text  # report type header
    assert "Total Payout" in text


# ─── Access delegation tests ──────────────────────────────────────────
def test_delegated_staff_gets_view_only_access(owner_headers):
    """Owner toggles `can_access_referrals=True` on a front-desk user;
    that user can now read the dashboard but still gets 403 when trying
    to change payout terms."""
    # Pick any non-owner active staff
    staff = requests.get(f"{API}/users", headers=owner_headers, timeout=10).json()
    target = next(
        (u for u in (staff or [])
         if u.get("role") not in ("clinic_owner", "super_admin") and u.get("active")),
        None,
    )
    if not target:
        pytest.skip("No non-owner staff in this tenant to test delegation")

    target_id = target["user_id"]
    target_email = target["email"]

    # Capture original flag so we can restore at the end
    orig_flag = bool(target.get("can_access_referrals"))

    try:
        # 1) Grant access
        r = requests.put(
            f"{API}/settings/staff/{target_id}",
            headers=owner_headers,
            json={"can_access_referrals": True},
            timeout=10,
        )
        assert r.status_code == 200, r.text

        # 2) Login as the delegated user. The demo password is `demo123`
        #    for all seeded staff; if that differs, this test skips.
        login = requests.post(
            f"{API}/auth/login",
            json={"email": target_email, "password": "demo123"},
            timeout=10,
        )
        if login.status_code != 200:
            pytest.skip(f"Cannot log in as delegated user {target_email}")
        staff_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        # 3) /access reflects the grant
        acc = requests.get(f"{API}/referrals/access", headers=staff_headers, timeout=10).json()
        assert acc["has_access"] is True
        assert acc["is_owner"] is False

        # 4) Dashboard reads work
        dash = requests.get(
            f"{API}/referrals/dashboard?start=2025-01-01&end=2026-12-31",
            headers=staff_headers,
            timeout=10,
        )
        assert dash.status_code == 200

        # 5) But the WRITE endpoint refuses — delegated staff are view-only
        write = requests.patch(
            f"{API}/referrals/doctors/DR-DEMO-IYER/cut-config",
            headers=staff_headers,
            json={"diag_cut_mode": "percent", "diag_cut_value": 99,
                  "ha_cut_mode": None, "ha_cut_value": 0},
            timeout=10,
        )
        assert write.status_code == 403, write.text
    finally:
        # Always restore the original flag so other tests stay stable
        requests.put(
            f"{API}/settings/staff/{target_id}",
            headers=owner_headers,
            json={"can_access_referrals": orig_flag},
            timeout=10,
        )


def test_unauthorised_staff_gets_403_on_dashboard(owner_headers):
    """A staff member WITHOUT the grant cannot even read the dashboard."""
    # Find a non-owner, currently-not-delegated user
    users = requests.get(f"{API}/users", headers=owner_headers, timeout=10).json() or []
    target = next(
        (u for u in users
         if u.get("role") not in ("clinic_owner", "super_admin")
         and u.get("active")
         and not u.get("can_access_referrals")),
        None,
    )
    if not target:
        pytest.skip("Need at least one non-delegated staff member for this test")

    login = requests.post(
        f"{API}/auth/login",
        json={"email": target["email"], "password": "demo123"},
        timeout=10,
    )
    if login.status_code != 200:
        pytest.skip(f"Cannot log in as {target['email']}")
    h = {"Authorization": f"Bearer {login.json()['access_token']}"}

    acc = requests.get(f"{API}/referrals/access", headers=h, timeout=10).json()
    assert acc["has_access"] is False

    dash = requests.get(
        f"{API}/referrals/dashboard",
        headers=h,
        timeout=10,
    )
    assert dash.status_code == 403
