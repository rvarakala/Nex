"""Regression: Inventory Board must show which patient bought each SOLD/RESERVED
serial hearing-aid unit (invoice_no + patient_name + payment_status).

Feb 2026 — user asked "for a SOLD or RESERVED unit, show me the invoice so I
can trace who it went to". Locks in `POST /api/ha/serial-items/invoice-lookup`
and the enriched `/timeline` response so a future refactor can't silently
break this trace.
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


def test_invoice_lookup_returns_data_for_sold_serials():
    """Bulk-lookup must return `invoice_no` + `patient_name` + payment info
    for every SOLD/RESERVED serial that has a Quick Sale or full HA Sale."""
    s = _sess()
    items = s.get(f"{BASE_URL}/api/ha/serial-items?limit=200", timeout=15).json()
    linkable = [r["serial_id"] for r in items if r.get("state") in ("SOLD", "RESERVED")]
    assert linkable, "seeded tenant must have at least one SOLD/RESERVED serial"

    r = s.post(f"{BASE_URL}/api/ha/serial-items/invoice-lookup",
               json={"serial_ids": linkable}, timeout=15)
    assert r.status_code == 200, r.text
    mp = r.json()
    assert isinstance(mp, dict)
    matched = [v for v in mp.values() if v]
    assert matched, "at least one seeded serial should link to a sale"
    # Sanity — every hit must carry patient_name + source
    for hit in matched:
        assert hit.get("source") in ("quick_sale", "ha_sale")
        assert hit.get("patient_name") is not None or hit.get("patient_id") is not None
        # Either invoice_no or sale_no must be present so the UI has something to render
        assert hit.get("invoice_no") or hit.get("sale_no")


def test_invoice_lookup_empty_body_returns_empty_map():
    """Guardrail: sending an empty list must not 500."""
    s = _sess()
    r = s.post(f"{BASE_URL}/api/ha/serial-items/invoice-lookup",
               json={"serial_ids": []}, timeout=15)
    assert r.status_code == 200
    assert r.json() == {}


def test_timeline_carries_invoice_for_sold_serial():
    """The Timeline drawer needs `invoice` on the top-level response so the
    UI can render the "who bought it" header without a second round-trip."""
    s = _sess()
    items = s.get(f"{BASE_URL}/api/ha/serial-items?state=SOLD&limit=50", timeout=15).json()
    # Grab one that has a real patient link (Quick-Sale-sync'd rows may not).
    lookup = s.post(f"{BASE_URL}/api/ha/serial-items/invoice-lookup",
                    json={"serial_ids": [r["serial_id"] for r in items]},
                    timeout=15).json()
    linked = next((sid for sid, v in lookup.items() if v and v.get("patient_name")), None)
    assert linked, "at least one SOLD serial should have a patient linked"

    r = s.get(f"{BASE_URL}/api/ha/serial-items/{linked}/timeline", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "invoice" in body, "timeline response must include an `invoice` key"
    assert body["invoice"] is not None
    assert body["invoice"].get("patient_name") or body["invoice"].get("patient_id")


def test_timeline_no_invoice_for_in_stock_serial():
    """IN_STOCK rows have no sale linked yet — `invoice` must be null, not
    a fabricated placeholder."""
    s = _sess()
    items = s.get(f"{BASE_URL}/api/ha/serial-items?state=IN_STOCK&limit=5", timeout=15).json()
    assert items, "tenant must have IN_STOCK serials"
    sid = items[0]["serial_id"]
    r = s.get(f"{BASE_URL}/api/ha/serial-items/{sid}/timeline", timeout=15)
    assert r.status_code == 200
    assert r.json().get("invoice") is None


def test_quick_sale_invoice_math_is_consistent():
    """Regression: Feb 2026 the Quick-Sale invoice writer was setting
    `subtotal = taxable` (post-discount) but also emitting `discount_total`
    separately — so the invoice popup showed
        Subtotal ₹1.65L − Discount ₹10k = Grand Total ₹1.65L
    which the audiologist correctly flagged as broken math. Fix: subtotal
    now writes qty × MRP (pre-discount) so the standard
        subtotal − discount + tax == grand_total
    identity holds. Sweeps every Quick-Sale-linked invoice on the tenant
    to make sure no drift has crept back in."""
    s = _sess()
    r = s.get(f"{BASE_URL}/api/billing/invoices?limit=200", timeout=20)
    assert r.status_code == 200, r.text
    invoices = r.json()
    invoices = invoices.get("items", invoices) if isinstance(invoices, dict) else invoices
    quick_sale_invs = [
        inv for inv in invoices
        if isinstance(inv, dict)
        and inv.get("notes")
        and "HA Quick Sale" in (inv.get("notes") or "")
    ]
    assert quick_sale_invs, "seeded tenant must have at least one Quick-Sale invoice"
    for inv in quick_sale_invs:
        sub = float(inv.get("subtotal") or 0)
        disc = float(inv.get("discount_total") or 0)
        tax = float(inv.get("tax_total") or 0)
        gt = float(inv.get("grand_total") or 0)
        expected_gt = round(sub - disc + tax, 2)
        assert abs(expected_gt - gt) < 0.5, (
            f"Invoice {inv['invoice_no']}: subtotal({sub}) − discount({disc})"
            f" + tax({tax}) = {expected_gt}, but grand_total = {gt}"
        )
        # When a discount is present, subtotal MUST be greater than grand_total
        if disc > 0:
            assert sub > gt, (
                f"Invoice {inv['invoice_no']}: has discount ₹{disc} but subtotal ({sub})"
                f" is not greater than grand_total ({gt}) — the popup will mislead."
            )
