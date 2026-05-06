"""Verify .xlsx upload path matches CSV behaviour. Same minimal data as the
CSV test, but uploaded as a real Excel file via openpyxl.

NOTE: Cleanup matches the rich CSV test pattern.
"""
import os
import io
import asyncio
import requests
from openpyxl import Workbook
from motor.motor_asyncio import AsyncIOMotorClient

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
MONGO = os.environ["MONGO_URL"]
DBN = os.environ["DB_NAME"]


def _login():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@delhi.test", "password": "delhiadmin123"}, timeout=15)
    r.raise_for_status()
    return r.json().get("access_token") or r.json()["token"]


def _build_xlsx_bytes() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(["S.NO", "Date", "Pt.Name", "Age", "Gender", "Area", "MR.NO",
               "Ph.No", "Bill.No", "Tests", "Diagnosis", "Amount", "Ref.Dr", "Remarks"])
    rows = [
        [1, "01-04-2026", "Excel Pat A", 50, "Female", "HSR", "XLS-100", 9988770011, "BX-101", "PTA+IMP", "Bil.Mild", 2200, "Dr.X", ""],
        [2, "02-04-2026", "Excel Pat A", 50, "Female", "HSR", "XLS-100", 9988770011, "BX-102", "IMP",     "F/U",      1200, "Dr.X", ""],
        [3, "01-04-2026", "Excel Pat B", 33, "Male",   "Indr","XLS-101", 9988770099, "BX-103", "PTA",     "Normal",   1800, "Dr.Y", ""],
    ]
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


async def _cleanup():
    cli = AsyncIOMotorClient(MONGO); db = cli[DBN]
    await db.patients.delete_many({"mrd": {"$regex": "^XLS-"}})
    await db.appointments.delete_many({"imported_via": {"$exists": True}})
    await db.invoices.delete_many({"imported_via": {"$exists": True}})
    await db.payments.delete_many({"imported_via": {"$exists": True}})
    await db.patient_notes.delete_many({"imported_via": {"$exists": True}})
    await db.services.delete_many({"auto_created_via": "import"})
    await db.referring_doctors.delete_many({"auto_created_via": "import"})
    await db.import_jobs.delete_many({"clinic_id": "clinic-delhi-test", "filename": "test_excel.xlsx"})


def test_xlsx_import():
    asyncio.run(_cleanup())
    token = _login()
    h = {"Authorization": f"Bearer {token}"}

    xlsx_bytes = _build_xlsx_bytes()
    files = {"file": ("test_excel.xlsx", xlsx_bytes,
                       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}

    r = requests.post(f"{API}/imports/patients/preview", headers=h, files=files, timeout=30)
    assert r.status_code == 200, r.text
    prev = r.json()
    assert prev["tally"]["will_create"] == 3, prev["tally"]
    statuses = [row["status"] for row in prev["rows"]]
    assert "followup" in statuses, prev["rows"]

    # Commit
    r = requests.post(f"{API}/imports/patients/commit", headers=h,
                      json={"import_id": prev["import_id"]}, timeout=30)
    assert r.status_code == 200, r.text
    t = r.json()["tally"]
    assert t["created"] == 2, t
    assert t["followups"] == 1, t
    assert t["invoices"] == 3, t
    assert t["revenue"] == 2200 + 1200 + 1800, t
    print(f"PASS: xlsx import — {t['created']} new + {t['followups']} f/u, ₹{t['revenue']} revenue.")
    asyncio.run(_cleanup())


if __name__ == "__main__":
    test_xlsx_import()
