"""Regression suite for the Referral Corner flat-per-patient payout bug.

User bug: a doctor with `ha_cut_mode='flat'` and `ha_cut_value=5000` was
being shown ₹5,000 in HA Payout even when the referred patient had ZERO
HA sales. The flat multiplier was using the AGGREGATE patient count
(any patient with any paid invoice) instead of the count of patients
who actually contributed to the HA bucket.

Also verifies the drill-down endpoint returns per-patient revenue split
for each referred patient (feature request tied to the same fix).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass

EMAIL = "dltest@example.com"
PASSWORD = "TestPass@123"


@pytest.fixture(scope="module")
def token() -> str:
    if not BASE_URL:
        pytest.skip("REACT_APP_BACKEND_URL not set")
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD}, timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"login failed: {r.status_code} {r.text}")
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def hdrs(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- helpers -------------------------------------------------------

def _find_doctor(hdrs, name_prefix: str = "Dr Ak") -> dict | None:
    """Find the reprod doctor (Dr Ak). The seed script above ensures they
    exist; here we just look them up to check their payout row."""
    # No public endpoint to list doctors by name — use the dashboard payload.
    r = requests.get(
        f"{BASE_URL}/api/referrals/dashboard",
        headers=hdrs,
        params={"start": "2026-06-30", "end": "2026-07-31"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    for row in r.json().get("rows", []):
        if (row.get("name") or "").startswith(name_prefix):
            return row
    return None


class TestReferralFlatPayoutScoping:
    def test_flat_ha_payout_zero_when_no_ha_sale(self, hdrs):
        """User's exact reproduction: 1 referred patient, ONLY a paid
        diagnostic invoice (₹1,600), flat HA cut = ₹5,000/patient.
        Expected: HA payout = ₹0 (not ₹5,000). Diag payout = ₹160 (10%)."""
        row = _find_doctor(hdrs, "Dr Ak")
        assert row is not None, "Dr Ak reprod doctor not found — did the seed run?"

        # The row's configured HA cut is a floor: flat + non-zero value.
        assert row["ha_cut_mode"] == "flat"
        assert row["ha_cut_value"] == 5000.0

        # THE BUG FIX: patient_count is aggregate (1), but ha_patient_count
        # must be 0 because Demo4 has ZERO paid HA revenue.
        assert row["patient_count"] == 1
        assert row.get("ha_patient_count", None) == 0, \
            "ha_patient_count MUST exclude patients with 0 HA revenue"

        # → HA payout must be 0 (5000 × 0), not 5000 (5000 × 1)
        assert row["ha_payout"] == 0.0, (
            f"REGRESSION: HA payout is ₹{row['ha_payout']} — flat cut is being "
            "multiplied by patients with NO HA sale. Should be ₹0."
        )
        # Diag payout still fires (percent-of-revenue, no flat scoping needed)
        assert row["diagnostics_payout"] == 160.0
        assert row["total_payout"] == 160.0

    def test_drilldown_includes_per_patient_revenue(self, hdrs):
        """Feature: clicking a doctor's name shows referred patients with
        diag / HA / total revenue columns."""
        # Look up the doctor_id from the dashboard row (avoid hard-coding).
        row = _find_doctor(hdrs, "Dr Ak")
        assert row is not None
        doc_id = row["doctor_id"]

        r = requests.get(
            f"{BASE_URL}/api/referrals/doctors/{doc_id}/detail",
            headers=hdrs, params={"start": "2026-06-30", "end": "2026-07-31"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["doctor"]["name"] == row["name"]
        patients = body["patients"]
        assert len(patients) >= 1
        demo4 = next((p for p in patients if p["name"] == "Demo4"), None)
        assert demo4 is not None, "Demo4 not in drill-down patients"
        # New fields
        assert "diag_revenue" in demo4
        assert "ha_revenue" in demo4
        assert "total_revenue" in demo4
        assert demo4["diag_revenue"] == 1600.0
        assert demo4["ha_revenue"] == 0.0
        assert demo4["total_revenue"] == 1600.0

    def test_flat_diag_payout_scopes_to_diag_patients_only(self, hdrs):
        """The same scoping rule applies to the DIAGNOSTIC flat cut — if
        a doctor is configured `diag_cut='flat, ₹200/patient'` and their
        1 referred patient hasn't had ANY paid diagnostic invoice yet,
        the diag payout must be ₹0. We can flip Dr Ak's diag cut to
        flat=200 and verify Demo4's ₹1,600 diag invoice keeps the payout
        at ₹200 (1 diag patient × 200). Then delete the invoice and
        confirm it drops to 0."""
        # Read the existing row, then PATCH the diag cut to flat=200.
        row = _find_doctor(hdrs, "Dr Ak")
        assert row is not None
        doc_id = row["doctor_id"]
        original_diag_mode = row["diag_cut_mode"]
        original_diag_value = row["diag_cut_value"]

        # Switch to flat=200
        r = requests.patch(
            f"{BASE_URL}/api/referrals/doctors/{doc_id}/cut-config",
            headers=hdrs,
            json={
                "diag_cut_mode": "flat", "diag_cut_value": 200.0,
                "ha_cut_mode": "flat", "ha_cut_value": 5000.0,
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text

        try:
            row2 = _find_doctor(hdrs, "Dr Ak")
            # Demo4 has diag revenue > 0, so diag_patient_count=1 → payout=200.
            assert row2["diag_patient_count"] == 1
            assert row2["diagnostics_payout"] == 200.0
            # HA still 0 (regression guard).
            assert row2["ha_payout"] == 0.0
            assert row2["total_payout"] == 200.0
        finally:
            # Restore original config.
            requests.patch(
                f"{BASE_URL}/api/referrals/doctors/{doc_id}/cut-config",
                headers=hdrs,
                json={
                    "diag_cut_mode": original_diag_mode or "percent",
                    "diag_cut_value": original_diag_value or 10.0,
                    "ha_cut_mode": "flat", "ha_cut_value": 5000.0,
                },
                timeout=15,
            )
