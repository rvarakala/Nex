"""Hearing-Aid Module — Phase 1 entity models.

These are the foundation data models for the HA Commerce & Lifecycle Engine.
Kept in a dedicated file (rather than models.py) so the HA module can evolve
independently and be deleted cleanly if ever unplugged.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


# ==================== BRANCH ====================

class Branch(BaseModel):
    """A physical clinic location. A `Clinic` (tenant) may have many branches.
    Inventory is always scoped to a branch; users are assigned to one or more."""
    model_config = ConfigDict(extra="ignore")
    branch_id: str = Field(default_factory=lambda: f"BR-{str(uuid4())[:8].upper()}")
    clinic_id: str
    name: str
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    phone: Optional[str] = None
    gstin: Optional[str] = None
    is_primary: bool = False
    active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class BranchCreate(BaseModel):
    name: str
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    phone: Optional[str] = None
    gstin: Optional[str] = None
    is_primary: bool = False


# ==================== VENDOR ====================

class Vendor(BaseModel):
    """A supplier of hearing aids or accessories (Phonak, Signia India, …)."""
    model_config = ConfigDict(extra="ignore")
    vendor_id: str = Field(default_factory=lambda: f"VND-{str(uuid4())[:8].upper()}")
    clinic_id: str
    name: str
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    gstin: Optional[str] = None
    state: Optional[str] = None
    address: Optional[str] = None
    payment_terms_days: int = 30
    active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class VendorCreate(BaseModel):
    name: str
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    gstin: Optional[str] = None
    state: Optional[str] = None
    address: Optional[str] = None
    payment_terms_days: int = 30


# ==================== SERIAL-ITEM STATE CONSTANTS ====================
# Enum-ish Literals kept in the model file for reuse by future HA entities.

SerialState = Literal[
    "IN_STOCK", "RESERVED", "TRIAL_OUT", "SOLD",
    "LOANER", "SERVICE_IN", "RETURNED", "DAMAGED", "RETIRED",
]

SerialPool = Literal[
    "saleable", "demo", "loaner", "refurbished",
]


# ==================== PRODUCT MASTER ====================

FormFactor = Literal["RIC", "BTE", "ITE", "ITC", "CIC", "IIC", "accessory"]
TechTier = Literal["essential", "standard", "advanced", "premium"]


class Product(BaseModel):
    """Catalogue SKU. Shared across branches of a clinic.
    `is_serialised=true` for HA units (every unit tracked); false for accessories (tracked by qty)."""
    model_config = ConfigDict(extra="ignore")
    product_id: str = Field(default_factory=lambda: f"PRD-{str(uuid4())[:8].upper()}")
    clinic_id: str
    brand: str
    model: str
    form_factor: FormFactor = "RIC"
    tech_tier: Optional[TechTier] = None
    connectivity: List[str] = Field(default_factory=list)     # e.g. ["bluetooth","rechargeable","telecoil"]
    warranty_months: int = 24
    mrp: float = 0.0
    cost: float = 0.0
    min_sell_price: float = 0.0
    hsn: str = "9021"                                          # hearing aids default HSN
    gst_rate: float = 18.0
    is_serialised: bool = True
    active: bool = True
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ProductCreate(BaseModel):
    brand: str
    model: str
    form_factor: FormFactor = "RIC"
    tech_tier: Optional[TechTier] = None
    connectivity: List[str] = Field(default_factory=list)
    warranty_months: int = 24
    mrp: float = 0.0
    cost: float = 0.0
    min_sell_price: float = 0.0
    hsn: str = "9021"
    gst_rate: float = 18.0
    is_serialised: bool = True
    notes: Optional[str] = None


# ==================== SERIAL ITEM ====================

class SerialItem(BaseModel):
    """One physical unit. serial_no = manufacturer sticker (scanned/typed at GRN)."""
    model_config = ConfigDict(extra="ignore")
    serial_id: str = Field(default_factory=lambda: f"SI-{str(uuid4())[:10].upper()}")
    clinic_id: str
    branch_id: str
    product_id: str
    serial_no: str                                             # manufacturer sticker
    state: SerialState = "IN_STOCK"
    pool: SerialPool = "saleable"
    warranty_end_date: Optional[str] = None                    # ISO date string (YYYY-MM-DD)
    grn_no: Optional[str] = None
    current_patient_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[str] = None


class SerialItemUpdate(BaseModel):
    pool: Optional[SerialPool] = None
    notes: Optional[str] = None


# ==================== ACCESSORY STOCK (non-serialised) ====================

class AccessoryStock(BaseModel):
    """Qty-tracked stock for non-serialised accessories (domes, wax-guards, batteries).
    One row per (product_id, branch_id, variant). `variant` groups size/length/power variants."""
    model_config = ConfigDict(extra="ignore")
    sku_id: str = Field(default_factory=lambda: f"SKU-{str(uuid4())[:8].upper()}")
    clinic_id: str
    branch_id: str
    product_id: str
    variant: Optional[str] = None                              # e.g. "small", "size-8", "L-power"
    qty_on_hand: int = 0
    reorder_level: int = 0
    updated_at: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AccessoryAdjust(BaseModel):
    delta: int                                                 # positive = add, negative = consume
    reason: str                                                # required audit note


# ==================== PURCHASE ORDER ====================

POStatus = Literal["draft", "approved", "ordered", "partial_received", "received", "closed", "cancelled"]


class POLine(BaseModel):
    product_id: str
    variant: Optional[str] = None                              # for accessories
    qty: int
    unit_cost: float
    gst_rate: float = 18.0


class PurchaseOrder(BaseModel):
    model_config = ConfigDict(extra="ignore")
    po_no: str                                                 # PO-YYYY-NNNN
    clinic_id: str
    branch_id: str
    vendor_id: str
    vendor_name: Optional[str] = None                          # denormalised for list display
    lines: List[POLine]
    subtotal: float = 0.0
    gst_amount: float = 0.0
    total: float = 0.0
    status: POStatus = "draft"
    expected_date: Optional[str] = None
    notes: Optional[str] = None
    created_by_user_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    approved_at: Optional[str] = None
    closed_at: Optional[str] = None


class PurchaseOrderCreate(BaseModel):
    branch_id: str
    vendor_id: str
    lines: List[POLine]
    expected_date: Optional[str] = None
    notes: Optional[str] = None


# ==================== GRN ====================

class GRNLine(BaseModel):
    product_id: str
    variant: Optional[str] = None
    qty_received: int
    serial_nos: List[str] = Field(default_factory=list)        # required when product.is_serialised
    unit_cost_actual: Optional[float] = None                   # override if different from PO


class GRN(BaseModel):
    model_config = ConfigDict(extra="ignore")
    grn_no: str                                                # GRN-YYYY-NNNN
    po_no: str
    clinic_id: str
    branch_id: str
    received_at: str
    lines: List[GRNLine]
    vendor_invoice_ref: Optional[str] = None
    notes: Optional[str] = None
    created_by_user_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class GRNCreate(BaseModel):
    po_no: str
    received_at: Optional[str] = None                          # ISO; defaults to now
    lines: List[GRNLine]
    vendor_invoice_ref: Optional[str] = None
    notes: Optional[str] = None


# ==================== QUOTATION ====================

QuoteStatus = Literal["draft", "sent", "accepted", "rejected", "expired", "cancelled", "converted"]
Side = Literal["left", "right", "single"]


class QuoteLine(BaseModel):
    product_id: str
    side: Side = "single"
    qty: int = 1
    unit_price: float          # customer-facing price (per unit)
    discount_pct: float = 0.0  # % discount on unit_price
    gst_rate: float = 18.0
    notes: Optional[str] = None


class Quotation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    quote_no: str                                              # QTE-YYYY-NNNN
    clinic_id: str
    branch_id: str
    patient_id: str
    patient_name: Optional[str] = None                         # denormalised
    audiologist_user_id: Optional[str] = None
    is_pair: bool = False                                      # L+R bundle
    lines: List[QuoteLine]
    subtotal: float = 0.0
    discount_amount: float = 0.0                               # absolute discount total
    gst_amount: float = 0.0
    total: float = 0.0
    status: QuoteStatus = "draft"
    valid_until: Optional[str] = None                          # YYYY-MM-DD
    notes: Optional[str] = None
    created_by_user_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    sent_at: Optional[str] = None
    accepted_at: Optional[str] = None
    converted_sale_no: Optional[str] = None


class QuotationCreate(BaseModel):
    branch_id: str
    patient_id: str
    audiologist_user_id: Optional[str] = None
    is_pair: bool = False
    lines: List[QuoteLine]
    valid_until: Optional[str] = None
    notes: Optional[str] = None


# ==================== SALE ====================

SaleStatus = Literal["draft", "reserved", "invoiced", "paid", "cancelled"]


class SaleLine(BaseModel):
    product_id: str
    serial_id: Optional[str] = None                            # nullable for accessory lines
    side: Side = "single"
    qty: int = 1
    unit_price: float
    discount_pct: float = 0.0
    gst_rate: float = 18.0


class Sale(BaseModel):
    model_config = ConfigDict(extra="ignore")
    sale_no: str                                               # SAL-YYYY-NNNN
    clinic_id: str
    branch_id: str
    patient_id: str
    patient_name: Optional[str] = None
    quote_no: Optional[str] = None                             # source quotation
    is_pair: bool = False
    lines: List[SaleLine]
    subtotal: float = 0.0
    discount_amount: float = 0.0
    gst_amount: float = 0.0
    total: float = 0.0
    status: SaleStatus = "reserved"                            # default once created
    invoice_no: Optional[str] = None                           # linked invoice
    margin_approval_user_id: Optional[str] = None              # if any line below min_sell_price
    margin_approval_at: Optional[str] = None
    below_floor_lines: List[int] = Field(default_factory=list) # line indexes needing approval
    created_by_user_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    cancelled_at: Optional[str] = None


class SaleCreate(BaseModel):
    """Create a Sale straight from a Quotation. Reserves all serialised lines
    (IN_STOCK → RESERVED). Margin floor violations must be pre-approved via
    `margin_approval_user_id` (clinic_owner / super_admin)."""
    quote_no: str
    serial_assignments: dict[int, str] = Field(default_factory=dict)
    # map of quote-line-index → serial_id chosen from IN_STOCK pool
    margin_approval_user_id: Optional[str] = None



# ==================== FITTING (Phase 4 — Clinical) ====================

FittingStatus = Literal["active", "completed", "cancelled"]
FittingVisitKind = Literal["first_fit", "follow_up", "adjustment", "aided_test", "remote_tune"]


class FittingSerial(BaseModel):
    """One serialised HA unit attached to a fitting session (per ear)."""
    serial_id: str
    side: Literal["left", "right", "single"] = "single"


class FittingAdjustment(BaseModel):
    """A single parameter change captured inside a visit (ear / param / old / new)."""
    ear: Literal["left", "right", "both"] = "both"
    param: str                                                 # e.g. "gain_2k", "mpo", "program_1_name"
    old: Optional[str] = None
    new: Optional[str] = None


class FittingVisit(BaseModel):
    """Per-visit summary in the programming ledger. Q3=b: summary-level."""
    visit_id: str = Field(default_factory=lambda: f"FV-{str(uuid4())[:8].upper()}")
    kind: FittingVisitKind = "follow_up"
    at: str                                                    # ISO timestamp
    actor_user_id: str
    actor_name: Optional[str] = None
    notes: Optional[str] = None
    adjustments: List[FittingAdjustment] = Field(default_factory=list)
    # Audiologist-logged adaptation score at this visit (Q4=b):
    wear_hours_per_day: Optional[float] = None                 # patient-reported at this visit
    comfort_score: Optional[int] = None                        # 1..5


class AidedAudiogramEar(BaseModel):
    """Sound-field aided threshold readings per ear. Hz → dB HL."""
    hz_500: Optional[float] = None
    hz_1000: Optional[float] = None
    hz_2000: Optional[float] = None
    hz_4000: Optional[float] = None


class AidedAudiogram(BaseModel):
    """Embedded aided audiogram (Q1=a). Captured during fitting, not M02."""
    measured_at: Optional[str] = None                          # ISO timestamp
    method: Literal["sound_field", "insertion_gain"] = "sound_field"
    right: Optional[AidedAudiogramEar] = None
    left: Optional[AidedAudiogramEar] = None
    binaural: Optional[AidedAudiogramEar] = None
    notes: Optional[str] = None


class Fitting(BaseModel):
    """A hearing-aid fitting session. One per Sale (typically).
    Holds the full clinical journey — first fit, follow-ups, adjustments, aided audiogram."""
    model_config = ConfigDict(extra="ignore")
    fitting_id: str = Field(default_factory=lambda: f"FIT-{str(uuid4())[:10].upper()}")
    clinic_id: str
    branch_id: str
    patient_id: str
    patient_name: Optional[str] = None
    audiologist_user_id: str
    audiologist_name: Optional[str] = None
    sale_no: Optional[str] = None                              # link to HA Sale (optional)
    quote_no: Optional[str] = None                             # link to source Quote (optional)
    serials: List[FittingSerial] = Field(default_factory=list)
    status: FittingStatus = "active"
    first_fit_at: Optional[str] = None                         # ISO; set on first visit or on create
    completed_at: Optional[str] = None
    visits: List[FittingVisit] = Field(default_factory=list)
    aided_audiogram: Optional[AidedAudiogram] = None
    # REM is postponed (Q2); keep a placeholder so we can extend without migration.
    rem: Optional[dict] = None
    notes: Optional[str] = None
    created_by_user_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[str] = None


class FittingCreate(BaseModel):
    branch_id: str
    patient_id: str
    audiologist_user_id: Optional[str] = None                  # defaults to caller
    sale_no: Optional[str] = None
    quote_no: Optional[str] = None
    serials: List[FittingSerial] = Field(default_factory=list)
    notes: Optional[str] = None


class FittingUpdate(BaseModel):
    status: Optional[FittingStatus] = None
    completed_at: Optional[str] = None
    notes: Optional[str] = None


class FittingVisitCreate(BaseModel):
    kind: FittingVisitKind = "follow_up"
    notes: Optional[str] = None
    adjustments: List[FittingAdjustment] = Field(default_factory=list)
    wear_hours_per_day: Optional[float] = None
    comfort_score: Optional[int] = None


# ==================== TRIAL (Phase 4.5 — catch-up from user's plan) ====================

TrialStatus = Literal["active", "extended", "converted", "returned", "lost"]


class TrialSerial(BaseModel):
    """One serial unit loaned out on this trial (L+R supported)."""
    serial_id: str
    side: Literal["left", "right", "single"] = "single"


class Trial(BaseModel):
    """A take-home trial of one or more HA units.
    Moves the serial IN_STOCK → TRIAL_OUT; on convert goes → SOLD; on return → IN_STOCK; on lost → DAMAGED."""
    model_config = ConfigDict(extra="ignore")
    trial_no: str                                              # TRIAL-YYYY-NNNN
    clinic_id: str
    branch_id: str
    patient_id: str
    patient_name: Optional[str] = None
    audiologist_user_id: Optional[str] = None
    audiologist_name: Optional[str] = None
    serials: List[TrialSerial] = Field(default_factory=list)
    status: TrialStatus = "active"
    start_date: str                                            # YYYY-MM-DD
    return_date: str                                           # YYYY-MM-DD (expected)
    actual_return_date: Optional[str] = None                   # YYYY-MM-DD (actual)
    deposit_amount: float = 0.0
    accessories_given: List[str] = Field(default_factory=list) # e.g., ["Dome M x4", "Wax-guards x2"]
    condition_photos: List[str] = Field(default_factory=list)  # URLs / data-URLs (lightweight)
    notes: Optional[str] = None
    converted_sale_no: Optional[str] = None                    # if trial converted to sale
    created_by_user_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[str] = None
    closed_at: Optional[str] = None                            # set on converted/returned/lost


class TrialCreate(BaseModel):
    branch_id: str
    patient_id: str
    audiologist_user_id: Optional[str] = None
    serials: List[TrialSerial]                                 # at least one required
    start_date: Optional[str] = None                           # defaults to today
    return_date: str                                           # required (YYYY-MM-DD)
    deposit_amount: float = 0.0
    accessories_given: List[str] = Field(default_factory=list)
    condition_photos: List[str] = Field(default_factory=list)
    notes: Optional[str] = None


class TrialExtend(BaseModel):
    return_date: str                                           # new expected return
    notes: Optional[str] = None


class TrialReturn(BaseModel):
    actual_return_date: Optional[str] = None                   # defaults to today
    notes: Optional[str] = None


class TrialConvert(BaseModel):
    """Trial → Sale: mints a full Sale at the supplied pricing.
    Serials transition TRIAL_OUT → SOLD (skipping RESERVED; trial-convert is a direct sale)."""
    unit_prices: List[float]                                   # one per serial, index-matched
    discount_pct: float = 0.0                                  # optional uniform discount
    gst_rate: float = 18.0
    margin_approval_user_id: Optional[str] = None
    notes: Optional[str] = None


# ==================== FOLLOWUPS + SUBSCRIPTIONS (Phase 6 CRM) ====================

FollowUpKind = Literal[
    # Fitting cadence (user's plan: 1 week, 1 month, 3 months, annual)
    "adaptation_1w", "review_1mo", "review_3mo", "review_annual",
    # Trial cadence (user's plan: day 3, day 7, overdue)
    "trial_day3", "trial_day7", "trial_overdue",
    # Consumables (user's plan: battery, dome, wax-guard)
    "consumable",
    # NPS + upgrade
    "nps", "upgrade",
]

FollowUpStatus = Literal["pending", "sent", "done", "dismissed"]


class SentChannel(BaseModel):
    channel: Literal["whatsapp", "sms", "email", "phone_call", "in_person"] = "whatsapp"
    sent_at: str                                               # ISO timestamp
    actor_user_id: Optional[str] = None


class FollowUp(BaseModel):
    model_config = ConfigDict(extra="ignore")
    followup_id: str = Field(default_factory=lambda: f"FUP-{str(uuid4())[:10].upper()}")
    clinic_id: str
    branch_id: str
    patient_id: str
    patient_name: Optional[str] = None
    patient_mobile: Optional[str] = None
    kind: FollowUpKind
    due_date: str                                              # YYYY-MM-DD
    status: FollowUpStatus = "pending"
    # Link to the driver doc (sale / trial / fitting / subscription)
    ref_kind: Optional[Literal["sale", "trial", "fitting", "subscription"]] = None
    ref_id: Optional[str] = None
    title: str                                                 # short summary
    message_template: Optional[str] = None                     # pre-composed WA body
    sent_channels: List[SentChannel] = Field(default_factory=list)
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    closed_at: Optional[str] = None


SubscriptionKind = Literal["batteries", "domes", "wax_guards", "other"]
SubscriptionStatus = Literal["active", "paused", "cancelled"]


class Subscription(BaseModel):
    """Consumable subscription per patient (manual-create; audiologist or front_desk)."""
    model_config = ConfigDict(extra="ignore")
    subscription_id: str = Field(default_factory=lambda: f"SUB-{str(uuid4())[:10].upper()}")
    clinic_id: str
    branch_id: str
    patient_id: str
    patient_name: Optional[str] = None
    kind: SubscriptionKind
    item_label: str                                            # e.g. "Signia Silk Dome M"
    cadence_days: int                                          # interval between re-orders
    last_delivered_at: Optional[str] = None                    # YYYY-MM-DD
    next_due_date: str                                         # YYYY-MM-DD (rolled forward on each delivery)
    status: SubscriptionStatus = "active"
    notes: Optional[str] = None
    created_by_user_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[str] = None


class SubscriptionCreate(BaseModel):
    branch_id: str
    patient_id: str
    kind: SubscriptionKind
    item_label: str
    cadence_days: int
    next_due_date: Optional[str] = None                        # defaults to today + cadence_days
    notes: Optional[str] = None


class SubscriptionUpdate(BaseModel):
    status: Optional[SubscriptionStatus] = None
    cadence_days: Optional[int] = None
    next_due_date: Optional[str] = None
    notes: Optional[str] = None


class SubscriptionDeliver(BaseModel):
    """Mark one delivery; rolls next_due_date forward by cadence_days."""
    delivered_on: Optional[str] = None                         # YYYY-MM-DD (default today)
    note: Optional[str] = None



# ==================== SERVICE TICKETS (Post-P7 UI catch-up) ====================

TicketKind = Literal["repair", "cleaning", "reprogramming", "warranty_claim", "other"]
TicketStatus = Literal["open", "in_progress", "resolved", "closed", "cancelled"]


class ServiceTicket(BaseModel):
    """A service/repair job on a HA unit. Moves serial SOLD → SERVICE_IN on create,
    SERVICE_IN → RETURNED on resolve (back to patient) or → DAMAGED on cancel."""
    model_config = ConfigDict(extra="ignore")
    ticket_no: str                                              # JOB-YYYY-NNNN
    clinic_id: str
    branch_id: str
    patient_id: str
    patient_name: Optional[str] = None
    patient_mobile: Optional[str] = None
    serial_id: Optional[str] = None                             # the unit being serviced
    serial_no: Optional[str] = None
    kind: TicketKind = "repair"
    complaint: str
    status: TicketStatus = "open"
    technician_user_id: Optional[str] = None
    technician_name: Optional[str] = None
    diagnosis: Optional[str] = None
    resolution_notes: Optional[str] = None
    cost_to_patient: float = 0.0
    warranty_covered: bool = False
    loaner_serial_id: Optional[str] = None                      # if a LOANER was issued
    created_by_user_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[str] = None
    resolved_at: Optional[str] = None
    closed_at: Optional[str] = None


class ServiceTicketCreate(BaseModel):
    branch_id: str
    patient_id: str
    serial_id: Optional[str] = None
    kind: TicketKind = "repair"
    complaint: str
    technician_user_id: Optional[str] = None
    warranty_covered: bool = False


class ServiceTicketUpdate(BaseModel):
    status: Optional[TicketStatus] = None
    technician_user_id: Optional[str] = None
    diagnosis: Optional[str] = None
    resolution_notes: Optional[str] = None
    cost_to_patient: Optional[float] = None
    warranty_covered: Optional[bool] = None
    loaner_serial_id: Optional[str] = None


class ServiceTicketResolve(BaseModel):
    resolution_notes: str
    cost_to_patient: float = 0.0
    warranty_covered: bool = False
