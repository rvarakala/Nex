"""Phase 1 HA Foundation tests — Branches, Vendors, numbering helper,
state machine, role gates, cross-tenant isolation, regression on prior APIs.
"""
import os
import re
import sys
import asyncio
import pytest
import requests

from _helpers import ADMIN_EMAIL, ADMIN_PASSWORD  # legacy creds (env-overridable)
sys.path.insert(0, "/app/backend")  # allow importing util modules

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"


# ------------------------- helpers / fixtures -------------------------

def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def frontdesk():
    return _login("frontdesk@acs.in", "frontdesk123")


@pytest.fixture(scope="module")
def delhi_admin():
    return _login("admin@delhi.test", "delhiadmin123")


def hdr(token):
    return {"Authorization": f"Bearer {token['access_token']}"}


# ------------------------- auth / branch_ids shape --------------------

class TestAuthBranchIds:
    def test_login_includes_branch_ids(self, admin):
        u = admin["user"]
        assert "branch_ids" in u
        assert isinstance(u["branch_ids"], list) and len(u["branch_ids"]) >= 1
        assert all(re.match(r"^BR-[A-F0-9]{8}$", b) for b in u["branch_ids"])

    def test_me_includes_branch_ids(self, admin):
        r = requests.get(f"{API}/auth/me", headers=hdr(admin), timeout=10)
        assert r.status_code == 200
        u = r.json()["user"]
        assert isinstance(u.get("branch_ids"), list) and len(u["branch_ids"]) >= 1

    def test_frontdesk_has_branch_ids(self, frontdesk):
        assert len(frontdesk["user"]["branch_ids"]) >= 1


# ------------------------- branches CRUD ------------------------------

class TestBranches:
    def test_list_as_admin_has_primary(self, admin):
        r = requests.get(f"{API}/branches", headers=hdr(admin), timeout=10)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 1
        primary = [b for b in rows if b.get("is_primary")]
        assert len(primary) == 1
        assert primary[0]["name"] == "Mumbai HQ"

    def test_list_as_frontdesk_scoped(self, frontdesk):
        r = requests.get(f"{API}/branches", headers=hdr(frontdesk), timeout=10)
        assert r.status_code == 200
        rows = r.json()
        # front-desk is branch-scoped to own branch_ids
        allowed = set(frontdesk["user"]["branch_ids"])
        for b in rows:
            assert b["branch_id"] in allowed

    def test_post_denied_for_frontdesk(self, frontdesk):
        r = requests.post(f"{API}/branches", headers=hdr(frontdesk),
                          json={"name": "Illegal"}, timeout=10)
        assert r.status_code == 403

    def test_post_as_admin(self, admin):
        r = requests.post(f"{API}/branches", headers=hdr(admin),
                          json={"name": "Worli Branch", "city": "Mumbai"}, timeout=10)
        assert r.status_code in (200, 201), r.text
        b = r.json()
        assert re.match(r"^BR-[A-F0-9]{8}$", b["branch_id"])
        assert b["is_primary"] is False
        # cleanup via soft-delete
        requests.delete(f"{API}/branches/{b['branch_id']}", headers=hdr(admin), timeout=10)

    def test_primary_invariant(self, admin):
        # Create Andheri as primary; previous primary (Mumbai HQ) should flip.
        r = requests.post(f"{API}/branches", headers=hdr(admin),
                          json={"name": "Andheri", "is_primary": True}, timeout=10)
        assert r.status_code in (200, 201), r.text
        new_b = r.json()
        assert new_b["is_primary"] is True
        try:
            # Confirm only one is_primary=true remains
            lst = requests.get(f"{API}/branches", headers=hdr(admin), timeout=10).json()
            primaries = [b for b in lst if b.get("is_primary")]
            assert len(primaries) == 1, f"Expected 1 primary, got {primaries}"
            assert primaries[0]["branch_id"] == new_b["branch_id"]
        finally:
            # Restore: flip Mumbai HQ back to primary
            lst = requests.get(f"{API}/branches", headers=hdr(admin), timeout=10).json()
            mumbai = next((b for b in lst if b["name"] == "Mumbai HQ"), None)
            if mumbai:
                requests.put(f"{API}/branches/{mumbai['branch_id']}", headers=hdr(admin),
                             json={"name": "Mumbai HQ", "city": "Mumbai",
                                   "state": "Maharashtra", "is_primary": True}, timeout=10)
            # Soft delete the test branch
            requests.delete(f"{API}/branches/{new_b['branch_id']}", headers=hdr(admin), timeout=10)

    def test_put_role_gate(self, admin, frontdesk):
        # Get Mumbai HQ id
        lst = requests.get(f"{API}/branches", headers=hdr(admin), timeout=10).json()
        mumbai = next(b for b in lst if b["name"] == "Mumbai HQ")
        bid = mumbai["branch_id"]
        # front-desk forbidden
        r = requests.put(f"{API}/branches/{bid}", headers=hdr(frontdesk),
                         json={"name": "Hack"}, timeout=10)
        assert r.status_code == 403
        # admin ok (no-op update)
        r = requests.put(f"{API}/branches/{bid}", headers=hdr(admin),
                         json={"name": "Mumbai HQ", "city": "Mumbai",
                               "state": "Maharashtra", "is_primary": True}, timeout=10)
        assert r.status_code == 200

    def test_delete_soft(self, admin):
        r = requests.post(f"{API}/branches", headers=hdr(admin),
                          json={"name": "ToDelete"}, timeout=10)
        bid = r.json()["branch_id"]
        dr = requests.delete(f"{API}/branches/{bid}", headers=hdr(admin), timeout=10)
        assert dr.status_code == 200
        lst = requests.get(f"{API}/branches", headers=hdr(admin), timeout=10).json()
        assert all(b["branch_id"] != bid for b in lst), "soft-deleted branch still listed"


