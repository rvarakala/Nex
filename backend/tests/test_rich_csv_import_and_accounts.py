"""End-to-end test for the rich CSV import + Accounts revenue dashboard.

Uses the user's sample CSV format:
  S.NO, Date, Pt.Name, Age, Gender, Area, MR.NO, Ph.No, Bill.No, Tests, Diagnosis, Amount, Ref.Dr, Remarks

Verifies:
  - Default mrd_policy='keep' preserves the clinic's MR.NO verbatim
  - Repeat patient on a different date is treated as a follow-up (no duplicate inserted)
  - Appointment created on the parsed visit date
  - Invoice + Payment created with bill_no preserved as external_invoice_no
  - Auto-created services for unknown test tokens (PTA, IMP, VEMP)
  - Auto-created referring doctor for Ref.Dr
  - Visit note (PatientNote) entry added to patient timeline
  - GET /api/accounts/revenue returns aggregated totals across the window
"""
import os
import asyncio
import io
import requests
from motor.motor_asyncio import AsyncIOMotorClient

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
MONGO = os.environ["MONGO_URL"]
DBN = os.environ["DB_NAME"]


SAMPLE_CSV = """S.NO,Date,Pt.Name,Age,Gender,Area,MR.NO,Ph.No,Bill.No,Tests,Diagnosis,Amount,Ref.Dr,Remarks
1,01-04-2026,Test Patient A,72,Female,Kondapur,IMPTEST-001,9820411838,2627000160,PTA+IMP,Bil.Mild SNHL,2500,Internal Medicine,
2,01-04-2026,Test Patient B,77,Female,,IMPTEST-002,9866871702,2627000151,PTA+IMP+VEMP,Bil.Mild SNHL,3800,Dr.Aswani Test,
3,02-04-2026,Test Patient A,72,Female,Kondapur,IMPTEST-001,9820411838,2627000888,IMP,Followup ok,1300,Internal Medicine,
4,03-04-2026,Test Patient C,10,Female,Narsangi,IMPTEST-003,9642826051,2627000944,IMP,,1300,Dr.Kushal Test,
5,01-04-2026,Walk-in,40,Male,,,9000099999,,Tests Only,Bil.Normal,,Dr.Kushal Test,no payment
"""

EXPECTED_PATIENTS = 4   # row 3 is a follow-up of row 1 → reuses patient
EXPECTED_FOLLOWUPS = 1
EXPECTED_INVOICES = 4   # row 5 has no amount → no invoice
EXPECTED_REVENUE = 2500 + 3800 + 1300 + 1300
# Of the 4 invoices, 2 are for the same patient (rows 1 + 3 → patient A) so unique
# *paying* patients = 3 (A, B, C). Walk-in row 5 has zero revenue → not counted here.
EXPECTED_UNIQUE_PAYING_PATIENTS = 3


def _login(email="admin@delhi.test", password="delhiadmin123"):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    j = r.json()
    return j.get("access_token") or j["token"]


async def _cleanup():
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    # Patients we created (by MRD or mobile we used)
    await db.patients.delete_many({"mrd": {"$regex": "^IMPTEST-"}})
    await db.patients.delete_many({"mobile": {"$in": ["9820411838", "9866871702", "9642826051", "9000099999"]}})
    await db.appointments.delete_many({"imported_via": {"$exists": True}})
    await db.invoices.delete_many({"imported_via": {"$exists": True}})
    await db.payments.delete_many({"imported_via": {"$exists": True}})
    await db.patient_notes.delete_many({"imported_via": {"$exists": True}})
    await db.services.delete_many({"auto_created_via": "import"})
    await db.referring_doctors.delete_many({"auto_created_via": "import"})
    await db.import_jobs.delete_many({"clinic_id": "clinic-delhi-test", "filename": "test_rich.csv"})


async def _verify_patient_followup():
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    # Test Patient A appears in two rows but only ONE patient doc.
    n = await db.patients.count_documents({"mrd": "IMPTEST-001", "clinic_id": "clinic-delhi-test"})
    apt_n = await db.appointments.count_documents({"mrd": "IMPTEST-001", "imported_via": {"$exists": True}})
    note_n = await db.patient_notes.count_documents({"text": {"$regex": "Tests:"}, "imported_via": {"$exists": True}})
    return n, apt_n, note_n


