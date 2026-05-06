"""Phase B — .xlsx import, bad-extension rejection, and `imported_via`
surfacing on GET /appointments, /billing/invoices, /patient-notes.

Uses PHB- prefixed MRDs so cleanup is obvious.
"""
import os
import io
import uuid
import asyncio
import requests
from openpyxl import Workbook
from motor.motor_asyncio import AsyncIOMotorClient
import pytest

API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
MONGO = os.environ["MONGO_URL"]
DBN = os.environ["DB_NAME"]


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "admin@delhi.test", "password": "delhiadmin123"},
        timeout=15,
    )
    r.raise_for_status()
    j = r.json()
    return j.get("access_token") or j["token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


RUN = uuid.uuid4().hex[:6].upper()
MRD_A = f"PHB-{RUN}-A"
MRD_B = f"PHB-{RUN}-B"


async def _cleanup():
    cli = AsyncIOMotorClient(MONGO)
    db = cli[DBN]
    # kill patients matching PHB-<this run>
    await db.patients.delete_many({"mrd": {"$regex": f"^PHB-{RUN}-"}})
    await db.appointments.delete_many({"imported_via": {"$regex": "^imp_"}, "source": "bulk_import"})
    await db.invoices.delete_many({"imported_via": {"$regex": "^imp_"}})
    await db.payments.delete_many({"imported_via": {"$regex": "^imp_"}})
    await db.patient_notes.delete_many({"imported_via": {"$regex": "^imp_"}})
    await db.import_jobs.delete_many({"clinic_id": "clinic-delhi-test", "filename": {"$regex": "^phb_"}})
    cli.close()


def _xlsx_bytes() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(
        [
            "S.NO", "Date", "Pt.Name", "Age", "Gender", "Area", "MR.NO",
            "Ph.No", "Bill.No", "Tests", "Diagnosis", "Amount", "Ref.Dr", "Remarks",
        ]
    )
    # Patient A: new + follow-up on different date
    ws.append([1, "05-04-2026", "PHB Patient A", 44, "Female", "Indr", MRD_A, 9811110001, "PHB-001", "PTA+IMP", "Bil.Mild", 2500, "Dr.Alpha", ""])
    ws.append([2, "12-04-2026", "PHB Patient A", 44, "Female", "Indr", MRD_A, 9811110001, "PHB-002", "PTA",     "F/U",       900, "Dr.Alpha", ""])
    # Patient B: new only
    ws.append([3, "05-04-2026", "PHB Patient B", 28, "Male",   "HSR",  MRD_B, 9811110002, "PHB-003", "IMP",     "Normal",   1400, "Dr.Beta", ""])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


@pytest.fixture(scope="module", autouse=True)
def _clean_around():
    asyncio.run(_cleanup())
    yield
    asyncio.run(_cleanup())


# --- Feature 1: xlsx preview with follow-up detection --------------------
def test_xlsx_preview_accepts_openxmlformats(h):
    files = {
        "file": (
            "phb_excel.xlsx",
            _xlsx_bytes(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    r = requests.post(f"{API}/imports/patients/preview", headers=h, files=files, timeout=30)
    assert r.status_code == 200, r.text
    prev = r.json()
    assert "import_id" in prev and "rows" in prev and "tally" in prev
    assert prev["tally"]["will_create"] == 3  # 2 new + 1 followup invoice row
    statuses = [row["status"] for row in prev["rows"]]
    # Backend emits 'ok' for new rows and 'followup' for same-MRD-later-date rows
    assert statuses.count("ok") == 2, statuses
    assert statuses.count("followup") == 1, statuses
    # followup row should refer to same mrd
    fu = [row for row in prev["rows"] if row["status"] == "followup"][0]
    assert fu.get("mrd") == MRD_A or MRD_A in str(fu)


# --- Feature 2: commit xlsx and verify side-effects ----------------------
def test_xlsx_commit_creates_expected_entities(h):
    files = {
        "file": (
            "phb_excel.xlsx",
            _xlsx_bytes(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    prev = requests.post(f"{API}/imports/patients/preview", headers=h, files=files, timeout=30).json()
    r = requests.post(
        f"{API}/imports/patients/commit", headers=h,
        json={"import_id": prev["import_id"]}, timeout=30,
    )
    assert r.status_code == 200, r.text
    t = r.json()["tally"]
    assert t["created"] == 2
    assert t["followups"] == 1
    assert t["invoices"] == 3
    assert t["revenue"] == 2500 + 900 + 1400


# --- Feature 3: reject unsupported extensions ----------------------------
def test_rejects_pdf_extension(h):
    files = {"file": ("fake.pdf", b"%PDF-1.4 fake", "application/pdf")}
    r = requests.post(f"{API}/imports/patients/preview", headers=h, files=files, timeout=15)
    assert r.status_code == 400, f"expected 400 for .pdf, got {r.status_code}: {r.text[:200]}"


def test_rejects_txt_extension(h):
    files = {"file": ("notes.txt", b"col1,col2\na,b\n", "text/plain")}
    r = requests.post(f"{API}/imports/patients/preview", headers=h, files=files, timeout=15)
    assert r.status_code == 400


# --- Feature 4: imported_via surfaces on the list endpoints --------------
def test_imported_via_surfaces_on_api_responses(h):
    """After committing, find the PHB Patient A and verify `imported_via`
    is returned (not stripped to None) on appointment/invoice/note GETs."""
    # First ensure data exists — commit again idempotently using a fresh preview
    files = {
        "file": (
            "phb_excel.xlsx",
            _xlsx_bytes(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    prev = requests.post(f"{API}/imports/patients/preview", headers=h, files=files, timeout=30).json()
    # Commit only if the first commit test has already deleted — otherwise prev rows
    # will be all followups/duplicates. But even in that case the patient exists.
    commit = requests.post(
        f"{API}/imports/patients/commit", headers=h,
        json={"import_id": prev["import_id"]}, timeout=30,
    )
    assert commit.status_code == 200, commit.text

    # Fetch patient A
    pat = requests.get(f"{API}/patients", headers=h, params={"search": MRD_A}, timeout=15)
    assert pat.status_code == 200, pat.text
    rows = pat.json()
    # search may be paginated — try /patients/by-mrd or first match
    matched = [p for p in rows if p.get("mrd") == MRD_A]
    assert matched, f"patient {MRD_A} not found in search; rows={rows[:2]}"
    pid = matched[0]["patient_id"]

    # GET appointments — imported_via must surface
    appts = requests.get(f"{API}/appointments", headers=h, params={"patient_id": pid}, timeout=15)
    assert appts.status_code == 200, appts.text
    appt_list = appts.json()
    imported_appts = [a for a in appt_list if a.get("imported_via")]
    assert imported_appts, (
        f"No appointment returned with `imported_via` set! "
        f"appointments={appt_list[:3]} — the Appointment model strip may be back."
    )
    assert imported_appts[0]["imported_via"].startswith("imp_"), imported_appts[0]

    # GET invoices — imported_via + external_invoice_no must surface
    inv = requests.get(f"{API}/billing/invoices", headers=h, params={"patient_id": pid}, timeout=15)
    assert inv.status_code == 200, inv.text
    inv_list = inv.json()
    imported_inv = [i for i in inv_list if i.get("imported_via")]
    assert imported_inv, f"No invoice returned with `imported_via`! invoices={inv_list[:2]}"
    # external_invoice_no should map the original CSV Bill.No
    assert any(i.get("external_invoice_no", "").startswith("PHB-") for i in imported_inv), (
        f"external_invoice_no missing on imported invoices: {imported_inv[:2]}"
    )

    # GET patient-notes — imported_via + visit_date must surface
    notes = requests.get(f"{API}/patient-notes", headers=h, params={"patient_id": pid}, timeout=15)
    assert notes.status_code == 200, notes.text
    note_list = notes.json()
    imported_notes = [n for n in note_list if n.get("imported_via")]
    assert imported_notes, f"No patient-note returned with `imported_via`! notes={note_list[:2]}"
    assert any(n.get("visit_date") for n in imported_notes), (
        f"visit_date missing on imported notes: {imported_notes[:2]}"
    )
