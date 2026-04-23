"""Regression: every clinic MUST have services seeded so the invoice
"Add Service" dropdown renders a selectable list.

Historical bug (Feb 2026): SoundCare Hyderabad + all 10 beta testers
shipped with `services.count == 0`. The Create Invoice page rendered
four EMPTY `<optgroup>` labels (Consultation / Audiology / Hearing Aid /
Accessory) that browsers display as grey text — users thought they were
selectable options, but <optgroup> labels are never clickable, so "Add
Service" appeared to do nothing.

Root cause: `seed_default_services()` was only invoked for the default
ACS demo clinic on startup — not for tenants created via `admin_seed.py`,
`beta_seed.py`, or the `POST /api/admin/v2/seed/beta-testers` endpoint.

Fix: All three seeding paths now call `seed_default_services(db, cid)`
after inserting the clinic.

Guards:
  1. test_every_clinic_has_services — invariant check
  2. test_seed_default_services_is_idempotent — no double-inserts
"""
import os
import subprocess
import sys
from pathlib import Path


def _run(script: str) -> str:
    """Run an async snippet inside backend/ using the project's python."""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd="/app/backend",
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise AssertionError(f"Script failed:\nSTDOUT:{result.stdout}\nSTDERR:{result.stderr}")
    return result.stdout.strip()


def test_every_clinic_has_services():
    """Invariant: every clinic must have ≥ 1 service in its catalogue.

    Without this, the Create Invoice "Add Service" dropdown renders empty
    <optgroup> elements that users mistake for selectable items.
    """
    out = _run(r"""
import asyncio, os
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
load_dotenv(Path('/app/backend/.env'))

async def main():
    c = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = c[os.environ['DB_NAME']]
    clinics = await db.clinics.find({}, {'_id': 0, 'clinic_id': 1, 'name': 1}).to_list(500)
    empty = []
    for cl in clinics:
        n = await db.services.count_documents({'clinic_id': cl['clinic_id']})
        if n == 0:
            empty.append(cl['clinic_id'] + ' (' + str(cl.get('name', '?')) + ')')
    c.close()
    if empty:
        print('FAIL:' + '|'.join(empty))
    else:
        print(f'OK:{len(clinics)}')

asyncio.run(main())
""")
    assert out.startswith("OK:"), (
        "The following clinic(s) have ZERO services — this breaks the "
        "Invoice → Add Service dropdown:\n  - " + out.replace("FAIL:", "").replace("|", "\n  - ")
    )
    total = int(out.split(":")[1])
    assert total >= 1, "Expected at least 1 clinic"


def test_seed_default_services_is_idempotent():
    """Calling seed_default_services twice must not double-insert rows."""
    out = _run(r"""
import asyncio, os
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
load_dotenv(Path('/app/backend/.env'))
import billing

async def main():
    c = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = c[os.environ['DB_NAME']]
    cid = 'test-idempotent-clinic-xyz-987654'
    await db.services.delete_many({'clinic_id': cid})
    n1 = await billing.seed_default_services(db, cid)
    n2 = await billing.seed_default_services(db, cid)
    count = await db.services.count_documents({'clinic_id': cid})
    await db.services.delete_many({'clinic_id': cid})
    c.close()
    expected = len(billing.DEFAULT_SERVICES)
    if n1 == expected and n2 == 0 and count == expected:
        print('OK')
    else:
        print(f'FAIL n1={n1} n2={n2} count={count} expected={expected}')

asyncio.run(main())
""")
    assert out == "OK", f"Seeder is not idempotent: {out}"
