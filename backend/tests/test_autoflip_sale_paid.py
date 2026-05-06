"""End-to-end test for Auto-flip HA Sale → paid when invoice is marked paid.

Flow:
  1. Seed a Product + serial_item (RESERVED can be reached via quote-convert).
  2. Quote → Convert → Sale (status='reserved', serial RESERVED).
  3. Create Invoice with `from_sale_no=<sale_no>` → expect:
        - sale.invoice_no == invoice_no
        - sale.status == 'invoiced'
  4. Add full payment to invoice → expect:
        - invoice.status == 'paid'
        - sale.status == 'paid' (auto-flipped)
        - serial.state == 'SOLD'
  5. Idempotency — adding more payment to a fully-paid invoice should NOT crash.
  6. Edge: invoice with `initial_payment` covering full amount on creation —
        sale should auto-flip immediately.
"""
import os
import uuid
import asyncio
import requests
from motor.motor_asyncio import AsyncIOMotorClient

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
MONGO = os.environ["MONGO_URL"]
DBN = os.environ["DB_NAME"]


def _login(email="admin@delhi.test", password="delhiadmin123"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    j = r.json()
    return j.get("access_token") or j["token"]


async def _seed():
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    user = await db.users.find_one({"email": "admin@delhi.test"}, {"_id": 0})
    clinic_id = user["clinic_id"]
    branch_id = user["branch_ids"][0]

    suffix = uuid.uuid4().hex[:6].upper()
    product_id = f"PRD-AF{suffix}"
    serial_id  = f"SRL-AF{suffix}"
    serial_no  = f"AF-{suffix}"
    pid        = f"PAT-AF{suffix}"

    await db.ha_products.insert_one({
        "product_id": product_id, "clinic_id": clinic_id,
        "brand": "AutoFlipBrand", "model": "AF-X", "form_factor": "RIC",
        "tech_tier": "premium", "warranty_months": 24, "mrp": 50000.0, "cost": 30000.0,
        "min_sell_price": 35000.0, "hsn": "9021", "gst_rate": 18.0,
        "is_serialised": True, "active": True, "created_at": "2026-05-06T00:00:00+00:00",
    })
    await db.serial_items.insert_one({
        "serial_id": serial_id, "clinic_id": clinic_id, "branch_id": branch_id,
        "product_id": product_id, "serial_no": serial_no,
        "state": "IN_STOCK", "pool": "saleable",
        "created_at": "2026-05-06T00:00:00+00:00",
    })
    await db.patients.insert_one({
        "patient_id": pid, "clinic_id": clinic_id, "branch_id": branch_id,
        "first_name": "AutoFlip", "last_name": "Tester", "name": "AutoFlip Tester",
        "age": 60, "gender": "Female",
        "mobile": "+919999000111", "mrd": f"AF-{suffix}",
        "created_at": "2026-05-06T00:00:00+00:00",
    })
    return clinic_id, branch_id, pid, product_id, serial_id, serial_no


async def _cleanup(product_id, serial_id, pid, sale_no=None, quote_no=None, invoice_id=None):
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    await db.ha_products.delete_many({"product_id": product_id})
    await db.serial_items.delete_many({"serial_id": serial_id})
    await db.patients.delete_many({"patient_id": pid})
    if sale_no:
        await db.ha_sales.delete_many({"sale_no": sale_no})
    if quote_no:
        await db.quotations.delete_many({"quote_no": quote_no})
    if invoice_id:
        await db.invoices.delete_many({"invoice_id": invoice_id})
        await db.payments.delete_many({"invoice_id": invoice_id})


async def _read(sale_no, invoice_id, serial_id):
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    sale = await db.ha_sales.find_one({"sale_no": sale_no}, {"_id": 0})
    inv = await db.invoices.find_one({"invoice_id": invoice_id}, {"_id": 0}) if invoice_id else None
    srl = await db.serial_items.find_one({"serial_id": serial_id}, {"_id": 0})
    return sale, inv, srl


def test_autoflip_via_payment():
    clinic_id, branch_id, pid, product_id, serial_id, serial_no = asyncio.run(_seed())
    h = {"Authorization": f"Bearer {_login()}"}

    # 1. Quote
    r = requests.post(f"{API}/ha/quotations", headers=h, json={
        "branch_id": branch_id, "patient_id": pid, "is_pair": False,
        "lines": [{"product_id": product_id, "side": "single", "qty": 1,
                   "unit_price": 45000, "discount_pct": 0, "gst_rate": 18}],
    }, timeout=15)
    assert r.status_code == 200, r.text
    quote_no = r.json()["quote_no"]

    # 2. Convert to Sale
    r = requests.post(f"{API}/ha/sales", headers=h, json={
        "quote_no": quote_no, "serial_assignments": {"0": serial_id},
    }, timeout=15)
    assert r.status_code == 200, r.text
    sale_no = r.json()["sale_no"]

    invoice_id = None
    try:
        # 3. Create Invoice with from_sale_no
        r = requests.post(f"{API}/billing/invoices", headers=h, json={
            "patient_id": pid,
            "from_sale_no": sale_no,
            "lines": [{"description": "Hearing Aid (Premium)", "quantity": 1,
                        "unit_price": 45000, "is_taxable": False, "gst_rate": 0}],
            "notes": "Auto-flip test",
        }, timeout=15)
        assert r.status_code == 200, r.text
        inv = r.json()
        invoice_id = inv["invoice_id"]
        invoice_no = inv["invoice_no"]
        assert inv["status"] == "draft", inv  # nothing paid yet (no initial_payment)
        sale, _inv, srl = asyncio.run(_read(sale_no, invoice_id, serial_id))
        assert sale["invoice_no"] == invoice_no, sale
        assert sale["status"] == "invoiced", sale
        assert srl["state"] == "RESERVED", srl

        # 4. Add full payment → invoice flips paid → sale auto-flips paid
        r = requests.post(f"{API}/billing/invoices/{invoice_id}/payments", headers=h, json={
            "method": "cash", "amount": 45000,
        }, timeout=15)
        assert r.status_code == 200, r.text
        inv2 = r.json()
        assert inv2["status"] == "paid", inv2
        sale, _inv, srl = asyncio.run(_read(sale_no, invoice_id, serial_id))
        assert sale["status"] == "paid", sale  # 🎯 auto-flip
        assert srl["state"] == "SOLD", srl     # serial advanced too

        # 5. Idempotent: 2nd payment on a paid invoice MUST NOT crash mark_sale_paid_internal
        r = requests.post(f"{API}/billing/invoices/{invoice_id}/payments", headers=h, json={
            "method": "cash", "amount": 1,  # over-pay
        }, timeout=15)
        # billing may 200 or 400 — what matters is the sale stays 'paid' and no 5xx.
        assert r.status_code in (200, 400), r.text
        sale, _inv, _srl = asyncio.run(_read(sale_no, invoice_id, serial_id))
        assert sale["status"] == "paid", sale

        print(f"PASS: auto-flip OK. sale={sale_no} status={sale['status']} serial={srl['state']}")
    finally:
        asyncio.run(_cleanup(product_id, serial_id, pid, sale_no=sale_no, quote_no=quote_no, invoice_id=invoice_id))


def test_autoflip_with_initial_payment():
    """Cash-in-hand checkout — invoice fully paid at creation time, sale should
    auto-flip immediately."""
    clinic_id, branch_id, pid, product_id, serial_id, serial_no = asyncio.run(_seed())
    h = {"Authorization": f"Bearer {_login()}"}
    r = requests.post(f"{API}/ha/quotations", headers=h, json={
        "branch_id": branch_id, "patient_id": pid, "is_pair": False,
        "lines": [{"product_id": product_id, "side": "single", "qty": 1,
                   "unit_price": 45000, "discount_pct": 0, "gst_rate": 18}],
    }, timeout=15)
    quote_no = r.json()["quote_no"]
    r = requests.post(f"{API}/ha/sales", headers=h, json={
        "quote_no": quote_no, "serial_assignments": {"0": serial_id},
    }, timeout=15)
    sale_no = r.json()["sale_no"]
    invoice_id = None
    try:
        r = requests.post(f"{API}/billing/invoices", headers=h, json={
            "patient_id": pid,
            "from_sale_no": sale_no,
            "lines": [{"description": "HA Premium", "quantity": 1,
                        "unit_price": 45000, "is_taxable": False, "gst_rate": 0}],
            "initial_payment": {"method": "cash", "amount": 45000},
        }, timeout=15)
        assert r.status_code == 200, r.text
        inv = r.json()
        invoice_id = inv["invoice_id"]
        assert inv["status"] == "paid", inv
        sale, _inv, srl = asyncio.run(_read(sale_no, invoice_id, serial_id))
        assert sale["status"] == "paid", sale
        assert srl["state"] == "SOLD", srl
        print("PASS: initial-payment auto-flip OK")
    finally:
        asyncio.run(_cleanup(product_id, serial_id, pid, sale_no=sale_no, quote_no=quote_no, invoice_id=invoice_id))


if __name__ == "__main__":
    test_autoflip_via_payment()
    test_autoflip_with_initial_payment()
