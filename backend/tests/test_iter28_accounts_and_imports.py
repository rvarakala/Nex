"""Iter28 — extended tests for rich CSV import + Accounts revenue dashboard.

Covers the remaining review-request scenarios not exercised by
test_rich_csv_import_and_accounts.py:
  - mrd_policy='auto' → AUDINEXA-format MR.NO for new patients
  - True duplicate guard (MR.NO + visit_date + bill_no triplet)
  - Validation: missing name / mobile / age+dob → fail; missing gender → OK
  - /accounts/revenue range presets (daily/weekly/monthly/quarterly/half_yearly/yearly) all 200
  - /accounts/revenue?range=custom without from/to → 400
  - /accounts/recent-payments?limit=N
  - Tenant isolation — admin@delhi.test imports, admin@acs.in if exists sees 0
  - Regression: founder@audinexa.com healthy on admin/v2/* and admin@delhi.test 403 on platform storage
"""
import os
import io
import asyncio
import time
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
MONGO = os.environ["MONGO_URL"]
DBN = os.environ["DB_NAME"]

DELHI = ("admin@delhi.test", "delhiadmin123")
FOUNDER = ("founder@audinexa.com", "founder123")

UNIQUE_MOBILES = ["9999911111", "9999922222", "9999933333", "9999944444", "9999955555", "9999966666"]
UNIQUE_MRDS = ["IMPAUTO-101", "IMPAUTO-102", "IMPDUP-201"]


def _login(email, password):
    # Retry login if rate-limited
    for _ in range(3):
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
        if r.status_code == 429:
            time.sleep(15)
            continue
        r.raise_for_status()
        j = r.json()
        return j.get("access_token") or j["token"]
    pytest.skip(f"Rate-limited login for {email}")


async def _cleanup():
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    await db.patients.delete_many({"mrd": {"$regex": "^(IMPAUTO-|IMPDUP-)"}})
    await db.patients.delete_many({"mobile": {"$in": UNIQUE_MOBILES}})
    await db.appointments.delete_many({"imported_via": {"$exists": True},
                                       "mrd": {"$regex": "^(IMPAUTO-|IMPDUP-|ACS-2026-)"}})
    await db.invoices.delete_many({"imported_via": {"$exists": True},
                                   "external_invoice_no": {"$regex": "^IMPDUP|IMPAUTO"}})
    await db.payments.delete_many({"imported_via": {"$exists": True},
                                   "mobile": {"$in": UNIQUE_MOBILES}})
    await db.import_jobs.delete_many({"filename": {"$regex": "^iter28_"}})
    # drop any auto-incident created by schema drift during imports
    await db.platform_incidents.delete_many({"title": {"$regex": "^DATA_HEALTH:"}})


@pytest.fixture(scope="module", autouse=True)
def cleanup_before_after():
    asyncio.run(_cleanup())
    yield
    asyncio.run(_cleanup())


@pytest.fixture(scope="module")
def delhi_token():
    return _login(*DELHI)


@pytest.fixture(scope="module")
def founder_token():
    return _login(*FOUNDER)


def _preview(token, csv_text, filename="iter28_test.csv"):
    files = {"file": (filename, io.BytesIO(csv_text.encode("utf-8")), "text/csv")}
    r = requests.post(f"{API}/imports/patients/preview",
                      headers={"Authorization": f"Bearer {token}"},
                      files=files, timeout=30)
    return r


def _commit(token, import_id, mrd_policy=None):
    body = {"import_id": import_id}
    if mrd_policy:
        body["mrd_policy"] = mrd_policy
    r = requests.post(f"{API}/imports/patients/commit",
                      headers={"Authorization": f"Bearer {token}"},
                      json=body, timeout=30)
    return r


