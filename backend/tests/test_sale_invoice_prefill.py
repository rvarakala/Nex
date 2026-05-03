"""End-to-end test for HA-Sale → Invoice auto-link prefill.

1. Create a Hearing Aid Product, register a Serial under it.
2. Create a Quotation with that line.
3. Convert the quote into a Sale.
4. Hit GET /api/ha/sales/{sale_no}/invoice-prefill and confirm
   make/model/serial/tier/qty/unit_price are populated.
"""
import os
import uuid
import asyncio
import requests
from motor.motor_asyncio import AsyncIOMotorClient

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
MONGO = os.environ["MONGO_URL"]
DBN = os.environ["DB_NAME"]


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    j = r.json()
    return j.get("access_token") or j["token"]


async def _seed():
    """Seed a product + serial directly so we don't depend on procurement flows."""
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    # Find clinic admin user to learn branch
    user = await db.users.find_one({"email": "admin@delhi.test"}, {"_id": 0})
    assert user, "admin@delhi.test seed user missing"
    clinic_id = user["clinic_id"]
    branch_id = (user.get("branch_ids") or [])[0]
    assert branch_id, "no branch on admin@delhi.test"

    # Always seed a fresh patient for this test (avoids stale data shape issues)
    pid = f"PAT-PRE{uuid.uuid4().hex[:6].upper()}"
    await db.patients.insert_one({
        "patient_id": pid, "clinic_id": clinic_id, "branch_id": branch_id,
        "first_name": "Prefill", "last_name": "Tester",
        "name": "Prefill Tester",
        "mobile": "+919999999999", "mrd": f"PRE-{uuid.uuid4().hex[:4].upper()}",
        "created_at": "2026-05-03T00:00:00+00:00",
    })
    pat = {"patient_id": pid}

    suffix = uuid.uuid4().hex[:6].upper()
    product_id = f"PRD-TEST{suffix}"
    serial_id  = f"SRL-TEST{suffix}"
    serial_no  = f"SN-{suffix}"

    await db.ha_products.insert_one({
        "product_id": product_id, "clinic_id": clinic_id,
        "brand": "TestBrand", "model": "TestModel-X",
        "form_factor": "RIC", "tech_tier": "premium",
        "warranty_months": 24, "mrp": 50000.0, "cost": 30000.0,
        "min_sell_price": 35000.0, "hsn": "9021", "gst_rate": 18.0,
        "is_serialised": True, "active": True,
        "created_at": "2026-05-03T00:00:00+00:00",
    })
    await db.serial_items.insert_one({
        "serial_id": serial_id, "clinic_id": clinic_id, "branch_id": branch_id,
        "product_id": product_id, "serial_no": serial_no,
        "state": "IN_STOCK", "pool": "saleable",
        "created_at": "2026-05-03T00:00:00+00:00",
    })
    return clinic_id, branch_id, pat["patient_id"], product_id, serial_id, serial_no


async def _cleanup(product_id, serial_id, sale_no=None, quote_no=None, patient_id=None):
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    await db.ha_products.delete_many({"product_id": product_id})
    await db.serial_items.delete_many({"serial_id": serial_id})
    if sale_no:
        await db.ha_sales.delete_many({"sale_no": sale_no})
    if quote_no:
        await db.quotations.delete_many({"quote_no": quote_no})
    if patient_id:
        await db.patients.delete_many({"patient_id": patient_id})


def test_invoice_prefill():
    clinic_id, branch_id, patient_id, product_id, serial_id, serial_no = asyncio.run(_seed())
    token = _login("admin@delhi.test", "delhiadmin123")
    h = {"Authorization": f"Bearer {token}"}

    # 1. Quotation
    r = requests.post(f"{API}/ha/quotations", headers=h, json={
        "branch_id": branch_id, "patient_id": patient_id, "is_pair": False,
        "lines": [{"product_id": product_id, "side": "single", "qty": 1,
                   "unit_price": 45000, "discount_pct": 0, "gst_rate": 18}],
    }, timeout=15)
    assert r.status_code == 200, r.text
    quote_no = r.json()["quote_no"]

    # 2. Convert to sale
    r = requests.post(f"{API}/ha/sales", headers=h, json={
        "quote_no": quote_no, "serial_assignments": {"0": serial_id},
    }, timeout=15)
    assert r.status_code == 200, r.text
    sale_no = r.json()["sale_no"]

    try:
        # 3. Prefill
        r = requests.get(f"{API}/ha/sales/{sale_no}/invoice-prefill", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["already_invoiced"] is False
        assert d["sale_no"] == sale_no
        assert d["patient"]["patient_id"] == patient_id
        assert len(d["lines"]) == 1
        ln = d["lines"][0]
        assert ln["make"] == "TestBrand", ln
        assert ln["model"] == "TestModel-X", ln
        assert ln["technology_tier"] == "Premium", ln
        assert ln["serial_numbers"] == [serial_no], ln
        assert ln["product_type"] == "Hearing Aid", ln
        assert ln["unit_price"] == 45000, ln
        assert ln["quantity"] == 1, ln
        assert ln["gst_rate"] == 18, ln
        assert ln["is_taxable"] is True, ln
        print(f"PASS: prefill OK for {sale_no} → {ln['make']} {ln['model']} ({ln['technology_tier']}) SN={ln['serial_numbers']}")
    finally:
        asyncio.run(_cleanup(product_id, serial_id, sale_no=sale_no, quote_no=quote_no, patient_id=patient_id))


if __name__ == "__main__":
    test_invoice_prefill()
