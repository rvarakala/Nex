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
