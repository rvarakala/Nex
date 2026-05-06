"""Iter30 extra coverage."""
import os, uuid, asyncio, requests
from motor.motor_asyncio import AsyncIOMotorClient

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
MONGO = os.environ["MONGO_URL"]; DBN = os.environ["DB_NAME"]


def _login(email="admin@delhi.test", password="delhiadmin123"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        return None
    j = r.json(); return j.get("access_token") or j.get("token")


async def _get_user_clinic():
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    user = await db.users.find_one({"email": "admin@delhi.test"}, {"_id": 0})
    return user["clinic_id"], user["branch_ids"][0]


async def _seed_patient(pid, clinic_id, branch_id, suffix):
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    await db.patients.insert_one({
        "patient_id": pid, "clinic_id": clinic_id, "branch_id": branch_id,
        "first_name": "Iter30", "last_name": "Tester", "name": "Iter30 Tester",
        "age": 60, "gender": "Female", "mobile": "+919900112233",
        "mrd": f"TASKA-{suffix}", "created_at": "2026-05-06T00:00:00+00:00",
    })


async def _cleanup(**ids):
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    if ids.get("patient_id"):
        await db.patients.delete_many({"patient_id": ids["patient_id"]})
    if ids.get("invoice_id"):
        await db.invoices.delete_many({"invoice_id": ids["invoice_id"]})
        await db.payments.delete_many({"invoice_id": ids["invoice_id"]})
    if ids.get("sale_no"):
        await db.ha_sales.delete_many({"sale_no": ids["sale_no"]})
    if ids.get("quote_no"):
        await db.quotations.delete_many({"quote_no": ids["quote_no"]})
    if ids.get("product_id"):
        await db.ha_products.delete_many({"product_id": ids["product_id"]})
    if ids.get("serial_ids"):
        await db.serial_items.delete_many({"serial_id": {"$in": ids["serial_ids"]}})
    if ids.get("tradein_id"):
        await db.ha_trade_ins.delete_many({"trade_in_id": ids["tradein_id"]})


async def _seed_tradein_setup(suffix, clinic_id, branch_id, product_id, new_serial_id, old_serial_id):
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    await db.ha_products.insert_one({
        "product_id": product_id, "clinic_id": clinic_id,
        "brand": "TIBrand", "model": "TI-X", "form_factor": "RIC",
        "tech_tier": "premium", "warranty_months": 24, "mrp": 60000.0, "cost": 35000.0,
        "min_sell_price": 40000.0, "hsn": "9021", "gst_rate": 18.0,
        "is_serialised": True, "active": True, "created_at": "2026-05-06T00:00:00+00:00",
    })
    await db.serial_items.insert_one({
        "serial_id": new_serial_id, "clinic_id": clinic_id, "branch_id": branch_id,
        "product_id": product_id, "serial_no": f"NEW-{suffix}",
        "state": "IN_STOCK", "pool": "saleable",
        "created_at": "2026-05-06T00:00:00+00:00",
    })
    await db.serial_items.insert_one({
        "serial_id": old_serial_id, "clinic_id": clinic_id, "branch_id": branch_id,
        "product_id": product_id, "serial_no": f"OLD-{suffix}",
        "state": "RETURNED", "pool": "tradein",
        "created_at": "2026-05-06T00:00:00+00:00",
    })


async def _insert_tradein(tradein_id, clinic_id, branch_id, pid, old_serial_id):
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    await db.ha_trade_ins.insert_one({
        "trade_in_id": tradein_id, "clinic_id": clinic_id, "branch_id": branch_id,
        "patient_id": pid, "old_serial_id": old_serial_id,
        "old_brand": "Old", "old_model": "X1", "old_serial_no": "OLD-X1",
        "offered_credit": 5000.0, "status": "accepted",
        "created_at": "2026-05-06T00:00:00+00:00",
    })


async def _read_tradein(tradein_id, old_serial_id):
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    ti = await db.ha_trade_ins.find_one({"trade_in_id": tradein_id}, {"_id": 0})
    old = await db.serial_items.find_one({"serial_id": old_serial_id}, {"_id": 0})
    return ti, old


def test_regular_invoice_without_from_sale_no():
    h = {"Authorization": f"Bearer {_login()}"}
    clinic_id, branch_id = asyncio.run(_get_user_clinic())
    suffix = uuid.uuid4().hex[:6].upper()
    pid = f"PAT-RG{suffix}"
    asyncio.run(_seed_patient(pid, clinic_id, branch_id, suffix))
    invoice_id = None
    try:
        r = requests.post(f"{API}/billing/invoices", headers=h, json={
            "patient_id": pid,
            "lines": [{"description": "Consultation", "quantity": 1,
                       "unit_price": 500, "is_taxable": False, "gst_rate": 0}],
            "notes": "Plain consult invoice — no sale linkage",
        }, timeout=15)
        assert r.status_code == 200, r.text
        inv = r.json()
        invoice_id = inv["invoice_id"]
        assert inv.get("linked_sale_no") in (None, ""), inv
        assert inv["status"] == "draft", inv
        print(f"PASS: regular invoice {inv['invoice_no']} OK")
    finally:
        asyncio.run(_cleanup(patient_id=pid, invoice_id=invoice_id))


def test_all_seven_policies_substituted():
    tok = _login(); h = {"Authorization": f"Bearer {tok}"}
    r = requests.get(f"{API}/legal/policies", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json(); assert d["count"] == 7
    for p in d["policies"]:
        rr = requests.get(f"{API}/legal/policies/{p['id']}", headers=h, timeout=15)
        assert rr.status_code == 200
        body = rr.json()
        assert "{{" not in body["markdown"], f"{p['id']} has unsubstituted placeholder"
        rp = requests.get(f"{API}/legal/policies/{p['id']}/pdf", headers=h, timeout=20)
        assert rp.status_code == 200
        assert rp.headers["content-type"] == "application/pdf"
        assert rp.content[:5] == b"%PDF-"
        assert len(rp.content) > 1000
    print("PASS: all 7 policies render with substitution + valid PDF")


def test_policy_pack_requires_auth():
    r = requests.get(f"{API}/legal/policies", timeout=10)
    assert r.status_code in (401, 403), r.status_code
    r = requests.get(f"{API}/legal/policies/01_information_security", timeout=10)
    assert r.status_code in (401, 403), r.status_code
    r = requests.get(f"{API}/legal/policies/01_information_security/pdf", timeout=10)
    assert r.status_code in (401, 403), r.status_code
    print("PASS: legal pack auth-gated")


def test_policy_404_unknown():
    h = {"Authorization": f"Bearer {_login()}"}
    r = requests.get(f"{API}/legal/policies/99_doesnotexist", headers=h, timeout=10)
    assert r.status_code == 404, r.status_code
    r = requests.get(f"{API}/legal/policies/99_doesnotexist/pdf", headers=h, timeout=10)
    assert r.status_code == 404, r.status_code
    print("PASS: unknown policy → 404")


def test_policy_raw_role_gating():
    tok = _login("admin@delhi.test", "delhiadmin123")
    h = {"Authorization": f"Bearer {tok}"}
    r = requests.get(f"{API}/legal/policies/01_information_security/raw", headers=h, timeout=15)
    assert r.status_code == 200, f"super_admin/clinic_owner should access raw: {r.status_code} {r.text[:200]}"
    body = r.json()
    raw = body.get("markdown_raw") or body.get("markdown") or ""
    assert "{{" in raw, "raw template should contain placeholders"

    fd_tok = _login("frontdesk@delhi.test", "delhifrontdesk123")
    if fd_tok:
        rr = requests.get(f"{API}/legal/policies/01_information_security/raw",
                          headers={"Authorization": f"Bearer {fd_tok}"}, timeout=15)
        assert rr.status_code in (401, 403), f"front_desk must be forbidden, got {rr.status_code} {rr.text[:200]}"
        print("PASS: raw template gating OK (clinic_owner allowed, front_desk blocked)")
    else:
        print("PARTIAL PASS: raw template accessible to clinic_owner; front_desk login unavailable")


def test_tradein_finalised_on_autoflip():
    tok = _login(); h = {"Authorization": f"Bearer {tok}"}
    clinic_id, branch_id = asyncio.run(_get_user_clinic())
    suffix = uuid.uuid4().hex[:6].upper()
    product_id = f"PRD-TI{suffix}"
    new_serial_id = f"SRL-TI{suffix}"
    old_serial_id = f"SRL-OL{suffix}"
    pid = f"PAT-TI{suffix}"
    tradein_id = f"TI-{suffix}"

    asyncio.run(_seed_tradein_setup(suffix, clinic_id, branch_id, product_id, new_serial_id, old_serial_id))
    asyncio.run(_seed_patient(pid, clinic_id, branch_id, suffix))
    # Insert trade-in BEFORE sale so it can be linked via SaleCreate.trade_in_id
    asyncio.run(_insert_tradein(tradein_id, clinic_id, branch_id, pid, old_serial_id))

    quote_no = sale_no = invoice_id = None
    try:
        r = requests.post(f"{API}/ha/quotations", headers=h, json={
            "branch_id": branch_id, "patient_id": pid, "is_pair": False,
            "lines": [{"product_id": product_id, "side": "single", "qty": 1,
                       "unit_price": 50000, "discount_pct": 0, "gst_rate": 18}],
        }, timeout=15)
        assert r.status_code == 200, r.text
        quote_no = r.json()["quote_no"]
        r = requests.post(f"{API}/ha/sales", headers=h, json={
            "quote_no": quote_no, "serial_assignments": {"0": new_serial_id},
            "trade_in_id": tradein_id,
        }, timeout=15)
        assert r.status_code == 200, r.text
        sale_no = r.json()["sale_no"]

        r = requests.post(f"{API}/billing/invoices", headers=h, json={
            "patient_id": pid, "from_sale_no": sale_no,
            "lines": [{"description": "HA Premium TI", "quantity": 1,
                       "unit_price": 50000, "is_taxable": False, "gst_rate": 0}],
            "initial_payment": {"method": "cash", "amount": 50000},
        }, timeout=15)
        assert r.status_code == 200, r.text
        inv = r.json(); invoice_id = inv["invoice_id"]
        assert inv["status"] == "paid", inv

        ti, old = asyncio.run(_read_tradein(tradein_id, old_serial_id))
        assert ti is not None
        print(f"INFO: tradein.status={ti.get('status')}, old.serial.state={old.get('state')}")
        assert ti.get("status") == "applied", f"expected tradein.status='applied', got {ti.get('status')}"
        assert old.get("state") == "RETIRED", f"expected old serial RETIRED, got {old.get('state')}"
        print("PASS: tradein finalised on auto-flip")
    finally:
        asyncio.run(_cleanup(
            patient_id=pid, invoice_id=invoice_id, sale_no=sale_no,
            quote_no=quote_no, product_id=product_id,
            serial_ids=[new_serial_id, old_serial_id], tradein_id=tradein_id,
        ))


if __name__ == "__main__":
    test_regular_invoice_without_from_sale_no()
    test_all_seven_policies_substituted()
    test_policy_pack_requires_auth()
    test_policy_404_unknown()
    test_policy_raw_role_gating()
    test_tradein_finalised_on_autoflip()
