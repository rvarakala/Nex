"""HA Quotation Studio — Phase 3.

A Quotation is a priced proposal for a patient. It becomes a Sale when the
patient agrees and specific physical units (SerialItems) are assigned.

Roles:
- read: any authenticated user in the clinic
- create/edit: front_desk + audiologist + inventory_manager + clinic_owner
- send / accept / reject / cancel: same as above
- margin-floor approval: clinic_owner / super_admin only
"""
import re
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import (
    get_current_user, require_roles, user_can_see_branch,
    CLINIC_WIDE_ROLES,
)
from database import get_db
from models_ha import Quotation, QuotationCreate, QuoteLine
from utils.numbering import next_number
from utils.serde import serialize_datetime, deserialize_datetime

router = APIRouter(prefix="/api/ha")


# ---------- helpers ----------

def _compute_quote_totals(lines: List[QuoteLine]) -> tuple[float, float, float, float]:
    """Return (subtotal, discount_total, gst_total, grand_total)."""
    sub = 0.0
    disc = 0.0
    gst = 0.0
    for ln in lines:
        gross = round(ln.qty * ln.unit_price, 2)
        d = round(gross * (ln.discount_pct or 0) / 100.0, 2)
        net = round(gross - d, 2)
        g = round(net * (ln.gst_rate or 0) / 100.0, 2)
        sub += gross
        disc += d
        gst += g
    total = round(sub - disc + gst, 2)
    return round(sub, 2), round(disc, 2), round(gst, 2), total


async def _load_products(db, clinic_id: str, product_ids: list[str]) -> dict[str, dict]:
    rows = await db.ha_products.find(
        {"product_id": {"$in": product_ids}, "clinic_id": clinic_id},
        {"_id": 0},
    ).to_list(len(product_ids))
    return {r["product_id"]: r for r in rows}


def _below_floor_indexes(lines: List[QuoteLine], products: dict[str, dict]) -> list[int]:
    """Indexes of lines priced below product.min_sell_price after discount."""
    out = []
    for i, ln in enumerate(lines):
        p = products.get(ln.product_id)
        if not p:
            continue
        floor = float(p.get("min_sell_price") or 0)
        if floor <= 0:
            continue
        net_unit = ln.unit_price * (1 - (ln.discount_pct or 0) / 100.0)
        if net_unit < floor - 1e-6:
            out.append(i)
    return out


def _validate_pair(is_pair: bool, lines: List[QuoteLine]) -> None:
    """Pair quotes need exactly one LEFT and one RIGHT line.

    The word "serialised" is intentionally NOT used in the error message —
    quote lines never carry serial numbers; a specific unit is reserved
    only when the quote converts to a Sale.
    """
    if not is_pair:
        return
    # Allow additional accessory lines (batteries, domes, etc.), but there
    # must be exactly one LEFT and one RIGHT hearing-aid line with qty=1.
    left = sum(1 for ln in lines if ln.side == "left" and ln.qty == 1)
    right = sum(1 for ln in lines if ln.side == "right" and ln.qty == 1)
    if left != 1 or right != 1:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Pair quote must have exactly one LEFT + one RIGHT hearing-aid "
                f"line (got L={left}, R={right}). Tick 'Binaural' and pick a "
                f"product; the modal auto-splits it into L + R for you."
            ),
        )


def _explode_both_sides(is_pair: bool, lines: List[QuoteLine]) -> List[QuoteLine]:
    """For pair quotes, silently expand any line with `side='both'` (or
    `side='single'`) into a LEFT + RIGHT pair, each qty=1 at the same
    unit price. This is what most clinic owners mentally do when they
    tick "Binaural" and enter one line — they mean "one for each ear".

    Bug fix (2026-07-31): user reported "Pair quote must have exactly
    one LEFT + one RIGHT serialised line (got L=0, R=0)" while quoting
    Phonak I30 with side='both'. The frontend now trusts the backend
    to normalise, so the modal stays simple (one row per SKU).
    """
    if not is_pair:
        return lines
    out: List[QuoteLine] = []
    for ln in lines:
        if ln.side in ("both", "single"):
            out.append(ln.model_copy(update={"side": "left", "qty": 1}))
            out.append(ln.model_copy(update={"side": "right", "qty": 1}))
        else:
            out.append(ln)
    return out


def _branch_scope(user: dict) -> dict:
    if user["role"] in CLINIC_WIDE_ROLES:
        return {"clinic_id": user["clinic_id"]}
    return {"clinic_id": user["clinic_id"], "branch_id": {"$in": user.get("branch_ids") or []}}


# ---------- endpoints ----------

