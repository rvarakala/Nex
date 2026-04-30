"""Bulk patient import — CSV upload for new clinics migrating from another system.

v1 scope:
  * Patients only (demographics + contact + light triage).
  * CSV files only.
  * Preserves existing MRDs from the source system if provided; otherwise
    auto-generates one in the clinic's normal sequence.
  * Skips rows whose mobile or MRD already exists in the target clinic.
  * Two-step preview/commit so the operator sees a tally + per-row diagnosis
    before any writes happen.

Routes (all require clinic_owner / super_admin):
  GET  /api/imports/patients/template          — Download CSV template
  POST /api/imports/patients/preview           — Validate uploaded CSV
  POST /api/imports/patients/commit            — Persist preview by import_id
"""
import csv
import io
import re
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from auth import require_roles
from database import get_db
from models import Patient
from utils.serde import serialize_datetime


router = APIRouter(prefix="/api/imports", tags=["imports"])


# Canonical column order used by the template + parser. Aliases below let the
# parser accept common variants without forcing the operator to rename headers.
TEMPLATE_HEADERS = [
    "name", "age", "gender", "mobile", "existing_mrd",
    "dob", "email", "alternate_mobile", "address", "city",
    "state", "pincode", "occupation", "chief_complaint",
    "referral_source", "notes",
]

HEADER_ALIASES = {
    "patient_name": "name", "full_name": "name",
    "phone": "mobile", "phone_number": "mobile", "mobile_number": "mobile",
    "sex": "gender",
    "mrd": "existing_mrd", "mrn": "existing_mrd", "old_mrd": "existing_mrd", "patient_id": "existing_mrd",
    "date_of_birth": "dob", "birth_date": "dob",
    "alt_mobile": "alternate_mobile", "secondary_phone": "alternate_mobile",
    "address1": "address", "street_address": "address",
    "zip": "pincode", "zipcode": "pincode", "postal_code": "pincode",
    "complaint": "chief_complaint",
    "source": "referral_source", "lead_source": "referral_source",
}

GENDER_MAP = {
    "m": "Male", "male": "Male",
    "f": "Female", "female": "Female",
    "o": "Other", "other": "Other", "third": "Other",
}

MAX_ROWS = 5000  # Hard ceiling per upload — protects the API from a 1M-row dump.
PREVIEW_TTL_HOURS = 2  # Stored preview blobs are pruned after this.


# ---------- helpers --------------------------------------------------------

def _normalise_header(h: str) -> str:
    h = (h or "").strip().lower().replace(" ", "_").replace("-", "_")
    return HEADER_ALIASES.get(h, h)


def _parse_age(value: str, dob: Optional[str]) -> Optional[int]:
    if value:
        try:
            n = int(float(str(value).strip()))
            if 0 <= n <= 130:
                return n
        except (ValueError, TypeError):
            pass
    if dob:
        try:
            d = datetime.fromisoformat(dob)
            yrs = (datetime.utcnow() - d).days // 365
            if 0 <= yrs <= 130:
                return yrs
        except (ValueError, TypeError):
            pass
    return None


def _parse_gender(value: str) -> Optional[str]:
    v = (value or "").strip().lower()
    return GENDER_MAP.get(v)


_MOBILE_RE = re.compile(r"\D+")


def _normalise_mobile(value: str) -> Optional[str]:
    if not value:
        return None
    digits = _MOBILE_RE.sub("", str(value))
    # Strip leading country code 91 if 12 digits (`919812345678` → `9812345678`).
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) == 10:
        return digits
    if 7 <= len(digits) <= 15:  # Permissive — international landlines etc.
        return digits
    return None


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(value: str) -> Optional[str]:
    v = (value or "").strip()
    return v if v and _EMAIL_RE.match(v) else None


