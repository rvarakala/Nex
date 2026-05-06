"""ISO 27001 / DPDP Policy Pack endpoint + Sign & Adopt workflow.

Serves the markdown templates under `/app/docs/compliance/` after substituting
clinic-specific placeholders (`{{clinic_name}}`, `{{owner_name}}`, ...) so each
clinic gets an audit-ready document personalised to their tenant.

Public surface (auth required for tenant-specific):
  * GET  /api/legal/policies                      — list catalogue (id, title, ord)
  * GET  /api/legal/policies/{policy_id}          — rendered markdown for caller's clinic
  * GET  /api/legal/policies/{policy_id}/pdf      — same rendered, returned as PDF
  * GET  /api/legal/policies/{policy_id}/raw      — un-substituted template (founder only)
  * POST /api/legal/policies/{policy_id}/adopt    — clinic_owner e-signs the policy
  * GET  /api/legal/adoptions                     — adoption ledger for the caller's clinic
  * GET  /api/legal/adoptions/{adoption_id}/pdf   — download the signed snapshot
"""
from __future__ import annotations

import hashlib
import io
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from uuid import uuid4

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db


router = APIRouter(prefix="/api/legal", tags=["legal"])
log = logging.getLogger("audinexa.legal")

POLICY_DIR = Path(__file__).resolve().parent.parent / "docs" / "compliance"
# routers/legal.py -> /app/backend/routers/legal.py
# parent.parent = /app/backend  →  /app/backend/docs/compliance
# Docs ship inside backend/ so they're guaranteed-present in any deploy artifact.

POLICIES = [
    {"id": "01_information_security",      "title": "Information Security Policy",            "ord": 1, "iso": "ISO 27001 A.5", "code": "ISP-01"},
    {"id": "02_access_control",            "title": "Access Control Policy",                  "ord": 2, "iso": "ISO 27001 A.5.15", "code": "ACP-02"},
    {"id": "03_data_protection_privacy",   "title": "Data Protection & Privacy Policy",       "ord": 3, "iso": "DPDP Act 2023", "code": "DPP-03"},
    {"id": "04_incident_response",         "title": "Incident Response & Breach Notification","ord": 4, "iso": "ISO 27001 A.5.24", "code": "IRP-04"},
    {"id": "05_data_retention_deletion",   "title": "Data Retention & Deletion Policy",       "ord": 5, "iso": "DPDP §8(7)", "code": "DRP-05"},
    {"id": "06_vendor_sub_processors",     "title": "Vendor / Sub-processor Register",        "ord": 6, "iso": "ISO 27001 A.5.19", "code": "VSR-06"},
    {"id": "07_business_continuity",       "title": "Business Continuity & Backup Policy",    "ord": 7, "iso": "ISO 22301", "code": "BCP-07"},
]
_POLICY_IDS = {p["id"] for p in POLICIES}


async def _build_context(db, user) -> dict[str, str]:
    """Load all `{{placeholder}}` substitutions for the caller's clinic."""
    clinic = await db.clinics.find_one(
        {"clinic_id": user["clinic_id"]}, {"_id": 0}
    ) or {}
    branches = await db.branches.count_documents({"clinic_id": user["clinic_id"]})
    if branches == 0:
        # Branches may live as an embedded array on the clinic doc instead.
        branches = len(clinic.get("branches") or []) or 1

    today = datetime.now(timezone.utc).date().isoformat()
    return {
        "clinic_id":       user["clinic_id"],
        "clinic_name":     clinic.get("name") or clinic.get("clinic_name") or user["clinic_id"],
        "owner_name":      clinic.get("owner_name") or user.get("name") or "(Clinic Owner)",
        "dpo_name":        clinic.get("dpo_name") or clinic.get("owner_name") or user.get("name") or "(Data Protection Officer)",
        "dpo_email":       clinic.get("dpo_email") or clinic.get("owner_email") or user.get("email") or "(set via Settings → Compliance)",
        "clinic_phone":    clinic.get("phone") or "(set via Settings → Clinic)",
        "branch_count":    str(branches),
        "effective_date":  today,
        "public_legal_url": "https://audinexa.com/legal",
    }


def _render_template(text: str, ctx: dict[str, str]) -> str:
    def _sub(m):
        key = m.group(1).strip()
        return str(ctx.get(key, m.group(0)))  # leave unknown placeholders as-is
    return re.sub(r"\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}", _sub, text)


def _read_template(policy_id: str) -> str:
    if policy_id not in _POLICY_IDS:
        raise HTTPException(404, f"Unknown policy '{policy_id}'")
    fp = POLICY_DIR / f"{policy_id}.md"
    if not fp.exists():
        log.error(f"Policy template missing: {fp}")
        raise HTTPException(500, "Policy template missing on server. Contact support.")
    return fp.read_text(encoding="utf-8")