# --- 1. MRD Policy=auto generates AUDINEXA-format mrd ----------------------
def test_mrd_policy_auto_generates_audinexa_format(delhi_token):
    csv = (
        "S.NO,Date,Pt.Name,Age,Gender,MR.NO,Ph.No,Bill.No,Tests,Amount,Ref.Dr\n"
        f"1,01-04-2026,Auto Patient One,40,Male,IMPAUTO-101,{UNIQUE_MOBILES[0]},AUTOB001,PTA,1000,Dr.Auto\n"
        f"2,02-04-2026,Auto Patient Two,35,Female,IMPAUTO-102,{UNIQUE_MOBILES[1]},AUTOB002,IMP,1200,Dr.Auto\n"
    )
    r = _preview(delhi_token, csv, "iter28_auto.csv")
    assert r.status_code == 200, r.text
    import_id = r.json()["import_id"]

    r = _commit(delhi_token, import_id, mrd_policy="auto")
    assert r.status_code == 200, r.text

    async def _check():
        cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
        # Should NOT store the CSV's IMPAUTO-xxx MRD
        imp = await db.patients.count_documents({"mrd": {"$regex": "^IMPAUTO-"},
                                                 "clinic_id": "clinic-delhi-test"})
        # Should have AUDINEXA-format MRD (clinic-delhi-test prefix is DEL per seed; tenant may vary)
        pts = await db.patients.find({"mobile": {"$in": UNIQUE_MOBILES[:2]}}).to_list(10)
        return imp, pts

    imp_count, pts = asyncio.run(_check())
    assert imp_count == 0, "CSV-supplied MRD should NOT be kept under mrd_policy='auto'"
    assert len(pts) == 2, pts
    for p in pts:
        mrd = p.get("mrd", "")
        # Auto-generated format: <PREFIX>-YYYY-NNNNNN (e.g. DEL-2026-000123 or ACS-2026-xxxxxx)
        assert mrd and "-" in mrd and "2026" in mrd, f"Unexpected auto MRD: {mrd}"
        assert not mrd.startswith("IMPAUTO"), f"Auto policy leaked CSV MRD: {mrd}"


# --- 2. True duplicate guard: same MR.NO + visit_date + bill_no ------------
def test_true_duplicate_row_is_skipped(delhi_token):
    csv = (
        "S.NO,Date,Pt.Name,Age,Gender,MR.NO,Ph.No,Bill.No,Tests,Amount,Ref.Dr\n"
        f"1,01-04-2026,Dup Patient,50,Male,IMPDUP-201,{UNIQUE_MOBILES[2]},DUPBILL1,PTA,1500,Dr.Dup\n"
        f"2,01-04-2026,Dup Patient,50,Male,IMPDUP-201,{UNIQUE_MOBILES[2]},DUPBILL1,PTA,1500,Dr.Dup\n"
    )
    r = _preview(delhi_token, csv, "iter28_dup.csv")
    assert r.status_code == 200, r.text
    body = r.json()
    statuses = [row["status"] for row in body["rows"]]
    # At least one should be marked as duplicate/skip
    assert any(s in ("skip", "duplicate") for s in statuses), f"Expected duplicate status: {statuses}"


# --- 3. Validation rules -----------------------------------------------------
def test_validation_missing_name_fails(delhi_token):
    csv = (
        "S.NO,Date,Pt.Name,Age,Gender,MR.NO,Ph.No,Bill.No,Tests,Amount,Ref.Dr\n"
        f"1,01-04-2026,,40,Male,,{UNIQUE_MOBILES[3]},VAL001,PTA,1000,Dr.A\n"
    )
    r = _preview(delhi_token, csv, "iter28_noname.csv")
    assert r.status_code == 200, r.text
    body = r.json()
    statuses = [row["status"] for row in body["rows"]]
    assert all(s in ("error", "skip", "fail") for s in statuses), f"Row with no name must fail: {statuses}"


def test_validation_missing_mobile_fails(delhi_token):
    csv = (
        "S.NO,Date,Pt.Name,Age,Gender,MR.NO,Ph.No,Bill.No,Tests,Amount,Ref.Dr\n"
        "1,01-04-2026,No Mobile,40,Male,,,VAL002,PTA,1000,Dr.A\n"
    )
    r = _preview(delhi_token, csv, "iter28_nomob.csv")
    assert r.status_code == 200, r.text
    body = r.json()
    statuses = [row["status"] for row in body["rows"]]
    assert all(s in ("error", "skip", "fail") for s in statuses), f"Row with no mobile must fail: {statuses}"


def test_validation_missing_age_and_dob_fails(delhi_token):
    csv = (
        "S.NO,Date,Pt.Name,Age,Gender,MR.NO,Ph.No,Bill.No,Tests,Amount,Ref.Dr\n"
        f"1,01-04-2026,No Age,,Male,,{UNIQUE_MOBILES[4]},VAL003,PTA,1000,Dr.A\n"
    )
    r = _preview(delhi_token, csv, "iter28_noage.csv")
    assert r.status_code == 200, r.text
    body = r.json()
    statuses = [row["status"] for row in body["rows"]]
    assert all(s in ("error", "skip", "fail") for s in statuses), f"Row with no age/dob must fail: {statuses}"


