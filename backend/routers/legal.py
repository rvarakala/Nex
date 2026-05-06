"""ISO 27001 / DPDP Policy Pack endpoint.

Serves the markdown templates under `/app/docs/compliance/` after substituting
clinic-specific placeholders (`{{clinic_name}}`, `{{owner_name}}`, ...) so each
clinic gets an audit-ready document personalised to their tenant.

Public surface (auth required for tenant-specific):
  * GET /api/legal/policies                      — list catalogue (id, title, ord)
  * GET /api/legal/policies/{policy_id}          — rendered markdown for caller's clinic
  * GET /api/legal/policies/{policy_id}.pdf      — same rendered, returned as PDF
  * GET /api/legal/policies/{policy_id}/raw      — un-substituted template (founder only)
"""
from __future__ import annotations

import io
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, Response

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
    title = meta.get("title", policy_id)

    # Render PDF via reportlab — keeps things self-contained, no LaTeX dep.
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, PageBreak, Preformatted,
    )

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
    # Cover header
    story.append(Paragraph(f"<b>{title}</b>", style_h1))
    story.append(Paragraph(
        f"{ctx['clinic_name']} — {meta.get('code', '')} · "
        f"Effective {ctx['effective_date']} · Aligned to {meta.get('iso','')}",
        style_meta,
    ))

    # Naive markdown → reportlab. We support headings (#, ##, ###), bullets,
    # paragraphs, and code-fenced blocks. Tables fall back to monospaced text.
    in_code = False
    code_buf: list[str] = []
    in_table = False
    table_buf: list[str] = []

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
            code_buf.append(line)
            continue
        # Crude table handling: collect contiguous '|...' lines as preformatted.
        if line.lstrip().startswith("|"):
            in_table = True
            table_buf.append(line)
            continue
        if in_table:
            in_table = False
            _flush_table()
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

    _flush_code()
    _flush_table()

    doc.build(story)
    buf.seek(0)
    headers = {"Content-Disposition": f'inline; filename="{policy_id}.pdf"'}
    return StreamingResponse(buf, media_type="application/pdf", headers=headers)


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