# ------------------------- vendors CRUD -------------------------------

_CREATED_VENDORS = []


class TestVendors:
    def test_list_initially(self, admin):
        r = requests.get(f"{API}/vendors", headers=hdr(admin), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_post_as_admin(self, admin):
        r = requests.post(f"{API}/vendors", headers=hdr(admin),
                          json={"name": "Signia India", "gstin": "27AABCS0000Z1Z5"}, timeout=10)
        assert r.status_code == 200, r.text
        v = r.json()
        assert re.match(r"^VND-[A-F0-9]{8}$", v["vendor_id"])
        _CREATED_VENDORS.append(v["vendor_id"])

    def test_post_denied_for_frontdesk(self, frontdesk):
        r = requests.post(f"{API}/vendors", headers=hdr(frontdesk),
                          json={"name": "BadVendor"}, timeout=10)
        assert r.status_code == 403

    def test_post_as_inventory_manager(self, admin):
        # Need to create an inventory_manager user directly in DB.
        from motor.motor_asyncio import AsyncIOMotorClient
        from auth import hash_password
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]

        async def setup():
            c = AsyncIOMotorClient(mongo_url)
            db = c[db_name]
            # Find Mumbai HQ primary branch_id
            br = await db.branches.find_one({"clinic_id": "clinic-acs-demo", "is_primary": True})
            u = {
                "user_id": "USR-TESTINV01",
                "clinic_id": "clinic-acs-demo",
                "email": "test_inv@acs.in",
                "name": "Test Inv Mgr",
                "role": "inventory_manager",
                "branch_ids": [br["branch_id"]] if br else [],
                "active": True,
                "password_hash": hash_password("invpass123"),
            }
            await db.users.delete_one({"email": "test_inv@acs.in"})
            await db.users.insert_one(u)
            c.close()
        asyncio.get_event_loop().run_until_complete(setup()) if False else asyncio.run(setup())

        tok = _login("test_inv@acs.in", "invpass123")
        r = requests.post(f"{API}/vendors", headers=hdr(tok),
                          json={"name": "TEST_Phonak"}, timeout=10)
        assert r.status_code == 200, r.text
        _CREATED_VENDORS.append(r.json()["vendor_id"])

    def test_search_case_insensitive(self, admin):
        r = requests.get(f"{API}/vendors?search=signia", headers=hdr(admin), timeout=10)
        assert r.status_code == 200
        names = [v["name"] for v in r.json()]
        assert any("Signia" in n for n in names)

    def test_search_special_chars_no_500(self, admin):
        # Should NOT 500 on regex-special chars
        r = requests.get(f"{API}/vendors?search=Test%24.%5E", headers=hdr(admin), timeout=10)
        assert r.status_code == 200

    def test_delete_soft_and_active_filter(self, admin):
        # Create, delete, assert filtered out with ?active=true
        r = requests.post(f"{API}/vendors", headers=hdr(admin),
                          json={"name": "TEST_ToDelete"}, timeout=10)
        vid = r.json()["vendor_id"]
        dr = requests.delete(f"{API}/vendors/{vid}", headers=hdr(admin), timeout=10)
        assert dr.status_code == 200
        lst = requests.get(f"{API}/vendors?active=true", headers=hdr(admin), timeout=10).json()
        assert all(v["vendor_id"] != vid for v in lst)

    def test_cleanup_vendors(self, admin):
        for vid in _CREATED_VENDORS:
            requests.delete(f"{API}/vendors/{vid}", headers=hdr(admin), timeout=10)
        # Delete test user
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]

        async def tear():
            c = AsyncIOMotorClient(mongo_url)
            await c[db_name].users.delete_one({"email": "test_inv@acs.in"})
            c.close()
        asyncio.run(tear())