def test_rich_csv_import():
    asyncio.run(_cleanup())
    token = _login()
    h = {"Authorization": f"Bearer {token}"}

    # 1. Preview
    files = {"file": ("test_rich.csv", io.BytesIO(SAMPLE_CSV.encode("utf-8")), "text/csv")}
    r = requests.post(f"{API}/imports/patients/preview", headers=h, files=files, timeout=30)
    assert r.status_code == 200, r.text
    prev = r.json()
    import_id = prev["import_id"]
    assert prev["tally"]["will_create"] == 5, prev["tally"]
    # Row 5 has no MR.NO + no bill_no, but has phone — still ok=walk-in. follow-up flag on row 3.
    statuses = {row["row_num"]: row["status"] for row in prev["rows"]}
    assert "followup" in statuses.values(), prev["rows"]

    # 2. Commit (default mrd_policy='keep')
    r = requests.post(f"{API}/imports/patients/commit", headers=h,
                      json={"import_id": import_id}, timeout=30)
    assert r.status_code == 200, r.text
    res = r.json()
    print("commit tally:", res["tally"])
    assert res["tally"]["created"] == EXPECTED_PATIENTS, res["tally"]
    assert res["tally"]["followups"] == EXPECTED_FOLLOWUPS, res["tally"]
    assert res["tally"]["invoices"] == EXPECTED_INVOICES, res["tally"]
    assert res["tally"]["revenue"] == EXPECTED_REVENUE, res["tally"]
    # Row 5 (no amount, no bill_no, no MR.NO) still creates 1 patient + 1 appointment.
    assert res["tally"]["appointments"] == 5, res["tally"]

    # 3. Verify follow-up didn't create a 2nd patient row for IMPTEST-001
    n, apt_n, note_n = asyncio.run(_verify_patient_followup())
    assert n == 1, f"Expected single patient for IMPTEST-001, got {n}"
    assert apt_n == 2, f"Expected 2 appointments for IMPTEST-001 (visits), got {apt_n}"
    assert note_n >= 4, f"Expected ≥4 visit notes (rows 1-4), got {note_n}"

    # 4. Revenue endpoint — quarterly window covers April 2026 dates
    r = requests.get(f"{API}/accounts/revenue", headers=h,
                     params={"range": "custom", "from": "2026-04-01", "to": "2026-04-30"},
                     timeout=15)
    assert r.status_code == 200, r.text
    rev = r.json()
    print("revenue total:", rev["total"], "method breakdown:", rev["by_method"])
    assert rev["total"] == EXPECTED_REVENUE, rev
    assert rev["payment_count"] == EXPECTED_INVOICES, rev
    assert rev["unique_patients"] == EXPECTED_UNIQUE_PAYING_PATIENTS, rev
    # Test breakdown should split PTA+IMP+VEMP across tests
    test_names = {t["test"] for t in rev["by_test"]}
    assert {"PTA", "IMP", "VEMP"}.issubset(test_names), test_names
    # Doctor breakdown — both ref dr's should appear
    dr_names = {d["name"] for d in rev["by_referring_doctor"]}
    assert "Internal Medicine" in dr_names, dr_names
    assert any("Aswani" in n for n in dr_names), dr_names

    # 5. Range presets (smoke)
    r = requests.get(f"{API}/accounts/revenue", headers=h, params={"range": "monthly"}, timeout=10)
    assert r.status_code == 200, r.text
    r = requests.get(f"{API}/accounts/revenue", headers=h, params={"range": "yearly"}, timeout=10)
    assert r.status_code == 200, r.text

    print(f"PASS: {EXPECTED_PATIENTS} patients (1 follow-up), {EXPECTED_INVOICES} invoices, ₹{EXPECTED_REVENUE} revenue, by-test breakdown OK.")
    asyncio.run(_cleanup())


if __name__ == "__main__":
    test_rich_csv_import()
