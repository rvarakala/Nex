"""Patient family group linking.

Two (or more) real people who legitimately share a phone (spouse, parent
+ child, siblings) shouldn't be merged — they're distinct patients with
distinct medical histories. But the front-desk still wants to see them
side-by-side and jump between profiles without hunting through the
patients list.

Model: a `family_groups` doc holds N `members`, each `{patient_id,
relationship}`. Each patient row also gets a denormalised
`family_group_id` for O(1) lookup on the profile page — kept in sync by
this router.

Relationships are free-form labels but the UI offers a fixed set
(spouse, parent, child, sibling, other) so the data stays clean without
enforcing an enum in the backend.
"""
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db
from utils.serde import serialize_datetime

router = APIRouter(prefix="/api")


class FamilyMember(BaseModel):
    patient_id: str
    relationship: Optional[str] = None  # spouse / parent / child / sibling / other


class LinkFamilyPayload(BaseModel):
    other_patient_id: str
    relationship: Optional[str] = None
    # Optional label — auto-derived from head-of-family's name if omitted.
    family_name: Optional[str] = None


async def _load_group(db, clinic_id: str, group_id: str) -> Optional[dict]:
    """Fetch a family group scoped to a clinic. Returns None if not found."""
    return await db.family_groups.find_one(
        {"group_id": group_id, "clinic_id": clinic_id},
        {"_id": 0},
    )


async def _populate_members(db, clinic_id: str, group: dict) -> dict:
    """Hydrate the members[] array with light patient snippets. Skips
    any deleted/merged rows so the UI never shows a broken link chip."""
    ids = [m["patient_id"] for m in group.get("members", [])]
    if not ids:
        group["members"] = []
        return group
    rows = await db.patients.find(
        {
            "clinic_id": clinic_id,
            "patient_id": {"$in": ids},
            "merged_into": {"$in": [None, False]},
        },
        {"_id": 0, "patient_id": 1, "name": 1, "mrd": 1, "age": 1, "gender": 1, "mobile": 1},
    ).to_list(len(ids))
    by_id = {r["patient_id"]: r for r in rows}
    hydrated = []
    for m in group.get("members", []):
        p = by_id.get(m["patient_id"])
        if not p:
            continue  # patient was deleted/merged — drop from view
        hydrated.append({
            **p,
            "relationship": m.get("relationship"),
        })
    group["members"] = hydrated
    return group


