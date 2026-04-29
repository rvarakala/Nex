"""Appointment-domain models (UC-03) — see `models/_canonical.py` for definitions."""
from ._canonical import (
    APPOINTMENT_SERVICES,
    APPOINTMENT_PRIORITIES,
    APPOINTMENT_STATUSES,
    APPOINTMENT_CATEGORIES,
    COUNTERPARTY_TYPES,
    STAFF_COLOR_PALETTE,
    color_for_staff,
    Appointment,
    AppointmentCreate,
    WaitlistEntry,
    WaitlistCreate,
    CancellationLog,
    ReminderLog,
)

__all__ = [
    "APPOINTMENT_SERVICES", "APPOINTMENT_PRIORITIES", "APPOINTMENT_STATUSES",
    "APPOINTMENT_CATEGORIES", "COUNTERPARTY_TYPES", "STAFF_COLOR_PALETTE",
    "color_for_staff",
    "Appointment", "AppointmentCreate",
    "WaitlistEntry", "WaitlistCreate",
    "CancellationLog", "ReminderLog",
]