@router.get("/quotations", response_model=List[Quotation])
async def list_quotations(
    status: Optional[str] = None,
    patient_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    limit: int = 100,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    q = _branch_scope(user)
    if status:
        q["status"] = status
    if patient_id:
        q["patient_id"] = patient_id
    if branch_id:
        if not user_can_see_branch(user, branch_id):
            raise HTTPException(status_code=403, detail="Branch access denied")
        q["branch_id"] = branch_id
    rows = await db.quotations.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [deserialize_datetime(r) for r in rows]


@router.post("/quotations", response_model=Quotation)
async def create_quotation(
    payload: QuotationCreate,
    user=Depends(require_roles("front_desk", "audiologist", "inventory_manager", "clinic_owner")),
    db=Depends(get_db),
):
    if not payload.lines:
        raise HTTPException(status_code=400, detail="Quotation must have at least one line")
    if not user_can_see_branch(user, payload.branch_id):
        raise HTTPException(status_code=403, detail="Branch access denied")

    # Patient must exist in this clinic
    patient = await db.patients.find_one(
        {"patient_id": payload.patient_id, "clinic_id": user["clinic_id"]},
        {"_id": 0, "name": 1},
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Products must all exist in this clinic
    product_ids = list({ln.product_id for ln in payload.lines})
    products = await _load_products(db, user["clinic_id"], product_ids)
    missing = set(product_ids) - set(products)
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown products: {sorted(missing)}")

    # Normalise: for pair quotes, expand any "both/single" side into a
    # matching LEFT + RIGHT pair before validation. Keeps the frontend
    # UX simple ("pick one product, one price") while the DB rows still
    # cleanly split left vs right for later fulfilment.
    normalised_lines = _explode_both_sides(payload.is_pair, payload.lines)
    _validate_pair(payload.is_pair, normalised_lines)

    sub, disc, gst, total = _compute_quote_totals(normalised_lines)
    quote_no = await next_number(db, "qte", user["clinic_id"])

    q = Quotation(
        quote_no=quote_no,
        clinic_id=user["clinic_id"],
        branch_id=payload.branch_id,
        patient_id=payload.patient_id,
        patient_name=patient["name"],
        audiologist_user_id=payload.audiologist_user_id,
        is_pair=payload.is_pair,
        lines=normalised_lines,
        subtotal=sub,
        discount_amount=disc,
        gst_amount=gst,
        total=total,
        status="draft",
        valid_until=payload.valid_until,
        notes=payload.notes,
        created_by_user_id=user["user_id"],
    )
    await db.quotations.insert_one(serialize_datetime(q.model_dump()))
    return q


@router.get("/quotations/{quote_no}")
async def get_quotation(quote_no: str, user=Depends(get_current_user), db=Depends(get_db)):
    """Returns the quote + enriched margin analysis for the UI."""
    row = await db.quotations.find_one(
        {"quote_no": quote_no, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")

    # Enrich with margin analysis + product detail
    product_ids = [ln["product_id"] for ln in row["lines"]]
    products = await _load_products(db, user["clinic_id"], product_ids)
    lines = [QuoteLine(**{k: v for k, v in ln.items() if k in QuoteLine.model_fields}) for ln in row["lines"]]
    below = _below_floor_indexes(lines, products)
    return {
        **deserialize_datetime(row),
        "margin_analysis": {
            "below_floor_line_indexes": below,
            "requires_approval": bool(below),
            "products": {
                pid: {"brand": p["brand"], "model": p["model"],
                      "min_sell_price": p.get("min_sell_price", 0),
                      "mrp": p.get("mrp", 0), "cost": p.get("cost", 0)}
                for pid, p in products.items()
            },
        },
    }


@router.put("/quotations/{quote_no}", response_model=Quotation)
async def update_quotation(
    quote_no: str, payload: QuotationCreate,
    user=Depends(require_roles("front_desk", "audiologist", "inventory_manager", "clinic_owner")),
    db=Depends(get_db),
):
    existing = await db.quotations.find_one(
        {"quote_no": quote_no, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if existing["status"] not in {"draft", "sent"}:
        raise HTTPException(status_code=409, detail=f"Cannot edit a {existing['status']} quotation")
    if not user_can_see_branch(user, existing["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")

    product_ids = list({ln.product_id for ln in payload.lines})
    products = await _load_products(db, user["clinic_id"], product_ids)
    missing = set(product_ids) - set(products)
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown products: {sorted(missing)}")
    _validate_pair(payload.is_pair, payload.lines)
    sub, disc, gst, total = _compute_quote_totals(payload.lines)

    upd = payload.model_dump()
    upd.update({
        "subtotal": sub, "discount_amount": disc, "gst_amount": gst, "total": total,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.quotations.update_one(
        {"quote_no": quote_no, "clinic_id": user["clinic_id"]},
        {"$set": serialize_datetime(upd)},
    )
    row = await db.quotations.find_one({"quote_no": quote_no}, {"_id": 0})
    return deserialize_datetime(row)


@router.post("/quotations/{quote_no}/status")
async def transition_quotation_status(
    quote_no: str, payload: dict,
    user=Depends(require_roles("front_desk", "audiologist", "inventory_manager", "clinic_owner")),
    db=Depends(get_db),
):
    """draft → sent → accepted / rejected / expired; any → cancelled."""
    to_status = payload.get("to_status")
    allowed = {
        "draft":     {"sent", "cancelled"},
        "sent":      {"accepted", "rejected", "expired", "cancelled"},
        "accepted":  {"converted", "cancelled"},
        "rejected":  set(),
        "expired":   set(),
        "cancelled": set(),
        "converted": set(),
    }
    row = await db.quotations.find_one(
        {"quote_no": quote_no, "clinic_id": user["clinic_id"]}, {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if not user_can_see_branch(user, row["branch_id"]):
        raise HTTPException(status_code=403, detail="Branch access denied")
    if to_status not in allowed.get(row["status"], set()):
        raise HTTPException(
            status_code=409,
            detail=f"Illegal quotation transition: {row['status']} → {to_status}",
        )
    upd = {"status": to_status}
    now = datetime.now(timezone.utc).isoformat()
    if to_status == "sent":
        upd["sent_at"] = now
    if to_status == "accepted":
        upd["accepted_at"] = now
    await db.quotations.update_one({"quote_no": quote_no}, {"$set": upd})
    return {"quote_no": quote_no, "status": to_status}
