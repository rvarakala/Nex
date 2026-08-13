"""Regression: Billing invoice datetime response must carry timezone info
so IST browsers convert to local time correctly.

Aug 2026 — a beta clinic reported the invoice popup showed timestamps
5:30 hrs behind reality (`06:31 am` instead of `12:01 pm` IST). Root
cause: BSON stored naive `datetime` objects; the `_deserialize` helper
in `billing.py` only handled string inputs, so datetimes passed through
untouched and FastAPI's JSON encoder emitted them without a `Z` / `+00:00`
suffix. `new Date(iso_naive)` in JS then parsed them as browser-local
time, producing the offset.

Fix: `_deserialize` (billing.py) + `deserialize_datetime` (utils/serde.py)
now BOTH stamp naive datetime objects with `tzinfo=timezone.utc`.
"""
import os
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://referral-payout-lab.preview.emergentagent.com",
).rstrip("/")
EMAIL = "owner@thesoundclinic.in"
PASSWORD = "demo123"


def _sess():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


def _has_tz(iso):
    """True if an ISO string carries a `Z` or `+HH:MM` / `-HH:MM` suffix."""
    if not isinstance(iso, str):
        return False
    return iso.endswith("Z") or ("+" in iso[10:]) or ("-" in iso[10:])


def test_billing_invoice_get_returns_tz_aware_timestamps():
    """`GET /billing/invoices/{id}` must return `created_at`, `invoice_date`,
    and each payment's `paid_at` with a `Z` or `+00:00` suffix so IST
    browsers convert to local time correctly."""
    s = _sess()
    r = s.get(f"{BASE_URL}/api/billing/invoices?limit=5", timeout=15)
    assert r.status_code == 200
    listing = r.json()
    listing = listing.get("items", listing) if isinstance(listing, dict) else listing
    assert listing, "seeded tenant must have at least one invoice"
    inv_id = listing[0]["invoice_id"]

    r = s.get(f"{BASE_URL}/api/billing/invoices/{inv_id}", timeout=15)
    assert r.status_code == 200
    inv = r.json()

    for field in ("created_at", "invoice_date"):
        val = inv.get(field)
        assert _has_tz(val), (
            f"{field} = {val!r} — missing timezone suffix. "
            f"IST browsers will render this 5:30 hrs behind reality."
        )
    for i, p in enumerate(inv.get("payments") or []):
        val = p.get("paid_at")
        assert _has_tz(val), (
            f"payments[{i}].paid_at = {val!r} — missing timezone suffix."
        )


def test_billing_invoice_listing_returns_tz_aware_timestamps():
    """The list endpoint uses the same deserializer — enforce the same
    contract so the Invoices List page renders correct local times."""
    s = _sess()
    r = s.get(f"{BASE_URL}/api/billing/invoices?limit=10", timeout=15)
    assert r.status_code == 200
    listing = r.json()
    listing = listing.get("items", listing) if isinstance(listing, dict) else listing
    for inv in listing:
        for field in ("created_at", "invoice_date"):
            if inv.get(field) is None:
                continue
            assert _has_tz(inv[field]), (
                f"invoice {inv.get('invoice_no')}: {field} = {inv[field]!r} lacks tz suffix"
            )