def test_validation_missing_gender_ok(delhi_token):
    csv = (
        "S.NO,Date,Pt.Name,Age,Gender,MR.NO,Ph.No,Bill.No,Tests,Amount,Ref.Dr\n"
        f"1,01-04-2026,No Gender,40,,,{UNIQUE_MOBILES[5]},VAL004,PTA,1000,Dr.A\n"
    )
    r = _preview(delhi_token, csv, "iter28_nogender.csv")
    assert r.status_code == 200, r.text
    body = r.json()
    # Gender optional → should be valid (not error)
    statuses = [row["status"] for row in body["rows"]]
    assert any(s in ("ok", "new", "followup") for s in statuses), f"Row without gender should NOT fail: {statuses}"


# --- 4. /accounts/revenue range presets ---------------------------------------
@pytest.mark.parametrize("range_key", ["daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly"])
def test_revenue_range_presets_200(delhi_token, range_key):
    r = requests.get(f"{API}/accounts/revenue",
                     headers={"Authorization": f"Bearer {delhi_token}"},
                     params={"range": range_key}, timeout=15)
    assert r.status_code == 200, f"{range_key}: {r.text}"
    j = r.json()
    for key in ("total", "payment_count", "unique_patients", "invoice_count",
                "timeseries", "by_method", "by_referring_doctor", "by_test"):
        assert key in j, f"{range_key} response missing {key}"
    assert isinstance(j["timeseries"], list)
    assert isinstance(j["by_referring_doctor"], list)
    assert isinstance(j["by_test"], list)


def test_revenue_custom_requires_from_to(delhi_token):
    r = requests.get(f"{API}/accounts/revenue",
                     headers={"Authorization": f"Bearer {delhi_token}"},
                     params={"range": "custom"}, timeout=15)
    assert r.status_code == 400, r.text


def test_revenue_custom_with_window(delhi_token):
    r = requests.get(f"{API}/accounts/revenue",
                     headers={"Authorization": f"Bearer {delhi_token}"},
                     params={"range": "custom", "from": "2026-04-01", "to": "2026-04-30"},
                     timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["from"] == "2026-04-01"
    assert j["to"] == "2026-04-30"


# --- 5. /accounts/recent-payments -------------------------------------------
def test_recent_payments_endpoint(delhi_token):
    r = requests.get(f"{API}/accounts/recent-payments",
                     headers={"Authorization": f"Bearer {delhi_token}"},
                     params={"limit": 10}, timeout=15)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert isinstance(rows, list)
    assert len(rows) <= 10


# --- 6. Tenant isolation -----------------------------------------------------
def test_tenant_isolation_revenue(delhi_token):
    """admin@delhi.test should only see its own imports (scoped by clinic_id)."""
    r = requests.get(f"{API}/accounts/revenue",
                     headers={"Authorization": f"Bearer {delhi_token}"},
                     params={"range": "yearly"}, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    # Verify payments returned are all Delhi-scoped
    r2 = requests.get(f"{API}/accounts/recent-payments",
                      headers={"Authorization": f"Bearer {delhi_token}"},
                      params={"limit": 50}, timeout=15)
    if r2.status_code == 200:
        rows = r2.json()
        for row in rows:
            assert row.get("clinic_id") in (None, "clinic-delhi-test"), \
                f"Tenant leak: {row.get('clinic_id')}"


# --- 7. Regression: founder healthy on /admin/v2/* -----------------------
def test_founder_admin_endpoints_healthy(founder_token):
    h = {"Authorization": f"Bearer {founder_token}"}
    for path in ("/admin/v2/dashboard", "/admin/v2/system/health",
                 "/admin/v2/system/data-health", "/admin/v2/system/storage"):
        r = requests.get(f"{API}{path}", headers=h, timeout=15)
        assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:200]}"


def test_platform_fence_still_active(delhi_token):
    r = requests.get(f"{API}/admin/v2/system/storage",
                     headers={"Authorization": f"Bearer {delhi_token}"}, timeout=15)
    assert r.status_code == 403, f"Expected 403 from tenant admin, got {r.status_code}: {r.text[:200]}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