@router.get("/patients/{patient_id}/family")
async def get_family_for_patient(
    patient_id: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Return the family group this patient belongs to (with member
    snippets) or `null` if not linked. Always safe to call — returns
    a null group instead of 404 so the UI can render "Not linked yet".
    """
    p = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": user["clinic_id"]},
        # Include `patient_id` in projection so the doc is non-empty
        # even when `family_group_id` is unset — otherwise Motor returns
        # {} which is falsy and we'd 404 a valid patient.
        {"_id": 0, "patient_id": 1, "family_group_id": 1},
    )
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    gid = p.get("family_group_id")
    if not gid:
        return {"group": None}
    group = await _load_group(db, user["clinic_id"], gid)
    if not group:
        # Denormalised pointer went stale — self-heal so the profile
        # doesn't render a dead chip. Users shouldn't have to debug this.
        await db.patients.update_one(
            {"patient_id": patient_id, "clinic_id": user["clinic_id"]},
            {"$unset": {"family_group_id": ""}},
        )
        return {"group": None}
    return {"group": await _populate_members(db, user["clinic_id"], group)}


@router.post("/patients/{patient_id}/family/link")
async def link_family_member(
    patient_id: str,
    payload: LinkFamilyPayload,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Link `patient_id` and `payload.other_patient_id` into the same
    family group. Four possible starting states:

      1. Neither has a group   → create a new group with both members.
      2. `patient_id` has one  → add `other_patient_id` to it.
      3. `other_patient_id` has one → add `patient_id` to it.
      4. Both have groups      → 409 with a helpful "already in
         different families" error. Owner has to unlink one first
         (deliberate — merging groups silently would risk losing the
         wrong family's relationship labels).
    """
    clinic_id = user["clinic_id"]
    if patient_id == payload.other_patient_id:
        raise HTTPException(status_code=400, detail="Cannot link a patient to itself")

    a = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": clinic_id},
        {"_id": 0, "patient_id": 1, "family_group_id": 1, "name": 1},
    )
    b = await db.patients.find_one(
        {"patient_id": payload.other_patient_id, "clinic_id": clinic_id},
        {"_id": 0, "patient_id": 1, "family_group_id": 1, "name": 1},
    )
    if not a:
        raise HTTPException(status_code=404, detail="Patient not found in your clinic")
    if not b:
        raise HTTPException(status_code=404, detail="Other patient not found in your clinic")

    a_gid = a.get("family_group_id")
    b_gid = b.get("family_group_id")

    if a_gid and b_gid and a_gid != b_gid:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "already_in_different_families",
                "message": "Both patients already belong to different family groups. Unlink one first.",
            },
        )

    # Reuse whichever group exists — or create a new one.
    gid = a_gid or b_gid
    now = datetime.utcnow()
    if not gid:
        gid = f"FAM-{uuid.uuid4().hex[:12].upper()}"
        family_name = payload.family_name or f"{(a.get('name') or 'Family').split()[-1]} family"
        await db.family_groups.insert_one(serialize_datetime({
            "group_id": gid,
            "clinic_id": clinic_id,
            "name": family_name,
            "members": [
                {"patient_id": patient_id, "relationship": None},
                {"patient_id": payload.other_patient_id, "relationship": payload.relationship},
            ],
            "created_by": user["user_id"],
            "created_at": now,
            "updated_at": now,
        }))
    else:
        # Add whichever side is missing. `$addToSet` alone won't work
        # because dict equality includes relationship — use manual
        # existence check.
        #
        # The relationship label is attached to whichever member is
        # being *added* to the existing group. Front-desk always types
        # the relationship from the current-patient's perspective, and
        # spouse/sibling roles are symmetric — so mirroring the label
        # onto the new member is the correct semantic. Parent/child
        # asymmetry can be corrected inline after the link fires.
        group = await _load_group(db, clinic_id, gid)
        member_ids = {m["patient_id"] for m in (group.get("members") or [])}
        adds = []
        if patient_id not in member_ids:
            adds.append({"patient_id": patient_id, "relationship": payload.relationship})
        if payload.other_patient_id not in member_ids:
            adds.append({"patient_id": payload.other_patient_id, "relationship": payload.relationship})
        if adds:
            await db.family_groups.update_one(
                {"group_id": gid, "clinic_id": clinic_id},
                {"$push": {"members": {"$each": adds}}, "$set": {"updated_at": now.isoformat()}},
            )
        else:
            # Both already members — allow relationship update on the
            # "other" side (idempotent link retry with a corrected
            # relationship label).
            if payload.relationship is not None:
                await db.family_groups.update_one(
                    {"group_id": gid, "clinic_id": clinic_id, "members.patient_id": payload.other_patient_id},
                    {"$set": {"members.$.relationship": payload.relationship, "updated_at": now.isoformat()}},
                )

    # Denormalise family_group_id back onto both patient rows so the
    # profile page can look up in a single query.
    await db.patients.update_many(
        {
            "clinic_id": clinic_id,
            "patient_id": {"$in": [patient_id, payload.other_patient_id]},
        },
        {"$set": {"family_group_id": gid, "updated_at": now.isoformat()}},
    )

    await db.activity_logs.insert_one(serialize_datetime({
        "clinic_id": clinic_id,
        "user_id": user["user_id"],
        "action": "family.link",
        "family_group_id": gid,
        "patient_id": patient_id,
        "other_patient_id": payload.other_patient_id,
        "relationship": payload.relationship,
        "at": now,
    }))

    group = await _load_group(db, clinic_id, gid)
    return {"group": await _populate_members(db, clinic_id, group)}


@router.post("/patients/{patient_id}/family/unlink")
async def unlink_family_member(
    patient_id: str,
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Remove this patient from their current family group. If the
    group is left with <2 members, delete the group entirely (a solo
    "family" is meaningless).
    """
    clinic_id = user["clinic_id"]
    p = await db.patients.find_one(
        {"patient_id": patient_id, "clinic_id": clinic_id},
        {"_id": 0, "patient_id": 1, "family_group_id": 1},
    )
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    gid = p.get("family_group_id")
    if not gid:
        raise HTTPException(status_code=400, detail="Patient is not in a family group")

    now = datetime.utcnow()
    await db.family_groups.update_one(
        {"group_id": gid, "clinic_id": clinic_id},
        {"$pull": {"members": {"patient_id": patient_id}}, "$set": {"updated_at": now.isoformat()}},
    )
    await db.patients.update_one(
        {"patient_id": patient_id, "clinic_id": clinic_id},
        {"$unset": {"family_group_id": ""}, "$set": {"updated_at": now.isoformat()}},
    )

    # If the group is now <2 members, dissolve it and clean the
    # dangling pointer on the remaining patient too.
    group = await _load_group(db, clinic_id, gid)
    if group and len(group.get("members") or []) < 2:
        remaining_ids = [m["patient_id"] for m in group.get("members", [])]
        await db.family_groups.delete_one({"group_id": gid, "clinic_id": clinic_id})
        if remaining_ids:
            await db.patients.update_many(
                {"clinic_id": clinic_id, "patient_id": {"$in": remaining_ids}},
                {"$unset": {"family_group_id": ""}, "$set": {"updated_at": now.isoformat()}},
            )

    await db.activity_logs.insert_one(serialize_datetime({
        "clinic_id": clinic_id,
        "user_id": user["user_id"],
        "action": "family.unlink",
        "family_group_id": gid,
        "patient_id": patient_id,
        "at": now,
    }))

    return {"ok": True}
