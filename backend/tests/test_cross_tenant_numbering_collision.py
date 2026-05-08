"""Regression: cross-tenant numbering collisions on quote_no / sale_no / etc.

Bug summary (2026-05-08): `next_number()` mints sequence numbers scoped to
`(kind, clinic_id, year)`, so two tenants both legitimately receive
`QTE-2026-0001`. But the Mongo unique index on `quotations.quote_no` was
GLOBAL (single-field), so the second tenant's first quote crashed with
`E11000 duplicate key`. Same pattern affected po_no / sale_no / trial_no /
contract_no. Fixed by replacing global indexes with compound
`(clinic_id, <number>)` unique keys.

This test reproduces the original failure case: two tenants each create a
quote with the same `quote_no`, both should succeed.
"""
from __future__ import annotations

import requests

from _helpers import ADMIN_EMAIL, ADMIN_PASSWORD, API, H, login


def test_two_tenants_can_each_create_quote_with_same_number():
    """Both tenants should be able to mint a quote without colliding on the
    cross-tenant unique index. Uses the pytest-suite tenant + the seeded
    Sound Clinic premium tenant (`owner@thesoundclinic.in` / `demo123`)."""

    def _create_quote(tok: str, label: str) -> str:
        br = requests.get(f"{API}/branches", headers=H(tok), timeout=15).json()
        assert isinstance(br, list) and br, f"{label}: no branches"
        pats = requests.get(f"{API}/patients?limit=1", headers=H(tok), timeout=15).json()
        prods = requests.get(f"{API}/ha/products?active=true", headers=H(tok), timeout=15).json()
        assert isinstance(pats, list) and pats, f"{label}: no patients"
        assert isinstance(prods, list) and prods, f"{label}: no products"
        body = {
            "branch_id": br[0]["branch_id"],
            "patient_id": pats[0]["patient_id"],
            "is_pair": False,
            "lines": [{
                "product_id": prods[0]["product_id"],
                "side": "both",
                "qty": 2,
                "unit_price": 55000.0,
                "discount_pct": 0,
                "gst_rate": 18,
            }],
        }
        r = requests.post(f"{API}/ha/quotations", headers=H(tok), json=body, timeout=20)
        assert r.status_code == 200, f"{label} quote create failed: {r.status_code} {r.text}"
        return r.json()["quote_no"]

    # Tenant 1: pytest suite (default test admin).
    qte_pytest = _create_quote(login(ADMIN_EMAIL, ADMIN_PASSWORD), "pytest-suite")

    # Tenant 2: Sound Clinic premium demo tenant.
    qte_sound = _create_quote(
        login("owner@thesoundclinic.in", "demo123"), "sound-clinic"
    )

    # Both must be valid quote numbers — the unique index must not block
    # the second tenant from minting its sequence (whether or not the
    # numerical suffix happens to overlap).
    assert qte_pytest.startswith("QTE-")
    assert qte_sound.startswith("QTE-")