@router.get("/policies")
async def list_policies(user=Depends(get_current_user)):  # noqa: ARG001 — auth gate only
    return {
        "policies": POLICIES,
        "count": len(POLICIES),
        "iso_27001_aligned": True,
        "dpdp_aligned": True,
    }


@router.get("/policies/{policy_id}")
async def get_policy(
    policy_id: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    text = _read_template(policy_id)
    ctx = await _build_context(db, user)
    rendered = _render_template(text, ctx)
    meta = next((p for p in POLICIES if p["id"] == policy_id), {})
    return {
        "policy_id": policy_id,
        "title": meta.get("title"),
        "code": meta.get("code"),
        "iso": meta.get("iso"),
        "markdown": rendered,
        "context": ctx,            # surfaced so the UI can show "Personalised for X" banners
        "rendered_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/policies/{policy_id}/raw")
async def get_policy_raw(
    policy_id: str,
    user=Depends(get_current_user),
):
    """Return the un-substituted template — useful for compliance auditors."""
    if user.get("role") not in {"founder", "super_admin", "clinic_owner"}:
        raise HTTPException(403, "Only founder / super_admin / clinic_owner may view raw templates")
    text = _read_template(policy_id)
    return {
        "policy_id": policy_id,
        "markdown_raw": text,
        "placeholders": sorted(set(re.findall(r"\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}", text))),
    }


@router.get("/policies/{policy_id}/pdf")
async def get_policy_pdf(
    policy_id: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    text = _read_template(policy_id)
    ctx = await _build_context(db, user)
    rendered = _render_template(text, ctx)
    meta = next((p for p in POLICIES if p["id"] == policy_id), {})
    pdf_bytes = _build_policy_pdf(rendered, ctx, meta, signature=None)
    headers = {"Content-Disposition": f'inline; filename="{policy_id}.pdf"'}
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)


def _build_policy_pdf(rendered: str, ctx: dict, meta: dict, signature: Optional[dict] = None) -> bytes:
    """Render markdown → A4 PDF. If `signature` is provided, append a final
    'Signed & Adopted' page with the signer's typed name, timestamp, IP, and a
    SHA-256 hash of the markdown (for tamper-evidence)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, PageBreak, Preformatted, Table, TableStyle,
    )
    from reportlab.lib import colors

    title = meta.get("title", "Policy")
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=title, author=ctx["clinic_name"],
    )
    base = getSampleStyleSheet()
    style_h1   = ParagraphStyle("h1", parent=base["Heading1"], fontSize=16, spaceAfter=8, textColor="#0f172a")
    style_h2   = ParagraphStyle("h2", parent=base["Heading2"], fontSize=12, spaceAfter=6, textColor="#1e293b")
    style_h3   = ParagraphStyle("h3", parent=base["Heading3"], fontSize=11, spaceAfter=4, textColor="#334155")
    style_body = ParagraphStyle("body", parent=base["BodyText"], fontSize=9.5, leading=13, spaceAfter=4)
    style_meta = ParagraphStyle("meta", parent=base["BodyText"], fontSize=8.5, leading=11, textColor="#64748b", spaceAfter=10)

    story: list = []
    story.append(Paragraph(f"<b>{title}</b>", style_h1))
    story.append(Paragraph(
        f"{ctx['clinic_name']} — {meta.get('code', '')} · "
        f"Effective {ctx['effective_date']} · Aligned to {meta.get('iso','')}",
        style_meta,
    ))
    if signature:
        story.append(Paragraph(
            f"<b>SIGNED &amp; ADOPTED</b> — Adoption {signature['adoption_id']}",
            ParagraphStyle("badge", parent=style_meta, textColor="#059669", fontSize=9),
        ))

    in_code = False; code_buf: list[str] = []
    in_table = False; table_buf: list[str] = []

    def _flush_code():
        nonlocal code_buf
        if code_buf:
            story.append(Preformatted("\n".join(code_buf), style_body))
            story.append(Spacer(1, 4))
            code_buf = []

    def _flush_table():
        nonlocal table_buf
        if table_buf:
            story.append(Preformatted("\n".join(table_buf), style_body))
            story.append(Spacer(1, 4))
            table_buf = []

    for line in rendered.splitlines():
        if line.startswith("```"):
            in_code = not in_code
            if not in_code:
                _flush_code()
            continue
        if in_code:
            code_buf.append(line); continue
        if line.lstrip().startswith("|"):
            in_table = True; table_buf.append(line); continue
        if in_table:
            in_table = False; _flush_table()
        if line.startswith("# "):
            story.append(Paragraph(_escape(line[2:]), style_h1))
        elif line.startswith("## "):
            story.append(Paragraph(_escape(line[3:]), style_h2))
        elif line.startswith("### "):
            story.append(Paragraph(_escape(line[4:]), style_h3))
        elif line.startswith("- "):
            story.append(Paragraph("• " + _escape(line[2:]), style_body))
        elif line.startswith("---"):
            story.append(Spacer(1, 6))
        elif line.strip() == "":
            story.append(Spacer(1, 3))
        else:
            story.append(Paragraph(_escape(line), style_body))
    _flush_code(); _flush_table()

    # Signature page — appended only when adopting.
    if signature:
        story.append(PageBreak())
        story.append(Paragraph("<b>Signature &amp; Adoption Record</b>", style_h1))
        story.append(Paragraph(
            "This page is automatically generated by AUDINEXA at the moment of "
            "adoption. The hash below is computed against the personalised "
            "policy markdown — any modification to the policy text will produce "
            "a different hash, providing tamper-evidence for compliance audits.",
            style_body,
        ))
        story.append(Spacer(1, 8))
        rows = [
            ["Adoption ID",       signature["adoption_id"]],
            ["Policy",            f"{meta.get('code', '')} — {title}"],
            ["Clinic",            f"{ctx['clinic_name']} ({ctx['clinic_id']})"],
            ["Signed by",         f"{signature['typed_name']} (user_id: {signature['user_id']})"],
            ["Role",              signature["role"]],
            ["Signed at (UTC)",   signature["signed_at"]],
            ["IP address",        signature["ip_address"] or "—"],
            ["User agent",        (signature.get("user_agent") or "—")[:80]],
            ["Markdown SHA-256",  signature["markdown_hash"]],
            ["Acknowledgement",   "I have read, understood, and adopt this policy on behalf of the Clinic."],
        ]
        tbl = Table(rows, colWidths=[42 * mm, 130 * mm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND",  (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
            ("TEXTCOLOR",   (0, 0), (0, -1), colors.HexColor("#334155")),
            ("FONTSIZE",    (0, 0), (-1, -1), 9),
            ("FONTNAME",    (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTNAME",    (1, 0), (1, -1), "Courier"),
            ("VALIGN",      (0, 0), (-1, -1), "TOP"),
            ("INNERGRID",   (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")),
            ("BOX",         (0, 0), (-1, -1), 0.5,  colors.HexColor("#94a3b8")),
            ("LEFTPADDING",  (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING",   (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
        ]))
        story.append(tbl)
        story.append(Spacer(1, 12))
        story.append(Paragraph(
            "<i>Typed signature stands as a legally-binding e-signature under "
            "§5 of the Information Technology Act, 2000 and §10A of the IT "
            "(Amendment) Act, 2008. Any party may verify this PDF's "
            "authenticity by recomputing SHA-256 of the policy markdown and "
            "comparing to the value above.</i>",
            style_meta,
        ))

    doc.build(story)
    return buf.getvalue()


# ==================== SIGN & ADOPT WORKFLOW ===========================
class AdoptRequest(BaseModel):
    typed_name: str = Field(..., min_length=2, max_length=120)
    acknowledge: bool = Field(default=False, description="Must be true to proceed.")


def _markdown_hash(rendered: str) -> str:
    """SHA-256 of normalised markdown — strips trailing whitespace per line so
    minor whitespace edits don't churn the hash, but actual content does."""
    norm = "\n".join(line.rstrip() for line in rendered.splitlines()).strip()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


def _client_ip(request: Request) -> Optional[str]:
    # Trust X-Forwarded-For (Kubernetes ingress sets this) but fall back to direct.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


@router.post("/policies/{policy_id}/adopt")
async def adopt_policy(
    policy_id: str,
    payload: AdoptRequest,
    request: Request,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """E-sign the policy and store an immutable PDF snapshot in GridFS.
    Only the clinic_owner / super_admin may adopt; everyone else gets 403."""
    if user.get("role") not in {"clinic_owner", "super_admin"}:
        raise HTTPException(403, "Only clinic_owner / super_admin may adopt policies")
    if not payload.acknowledge:
        raise HTTPException(400, "You must acknowledge the policy to adopt it")

    text = _read_template(policy_id)
    ctx = await _build_context(db, user)
    rendered = _render_template(text, ctx)
    md_hash = _markdown_hash(rendered)

    # Idempotency on this exact revision: if the same markdown hash is already
    # adopted (status='active') for the clinic, return that adoption.
    existing = await db.policy_adoptions.find_one({
        "clinic_id": user["clinic_id"], "policy_id": policy_id,
        "markdown_hash": md_hash, "status": "active",
    }, {"_id": 0})
    if existing:
        return {**existing, "already_adopted": True}

    # If a prior adoption exists for this policy with a different hash, mark it
    # superseded — the policy text has drifted and needs re-adoption.
    await db.policy_adoptions.update_many(
        {"clinic_id": user["clinic_id"], "policy_id": policy_id, "status": "active"},
        {"$set": {"status": "superseded",
                  "superseded_at": datetime.now(timezone.utc).isoformat(),
                  "superseded_by_user_id": user["user_id"]}},
    )

    adoption_id = f"ADOPT-{uuid4().hex[:10].upper()}"
    signed_at = datetime.now(timezone.utc).isoformat()
    ip = _client_ip(request)
    ua = request.headers.get("user-agent", "")[:500]
    meta = next((p for p in POLICIES if p["id"] == policy_id), {})

    signature_block = {
        "adoption_id": adoption_id,
        "typed_name": payload.typed_name,
        "user_id": user["user_id"],
        "role": user["role"],
        "signed_at": signed_at,
        "ip_address": ip,
        "user_agent": ua,
        "markdown_hash": md_hash,
    }
    pdf_bytes = _build_policy_pdf(rendered, ctx, meta, signature=signature_block)

    bucket = AsyncIOMotorGridFSBucket(db, bucket_name="policy_adoptions")
    fs_id = await bucket.upload_from_stream(
        filename=f"{adoption_id}.pdf",
        source=pdf_bytes,
        metadata={
            "adoption_id": adoption_id, "policy_id": policy_id,
            "clinic_id": user["clinic_id"],
        },
    )

    doc = {
        "adoption_id": adoption_id,
        "clinic_id": user["clinic_id"],
        "policy_id": policy_id,
        "policy_title": meta.get("title"),
        "policy_code": meta.get("code"),
        "typed_name": payload.typed_name,
        "signed_by_user_id": user["user_id"],
        "signed_by_email": user.get("email"),
        "signed_by_role": user["role"],
        "signed_at": signed_at,
        "ip_address": ip,
        "user_agent": ua,
        "markdown_hash": md_hash,
        "pdf_fs_id": str(fs_id),
        "pdf_size_bytes": len(pdf_bytes),
        "status": "active",
    }
    await db.policy_adoptions.insert_one(dict(doc))   # copy so _id leak doesn't pollute response

    log.info(f"Policy {policy_id} adopted by {user['email']} for clinic "
             f"{user['clinic_id']} → {adoption_id}")
    return {**doc, "already_adopted": False}


@router.get("/adoptions")
async def list_adoptions(
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Adoption ledger — returns latest active + superseded adoptions for the
    caller's clinic, with one entry per policy_id. Frontend shows a status
    badge per policy on the main pack screen."""
    rows = await db.policy_adoptions.find(
        {"clinic_id": user["clinic_id"]}, {"_id": 0},
    ).sort("signed_at", -1).to_list(500)

    by_policy: dict[str, dict] = {}
    for r in rows:
        pid = r["policy_id"]
        if pid not in by_policy or r.get("status") == "active":
            by_policy[pid] = r

    return {
        "adoptions": rows,
        "by_policy": by_policy,
        "summary": {
            "policies_total": len(POLICIES),
            "policies_signed": sum(1 for r in by_policy.values() if r.get("status") == "active"),
            "policies_superseded": sum(1 for r in by_policy.values() if r.get("status") == "superseded"),
        },
    }


@router.get("/adoptions/{adoption_id}/pdf")
async def get_adoption_pdf(
    adoption_id: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    row = await db.policy_adoptions.find_one(
        {"adoption_id": adoption_id, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not row:
        raise HTTPException(404, "Adoption not found")
    bucket = AsyncIOMotorGridFSBucket(db, bucket_name="policy_adoptions")
    try:
        stream = await bucket.open_download_stream(ObjectId(row["pdf_fs_id"]))
    except Exception:  # noqa: BLE001
        raise HTTPException(404, "Signed PDF blob missing — please re-adopt")
    data = await stream.read()
    headers = {"Content-Disposition": f'inline; filename="{adoption_id}.pdf"'}
    return StreamingResponse(io.BytesIO(data), media_type="application/pdf", headers=headers)


def _escape(s: str) -> str:
    # Strip ** bold markers (reportlab Paragraph uses XML-like tags; full markdown
    # bold support isn't needed for compliance PDFs).
    s = s.replace("**", "")
    return (s.replace("&", "&amp;")
             .replace("<", "&lt;")
             .replace(">", "&gt;"))


# Sanity-check templates on import (FastAPI router doesn't expose lifecycle hooks
# the same way as the app, so we just log on module load).
_missing = [p["id"] for p in POLICIES if not (POLICY_DIR / f"{p['id']}.md").exists()]
if _missing:
    log.warning(f"Missing policy templates at {POLICY_DIR}: {_missing}")
else:
    log.info(f"Policy pack OK — {len(POLICIES)} templates present at {POLICY_DIR}")
