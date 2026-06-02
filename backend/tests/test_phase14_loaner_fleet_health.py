"""Phase 14 — Loaner Fleet Health KPI endpoint regression.

Verifies GET /api/ha/service/loaner-fleet-health returns:
- on_loan_count matching current ON_LOAN serials
- days_out_buckets histogram + overdue list
- deposits ledger (collected / refunded / forfeited / held)

Run: `cd /app/backend && pytest tests/test_phase14_loaner_fleet_health.py -x`
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

from _helpers import API, ADMIN_EMAIL, ADMIN_PASSWORD, login, H


@pytest.fixture(scope="module")
def tok():
    return login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def mongo():
    cli = MongoClient(os.environ["MONGO_URL"])
    return cli[os.environ["DB_NAME"]]


def test_loaner_fleet_health_basic_shape(tok):
    """Endpoint exists for any authenticated user and returns the expected shape."""
    r = requests.get(f"{API}/ha/service/loaner-fleet-health", headers=H(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("on_loan_count", "open_tickets", "days_out_buckets",
              "overdue", "overdue_count", "deposits", "as_of"):
        assert k in body, f"missing key {k}"
    for b in ("0-3d", "4-7d", "8-14d", "15d+"):
        assert b in body["days_out_buckets"]
    for d in ("collected", "refunded", "forfeited", "held"):
        assert d in body["deposits"]


def test_loaner_fleet_health_reflects_state_changes(tok, mongo):
    """When a loaner is issued + a fresh ticket is created in the DB,
    counts move accordingly. Idempotent — cleans up after itself."""
    me = requests.get(f"{API}/auth/me", headers=H(tok)).json()
    clinic_id = me["user"]["clinic_id"]

    # Snapshot before
    base = requests.get(f"{API}/ha/service/loaner-fleet-health", headers=H(tok)).json()
    base_on_loan = base["on_loan_count"]

    # Synthesise a fake open loaner ticket directly in DB so we don't need
    # to walk the full ticket-create UX in this test. The endpoint only
    # reads from `serial_items.state` + `service_tickets.loaner_*` fields.
    sid = "TEST-LOANER-FH-001"
    tno = "TEST-TKT-LOANER-FH"
    eight_days_ago = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
    mongo.serial_items.insert_one({
        "serial_id": sid, "clinic_id": clinic_id, "serial_no": "SN-FH-001",
        "state": "ON_LOAN", "branch_id": None,
    })
    mongo.service_tickets.insert_one({
        "ticket_no": tno, "clinic_id": clinic_id, "branch_id": None,
        "patient_id": "PT-FH", "patient_name": "Fleet Health Test",
        "patient_mobile": "+919999999999",
        "loaner_serial_id": sid,
        "loaner_issued_at": eight_days_ago,
        "loaner_deposit_amount": 2000.0,
        "loaner_deposit_collected_at": eight_days_ago,
        "loaner_returned_at": None,
        "status": "in_progress", "kind": "repair",
    })

    try:
        after = requests.get(f"{API}/ha/service/loaner-fleet-health", headers=H(tok)).json()
        assert after["on_loan_count"] >= base_on_loan + 1
        assert after["open_tickets"] >= base["open_tickets"] + 1
        # 8 days out → overdue bucket
        assert after["overdue_count"] >= base["overdue_count"] + 1
        # Bucket histogram should reflect the 8-14d entry
        assert after["days_out_buckets"]["8-14d"] >= 1
        # Deposits — collected jumped by 2000
        assert after["deposits"]["collected"] >= base["deposits"]["collected"] + 1999
        # The new ticket should appear in the overdue list
        match = [r for r in after["overdue"] if r["ticket_no"] == tno]
        assert match, "synthetic ticket should appear in overdue list"
        assert match[0]["days_out"] >= 8
        assert match[0]["deposit_amount"] == 2000.0
    finally:
        mongo.serial_items.delete_one({"serial_id": sid})
        mongo.service_tickets.delete_one({"ticket_no": tno})


def test_quiet_hours_helper_wraps_midnight():
    """Quiet hours helper handles wrap-around windows (e.g. 22:00 → 07:00)."""
    from utils.error_alerts import _in_quiet_hours

    base = {"quiet_start": "22:00", "quiet_end": "07:00"}
    # IST = UTC+5:30. Pick 23:00 IST = 17:30 UTC → inside quiet window.
    inside = datetime(2026, 6, 2, 17, 30, tzinfo=timezone.utc)
    assert _in_quiet_hours(base, inside) is True

    # 06:30 IST = 01:00 UTC → still inside (wrap)
    wrap = datetime(2026, 6, 2, 1, 0, tzinfo=timezone.utc)
    assert _in_quiet_hours(base, wrap) is True

    # 10:00 IST = 04:30 UTC → outside
    outside = datetime(2026, 6, 2, 4, 30, tzinfo=timezone.utc)
    assert _in_quiet_hours(base, outside) is False

    # Disabled (either side blank) → never quiet
    assert _in_quiet_hours({"quiet_start": "", "quiet_end": "07:00"}, inside) is False
    assert _in_quiet_hours({"quiet_start": "22:00", "quiet_end": ""}, inside) is False

    # Non-wrap window
    daytime = {"quiet_start": "09:00", "quiet_end": "17:00"}
    # 12:00 IST = 06:30 UTC → inside
    noon = datetime(2026, 6, 2, 6, 30, tzinfo=timezone.utc)
    assert _in_quiet_hours(daytime, noon) is True
    # 20:00 IST = 14:30 UTC → outside
    evening = datetime(2026, 6, 2, 14, 30, tzinfo=timezone.utc)
    assert _in_quiet_hours(daytime, evening) is False
