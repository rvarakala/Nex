"""AUDINEXA shared Pydantic models.

This package preserves the legacy `from models import X` import surface used
by 24+ files in the codebase. **Every model class still lives in
`_canonical.py`** — there is exactly ONE source of truth, no risk of
divergence between split copies.

Domain index modules (`auth`, `appointment`, `billing`, `patient`,
`clinical`) act as guided table-of-contents into the canonical file. Open
e.g. `models/billing.py` to see exactly which classes belong to billing,
then click through to `_canonical.py` for the definition.

When ADDING a new model:
  1. Define the class in `_canonical.py` under the relevant section banner.
  2. Add the class name to the corresponding domain index file's `__all__`
     so future devs can find it from there.
"""
from ._canonical import *  # noqa: F401, F403
from ._canonical import (  # noqa: F401  re-export module-level constants
    APPOINTMENT_SERVICES,
    APPOINTMENT_PRIORITIES,
    APPOINTMENT_STATUSES,
    APPOINTMENT_CATEGORIES,
    COUNTERPARTY_TYPES,
    STAFF_COLOR_PALETTE,
    PAYMENT_METHODS,
    INVOICE_STATUSES,
    color_for_staff,
)
