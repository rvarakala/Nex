"""Inter-clinic stock transfers (delivery-challan workflow).

Models for the multi-clinic owner scenario:
  Clinic A has stock → Clinic B needs it for a patient → A dispatches with a
  Delivery Challan → B's staff signs on receipt → inventory atomically flips
  from A's clinic_id/branch_id to B's.

Lifecycle:
    draft → dispatched → received
                       └→ cancelled  (admin only, before receive)

Side-effects on `serial_items` (handled by the router, not these models):
  * On dispatch  : IN_STOCK → RESERVED  (locks unit out of sales/trials/loaners)
  * On receive   : RESERVED → IN_STOCK  + clinic_id/branch_id rewritten
  * On cancel    : RESERVED → IN_STOCK  (kept on source clinic)

GST/GSTIN handling: the challan template prints whatever GSTIN each clinic has
on file — we do not compute IGST/CGST here (most HAs are GST-exempt anyway).
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


TransferStatus = Literal["draft", "dispatched", "received", "cancelled"]
TransferPurpose = Literal["trial", "sale", "replenishment", "repair_loaner", "other"]


class TransferLine(BaseModel):
    """One transferred unit. Always serialised for HAs; `qty` is informational."""
    serial_id: str
    serial_no: str
    product_id: str
    product_label: str           # denormalised "Phonak Audeo Lumity L90 RIC" for display
    qty: int = 1


class TransferAccessoryLine(BaseModel):
    """Non-serialised accessory (domes, batteries, wax-guards) — qty-tracked."""
    product_id: str
    product_label: str
    variant: Optional[str] = None
    qty: int


class StockTransfer(BaseModel):
    model_config = ConfigDict(extra="ignore")
    transfer_id: str = Field(default_factory=lambda: f"TRF-{str(uuid4())[:10].upper()}")
    challan_no: str               # DC/2026/0001 — assigned at dispatch time

    from_clinic_id: str
    from_clinic_name: str
    from_clinic_address: Optional[str] = None
    from_clinic_gstin: Optional[str] = None
    from_branch_id: Optional[str] = None

    to_clinic_id: str
    to_clinic_name: str
    to_clinic_address: Optional[str] = None
    to_clinic_gstin: Optional[str] = None
    to_branch_id: Optional[str] = None

    status: TransferStatus = "draft"
    purpose: TransferPurpose = "trial"

    lines: List[TransferLine] = Field(default_factory=list)
    accessory_lines: List[TransferAccessoryLine] = Field(default_factory=list)

    # Dispatch leg
    dispatched_at: Optional[datetime] = None
    dispatched_by_user_id: Optional[str] = None
    dispatched_by_name: Optional[str] = None
    courier_name: Optional[str] = None
    tracking_no: Optional[str] = None

    # Receive leg
    received_at: Optional[datetime] = None
    received_by_user_id: Optional[str] = None
    received_by_name: Optional[str] = None
    received_by_role: Optional[str] = None
    signature_image_fs_id: Optional[str] = None     # GridFS id of the captured PNG
    short_shipment_notes: Optional[str] = None      # raised when partial / mismatched receive

    # Computed-on-read: True when receiver has a seal AND opted-in to challans.
    # Frontend uses this to decide whether to fetch /settings/users/<id>/seal.
    received_by_seal_eligible: Optional[bool] = None

    # Cancel leg
    cancelled_at: Optional[datetime] = None
    cancelled_by_user_id: Optional[str] = None
    cancelled_reason: Optional[str] = None

    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    created_by_user_id: Optional[str] = None
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class StockTransferCreate(BaseModel):
    to_clinic_id: str
    to_branch_id: Optional[str] = None
    purpose: TransferPurpose = "trial"
    serial_ids: List[str] = Field(default_factory=list)
    accessory_lines: List[TransferAccessoryLine] = Field(default_factory=list)
    courier_name: Optional[str] = None
    tracking_no: Optional[str] = None
    notes: Optional[str] = None


class StockTransferDispatch(BaseModel):
    courier_name: Optional[str] = None
    tracking_no: Optional[str] = None
    notes: Optional[str] = None


class StockTransferReceive(BaseModel):
    received_by_name: str
    received_by_role: str          # 'front_desk' | 'audiologist' | 'technician' | 'clinic_owner' | 'other'
    signature_image_fs_id: Optional[str] = None
    short_shipment_notes: Optional[str] = None


class StockTransferCancel(BaseModel):
    reason: str