# ------------------------- numbering helper ----------------------------

class TestNumbering:
    def test_po_counters_scoped(self):
        from utils.numbering import next_number
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]

        async def run():
            c = AsyncIOMotorClient(mongo_url)
            db = c[db_name]
            # Clean counters for two test clinics
            await db.counters.delete_many({"_id": {"$regex": r"^po:TEST_A:|^po:TEST_B:"}})
            n1 = await next_number(db, "po", "TEST_A")
            n2 = await next_number(db, "po", "TEST_A")
            n3 = await next_number(db, "po", "TEST_B")
            c.close()
            return n1, n2, n3

        n1, n2, n3 = asyncio.run(run())
        year_re = r"^PO-\d{4}-0001$"
        assert re.match(year_re, n1), n1
        assert re.match(r"^PO-\d{4}-0002$", n2), n2
        assert re.match(year_re, n3), n3  # different clinic → reset to 0001

    def test_unknown_kind_raises(self):
        from utils.numbering import next_number

        async def run():
            with pytest.raises(KeyError):
                await next_number(None, "bogus", "clinic-x")
        asyncio.run(run())


# ------------------------- state machine ------------------------------

class TestStateMachine:
    def test_states_complete(self):
        from utils.ha_states import STATES
        assert STATES == frozenset({
            "IN_STOCK", "RESERVED", "TRIAL_OUT", "SOLD", "LOANER",
            "SERVICE_IN", "RETURNED", "DAMAGED", "RETIRED",
        })

    def test_legal_transition_silent(self):
        from utils.ha_states import assert_transition
        assert_transition("IN_STOCK", "TRIAL_OUT")

    def test_illegal_transition_409(self):
        from utils.ha_states import assert_transition
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as ei:
            assert_transition("SOLD", "TRIAL_OUT")
        assert ei.value.status_code == 409

    def test_transition_serial_writes_audit(self):
        from utils.ha_states import transition_serial
        from motor.motor_asyncio import AsyncIOMotorClient
        from fastapi import HTTPException
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]

        async def run():
            c = AsyncIOMotorClient(mongo_url)
            db = c[db_name]
            sid = "TEST_SERIAL_PHASE1"
            # Seed a serial_item
            await db.serial_items.delete_one({"serial_id": sid})
            await db.serial_events.delete_many({"serial_id": sid})
            await db.serial_items.insert_one({
                "serial_id": sid, "state": "IN_STOCK", "clinic_id": "clinic-acs-demo",
            })
            # Legal transition
            await transition_serial(db, sid, "TRIAL_OUT", "USR-TEST",
                                    ref_doc={"kind": "trial", "id": "TRIAL-2026-0001"})
            si = await db.serial_items.find_one({"serial_id": sid})
            evts = await db.serial_events.find({"serial_id": sid}).to_list(10)
            # Illegal transition should NOT add audit row
            try:
                await transition_serial(db, sid, "RESERVED", "USR-TEST")
                raised = False
            except HTTPException as e:
                raised = e.status_code == 409
            evts_after = await db.serial_events.find({"serial_id": sid}).to_list(10)
            # Cleanup
            await db.serial_items.delete_one({"serial_id": sid})
            await db.serial_events.delete_many({"serial_id": sid})
            c.close()
            return si, evts, raised, evts_after

        si, evts, raised, evts_after = asyncio.run(run())
        assert si["state"] == "TRIAL_OUT"
        assert len(evts) == 1
        assert evts[0]["from"] == "IN_STOCK"
        assert evts[0]["to"] == "TRIAL_OUT"
        assert evts[0]["actor_user_id"] == "USR-TEST"
        assert evts[0]["ref_doc"] == {"kind": "trial", "id": "TRIAL-2026-0001"}
        assert raised is True, "Illegal transition must raise 409"
        assert len(evts_after) == 1, "Illegal transition must NOT write audit row"