def _parse_dob(value: str) -> Optional[str]:
    v = (value or "").strip()
    if not v:
        return None
    # Accept ISO yyyy-mm-dd, dd-mm-yyyy, dd/mm/yyyy.
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(v, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


async def _next_mrd(db, clinic_id: str, mrd_prefix: str) -> str:
    """Mirror of patients.py — same counter, so generated MRDs slot into the
    clinic's existing sequence."""
    now = datetime.utcnow()
    counter = await db.counters.find_one_and_update(
        {"_id": f"mrd:{clinic_id}:{now.year}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = counter["seq"] if counter else 1
    return f"{mrd_prefix}-{now.year}-{seq:06d}"


# ---------- template download ----------------------------------------------

@router.get("/patients/template")
async def download_patients_template(
    user=Depends(require_roles("clinic_owner", "super_admin")),
):
    """Returns a CSV with header row + 2 example rows so the operator can fill it in."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(TEMPLATE_HEADERS)
    writer.writerow([
        "Asha Iyer", "62", "Female", "9876543210", "OLD-1024",
        "1962-04-12", "asha@example.com", "", "12 Marine Drive", "Mumbai",
        "Maharashtra", "400001", "Retired Teacher", "Reduced hearing both ears",
        "Walk-in", "Long-term patient since 2019",
    ])
    writer.writerow([
        "Rahul Singh", "34", "Male", "9123456780", "",
        "", "", "", "", "Bengaluru",
        "Karnataka", "560001", "Software Engineer", "",
        "Doctor", "",
    ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audinexa_patients_template.csv"'},
    )


# ---------- preview --------------------------------------------------------

@router.post("/patients/preview")
async def preview_patients(
    file: UploadFile = File(...),
    user=Depends(require_roles("clinic_owner", "super_admin")),
    db=Depends(get_db),
):
    """Parses + validates the uploaded CSV against the current clinic's data.

    Returns:
      {
        import_id: "...",
        tally: { total, will_create, will_skip, will_fail },
        rows: [ { row_num, name, mobile, mrd, status, errors:[..] }, ... ],
        expires_at: iso,
      }

    No data is written to `patients` yet — the parsed payload is stashed in
    `import_jobs` keyed by import_id, ready to be committed in a second call.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Please upload a .csv file (Excel users: File → Save As → CSV).")

    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(400, "File too large — please split into batches of <5MB.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = raw.decode("latin-1")
        except UnicodeDecodeError:
            raise HTTPException(400, "Could not decode file — please save as UTF-8 CSV.")

    reader = csv.DictReader(io.StringIO(text))
    raw_headers = reader.fieldnames or []
    if not raw_headers:
        raise HTTPException(400, "CSV is empty or missing a header row.")

    # Map raw headers to canonical names, keep track of which canonical fields
    # were present so per-row lookups are O(1).
    header_map = {h: _normalise_header(h) for h in raw_headers}
    canonical_present = set(header_map.values())
    missing_required = [c for c in ("name",) if c not in canonical_present]
    if missing_required:
        raise HTTPException(
            400,
            f"Missing required column(s): {', '.join(missing_required)}. "
            f"Download the template for the expected layout.",
        )

    # Existing data for duplicate detection — pulled in one query each.
    existing_mobiles: set[str] = set()
    existing_mrds: set[str] = set()
    async for doc in db.patients.find(
        {"clinic_id": user["clinic_id"]},
        {"_id": 0, "mobile": 1, "mrd": 1},
    ):
        if doc.get("mobile"):
            m = _normalise_mobile(doc["mobile"])
            if m:
                existing_mobiles.add(m)
        if doc.get("mrd"):
            existing_mrds.add(str(doc["mrd"]).strip().upper())

    rows_out: list[dict] = []
    parsed_for_commit: list[dict] = []
    seen_mobiles_in_file: set[str] = set()
    seen_mrds_in_file: set[str] = set()
    counts = {"will_create": 0, "will_skip": 0, "will_fail": 0}

    for idx, raw_row in enumerate(reader, start=2):  # Start at 2 — row 1 is header.
        if idx - 1 > MAX_ROWS:
            raise HTTPException(
                400,
                f"Files larger than {MAX_ROWS} rows aren't supported in a single upload — please split.",
            )

        # Re-key row using canonical headers.
        row = {header_map.get(k, k): (v.strip() if isinstance(v, str) else v) for k, v in raw_row.items()}
        # Treat fully-blank lines as a soft EOF (Excel often appends them).
        if not any((v or "").strip() for v in row.values() if isinstance(v, str)):
            continue

        errors: list[str] = []
        name = (row.get("name") or "").strip()
        if not name:
            errors.append("Name is required")

        gender = _parse_gender(row.get("gender", ""))
        if not gender:
            errors.append("Gender must be Male / Female / Other")

        dob = _parse_dob(row.get("dob", ""))
        age = _parse_age(row.get("age", ""), dob)
        if age is None:
            errors.append("Age (or DOB in YYYY-MM-DD) is required")

        mobile = _normalise_mobile(row.get("mobile", ""))
        email = _validate_email(row.get("email", ""))
        if not mobile and not email:
            errors.append("At least one contact (mobile or email) is required")

        existing_mrd = (row.get("existing_mrd") or "").strip().upper() or None

        # Duplicate detection — within file + against DB.
        dup_reason = None
        if existing_mrd:
            if existing_mrd in existing_mrds or existing_mrd in seen_mrds_in_file:
                dup_reason = f"MRD {existing_mrd} already exists"
        if not dup_reason and mobile:
            if mobile in existing_mobiles or mobile in seen_mobiles_in_file:
                dup_reason = f"Mobile {mobile} already exists"

        if errors:
            status = "fail"
            counts["will_fail"] += 1
        elif dup_reason:
            status = "skip"
            counts["will_skip"] += 1
            errors = [dup_reason]
        else:
            status = "ok"
            counts["will_create"] += 1
            if mobile:
                seen_mobiles_in_file.add(mobile)
            if existing_mrd:
                seen_mrds_in_file.add(existing_mrd)

        rows_out.append({
            "row_num": idx,
            "name": name or "(missing)",
            "mobile": mobile or "",
            "mrd": existing_mrd or "",
            "status": status,
            "errors": errors,
        })

        if status == "ok":
            parsed_for_commit.append({
                "name": name,
                "age": age,
                "gender": gender,
                "dob": dob,
                "mobile": mobile,
                "alternate_mobile": _normalise_mobile(row.get("alternate_mobile", "")),
                "email": email,
                "address": row.get("address") or None,
                "city": row.get("city") or None,
                "state": row.get("state") or None,
                "pincode": (row.get("pincode") or "").strip() or None,
                "occupation": row.get("occupation") or None,
                "chief_complaint": row.get("chief_complaint") or None,
                "referral_source": row.get("referral_source") or None,
                "notes": row.get("notes") or None,
                "existing_mrd": existing_mrd,
            })

    if not rows_out:
        raise HTTPException(400, "CSV had no data rows.")

    import_id = f"imp_{uuid.uuid4().hex[:16]}"
    expires_at = datetime.utcnow() + timedelta(hours=PREVIEW_TTL_HOURS)
    await db.import_jobs.insert_one(serialize_datetime({
        "import_id": import_id,
        "clinic_id": user["clinic_id"],
        "uploaded_by": user["user_id"],
        "filename": file.filename,
        "tally": {"total": len(rows_out), **counts},
        "rows": parsed_for_commit,           # Only OK rows; skip/fail are not persisted to DB.
        "preview_rows": rows_out,            # Full preview stored for audit + UI.
        "status": "preview",
        "created_at": datetime.utcnow(),
        "expires_at": expires_at,
    }))

    return {
        "import_id": import_id,
        "tally": {"total": len(rows_out), **counts},
        "rows": rows_out,
        "expires_at": expires_at.isoformat(),
    }


# ---------- commit ---------------------------------------------------------

@router.post("/patients/commit")
async def commit_patients(
    payload: dict,
    user=Depends(require_roles("clinic_owner", "super_admin")),
    db=Depends(get_db),
):
    """Commits a previously-previewed CSV by import_id. Idempotent — if the
    job is already committed, a second call returns the original tally without
    duplicate inserts."""
    import_id = (payload or {}).get("import_id")
    if not import_id:
        raise HTTPException(400, "import_id is required")

    job = await db.import_jobs.find_one(
        {"import_id": import_id, "clinic_id": user["clinic_id"]}, {"_id": 0}
    )
    if not job:
        raise HTTPException(404, "Import preview not found or expired. Please re-upload.")
    if job["status"] == "committed":
        return {
            "import_id": import_id,
            "tally": job.get("commit_tally", job.get("tally", {})),
            "already_committed": True,
        }

    clinic = await db.clinics.find_one({"clinic_id": user["clinic_id"]}, {"_id": 0}) or {}
    mrd_prefix = clinic.get("mrd_prefix", "ACS")

    created = 0
    failed = 0
    failure_details: list[dict] = []
    docs_to_insert: list[dict] = []

    for r in job.get("rows", []):
        try:
            existing_mrd = r.pop("existing_mrd", None)
            mrd = existing_mrd if existing_mrd else await _next_mrd(db, user["clinic_id"], mrd_prefix)
            patient_obj = Patient(
                **r,
                clinic_id=user["clinic_id"],
                mrd=mrd,
            )
            doc = serialize_datetime(patient_obj.model_dump())
            docs_to_insert.append(doc)
            created += 1
        except Exception as exc:
            failed += 1
            failure_details.append({"row": r.get("name"), "error": str(exc)})

    if docs_to_insert:
        await db.patients.insert_many(docs_to_insert)

    commit_tally = {
        "created": created,
        "failed": failed,
        "skipped": job.get("tally", {}).get("will_skip", 0),
    }

    await db.import_jobs.update_one(
        {"import_id": import_id},
        {"$set": serialize_datetime({
            "status": "committed",
            "committed_at": datetime.utcnow(),
            "committed_by": user["user_id"],
            "commit_tally": commit_tally,
            "failure_details": failure_details,
        })},
    )
    await db.activity_logs.insert_one(serialize_datetime({
        "clinic_id": user["clinic_id"],
        "user_id": user["user_id"],
        "action": "patient.bulk_import",
        "import_id": import_id,
        "tally": commit_tally,
        "at": datetime.utcnow(),
    }))

    return {
        "import_id": import_id,
        "tally": commit_tally,
        "failure_details": failure_details,
        "already_committed": False,
    }


# ---------- recent imports (audit panel) -----------------------------------

@router.get("/patients/recent")
async def list_recent_imports(
    user=Depends(require_roles("clinic_owner", "super_admin")),
    db=Depends(get_db),
):
    """Last 20 import jobs for the clinic — drives the 'history' strip in the UI."""
    cursor = db.import_jobs.find(
        {"clinic_id": user["clinic_id"]},
        {"_id": 0, "import_id": 1, "filename": 1, "tally": 1, "commit_tally": 1,
         "status": 1, "created_at": 1, "committed_at": 1},
    ).sort("created_at", -1).limit(20)
    return [doc async for doc in cursor]
