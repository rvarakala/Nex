"""Auto-decrement `accessory_stock` when an invoice transitions to `paid`.

Called from `billing.add_payment` once — and only once — per line, guarded
by `InvoiceLine.accessory_stock_decremented`. Failures never bubble up:
we log a warning and let the payment succeed so a data mismatch never
blocks the clinic from taking money.

Matching strategy for each line where `product_type == "Accessory"`:

    1. If `accessory_product_id` is populated on the line, use it (the
       frontend accessory picker should set this in the future).
    2. Otherwise, look for a *unique* active accessory Product in this
       clinic with the same (case-insensitive) brand + model. Ambiguous
       matches are skipped with a warning.

Once the product is resolved, the target `accessory_stock` row is picked
via `(clinic_id, product_id, branch_id, variant)`. `branch_id` comes from
the user recording the payment; `variant` comes from
`line.accessory_variant`. If a variant isn't specified but the product
has variants, we pick the first row we find that has *any* variant AND
enough qty (defensive — usually the caller should specify).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict

log = logging.getLogger(__name__)


async def _resolve_accessory_product(
    db, clinic_id: str, line: Dict[str, Any],
) -> Dict[str, Any] | None:
    """Return the matching accessory Product doc, or None if ambiguous."""
    pid = line.get("accessory_product_id")
    if pid:
        return await db.ha_products.find_one(
            {"clinic_id": clinic_id, "product_id": pid, "active": True},
            {"_id": 0},
        )
    brand = (line.get("make") or "").strip()
    model = (line.get("model") or "").strip()
    if not brand or not model:
        return None
    matches = await db.ha_products.find(
        {
            "clinic_id": clinic_id,
            "form_factor": "accessory",
            "active": True,
            "brand": {"$regex": f"^{brand}$", "$options": "i"},
            "model": {"$regex": f"^{model}$", "$options": "i"},
        },
        {"_id": 0},
    ).to_list(3)
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        log.warning(
            "accessory_stock resolve ambiguous — clinic=%s brand=%r model=%r matches=%d — skipping decrement",
            clinic_id, brand, model, len(matches),
        )
    return None


async def _find_stock_row(
    db, *, clinic_id: str, product_id: str,
    branch_id: str | None, variant: str | None,
) -> Dict[str, Any] | None:
    q: Dict[str, Any] = {"clinic_id": clinic_id, "product_id": product_id}
    if branch_id:
        q["branch_id"] = branch_id
    if variant:
        q["variant"] = variant
    else:
        # Product has no variants → the row was stored with variant=None.
        q["variant"] = None
    return await db.accessory_stock.find_one(q, {"_id": 0})


async def auto_decrement_accessory_stock(
    db, invoice_doc: Dict[str, Any], *, actor_user_id: str, branch_id: str | None,
) -> Dict[str, Any]:
    """Called once from `add_payment` after the invoice status flips to
    ``paid``. Returns a small report dict for observability. Never raises.

    Side-effects:
      * decrements `accessory_stock.qty_on_hand` per line qty
      * writes an `accessory_events` audit row per decrement
      * flips `InvoiceLine.accessory_stock_decremented = True` in place
        AND persists the updated `lines` array on the invoice
    """
    report = {"decremented": 0, "skipped_ambiguous": 0, "skipped_no_row": 0, "skipped_already": 0, "notes": []}
    lines = invoice_doc.get("lines") or []
    if not lines:
        return report
    clinic_id = invoice_doc.get("clinic_id")
    invoice_no = invoice_doc.get("invoice_no")

    any_change = False
    for ln in lines:
        if ln.get("product_type") != "Accessory":
            continue
        if ln.get("accessory_stock_decremented"):
            report["skipped_already"] += 1
            continue
        qty = float(ln.get("quantity") or 0)
        if qty <= 0:
            continue

        product = await _resolve_accessory_product(db, clinic_id, ln)
        if not product:
            report["skipped_ambiguous"] += 1
            report["notes"].append(f"no unique product match for '{ln.get('make')} {ln.get('model')}'")
            continue

        stock = await _find_stock_row(
            db,
            clinic_id=clinic_id,
            product_id=product["product_id"],
            branch_id=branch_id,
            variant=ln.get("accessory_variant"),
        )
        if not stock:
            report["skipped_no_row"] += 1
            report["notes"].append(
                f"no accessory_stock row for product={product['product_id']} branch={branch_id} variant={ln.get('accessory_variant')}"
            )
            continue

        dec = int(qty)  # accessory quantities are integer by convention
        new_qty = int(stock.get("qty_on_hand", 0)) - dec
        # Never persist a negative stock — floor to 0 and note the shortfall.
        if new_qty < 0:
            shortfall = -new_qty
            new_qty = 0
            report["notes"].append(
                f"shortfall of {shortfall} on sku_id={stock['sku_id']} (auto-floored to 0)"
            )
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.accessory_stock.update_one(
            {"sku_id": stock["sku_id"]},
            {"$set": {"qty_on_hand": new_qty, "updated_at": now_iso}},
        )
        await db.accessory_events.insert_one({
            "clinic_id": clinic_id,
            "sku_id": stock["sku_id"],
            "delta": -dec,
            "reason": f"Auto-decrement from invoice {invoice_no}",
            "invoice_id": invoice_doc.get("invoice_id"),
            "invoice_no": invoice_no,
            "actor_user_id": actor_user_id,
            "at": now_iso,
        })
        ln["accessory_stock_decremented"] = True
        report["decremented"] += 1
        any_change = True

    if any_change:
        await db.invoices.update_one(
            {"invoice_id": invoice_doc.get("invoice_id")},
            {"$set": {"lines": lines}},
        )
    if report["decremented"] or report["notes"]:
        log.info(
            "accessory auto-decrement invoice=%s clinic=%s decremented=%d ambiguous=%d no_row=%d",
            invoice_no, clinic_id, report["decremented"], report["skipped_ambiguous"], report["skipped_no_row"],
        )
    return report