# ------------------------- cross-tenant isolation ---------------------

class TestCrossTenant:
    def test_delhi_admin_cannot_see_mumbai_branches(self, delhi_admin, admin):
        mumbai_ids = {b["branch_id"] for b in requests.get(
            f"{API}/branches", headers=hdr(admin), timeout=10).json()}
        delhi_ids = {b["branch_id"] for b in requests.get(
            f"{API}/branches", headers=hdr(delhi_admin), timeout=10).json()}
        assert mumbai_ids.isdisjoint(delhi_ids), \
            f"Cross-tenant leak: {mumbai_ids & delhi_ids}"

    def test_delhi_admin_cannot_get_mumbai_branch(self, delhi_admin, admin):
        mumbai = next(b for b in requests.get(
            f"{API}/branches", headers=hdr(admin), timeout=10).json()
            if b.get("is_primary"))
        r = requests.get(f"{API}/branches/{mumbai['branch_id']}",
                         headers=hdr(delhi_admin), timeout=10)
        assert r.status_code in (403, 404), f"Expected 403/404, got {r.status_code}"


# ------------------------- regression prior endpoints -----------------

class TestRegression:
    @pytest.mark.parametrize("path,ok_codes", [
        ("/patients", (200,)),
        ("/appointments", (200,)),
        ("/tokens", (200,)),
        ("/dashboard/frontdesk", (200,)),
        ("/sessions", (200,)),
        ("/billing/services", (200,)),
        ("/billing/invoices", (200,)),
        ("/closeouts/current", (200, 404)),  # 404 valid when no close-out today
    ])
    def test_endpoint_200(self, admin, path, ok_codes):
        r = requests.get(f"{API}{path}", headers=hdr(admin), timeout=15)
        assert r.status_code in ok_codes, f"{path} -> {r.status_code}: {r.text[:200]}"


# ------------------------- seed idempotency ---------------------------

class TestSeedIdempotency:
    def test_no_duplicate_primary_branches(self, admin, delhi_admin):
        """Verifies the running state has exactly one primary per clinic —
        and the seed did not duplicate Mumbai HQ or Delhi branch rows."""
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]

        async def run():
            c = AsyncIOMotorClient(mongo_url)
            db = c[db_name]
            mumbai = await db.branches.count_documents(
                {"clinic_id": "clinic-acs-demo", "name": "Mumbai HQ"})
            delhi = await db.branches.count_documents(
                {"clinic_id": "clinic-delhi-test", "name": "Delhi"})
            mumbai_primaries = await db.branches.count_documents(
                {"clinic_id": "clinic-acs-demo", "is_primary": True, "active": True})
            delhi_primaries = await db.branches.count_documents(
                {"clinic_id": "clinic-delhi-test", "is_primary": True, "active": True})
            c.close()
            return mumbai, delhi, mumbai_primaries, delhi_primaries

        m, d, mp, dp = asyncio.run(run())
        assert m == 1, f"Mumbai HQ duplicated: {m}"
        assert d == 1, f"Delhi duplicated: {d}"
        assert mp == 1, f"Mumbai primaries count: {mp}"
        assert dp == 1, f"Delhi primaries count: {dp}"
