"""HA Service Tickets + Analytics enhancements — backend tests.

Covers:
- Service ticket CRUD + lifecycle (open → in_progress → resolved → closed)
- Cancel path (→ DAMAGED on attached serial)
- Serial state transitions (SOLD → SERVICE_IN → RETURNED)
- Role gates (accounts blocked from create; technician can create + mutate)
- Analytics drill-down endpoint
- CSV exports (sales / revenue / inventory)
"""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests


from _helpers import ADMIN_EMAIL, ADMIN_PASSWORD  # legacy creds (env-overridable)
_url = os.environ.get("REACT_APP_BACKEND_URL")
if not _url:
    with open("/app/frontend/.env") as _fh:
        for _ln in _fh:
            if _ln.startswith("REACT_APP_BACKEND_URL="):
                _url = _ln.split("=", 1)[1].strip()
                break
BASE_URL = _url.rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"login failed for {email}")
    return r.json()["access_token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_token(): return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def audiologist_token(): return _login("audiologist@acs.in", "audio123")


@pytest.fixture(scope="session")
def frontdesk_token(): return _login("frontdesk@acs.in", "frontdesk123")


@pytest.fixture(scope="session")
def accounts_token(): return _login("accounts@acs.in", "accounts123")


@pytest.fixture(scope="session")
def primary_branch(admin_token):
    return requests.get(f"{API}/branches", headers=hdr(admin_token)).json()[0]["branch_id"]


@pytest.fixture(scope="session")
def some_patient(admin_token):
    return requests.get(f"{API}/patients?limit=1", headers=hdr(admin_token)).json()[0]["patient_id"]


def _sold_serial(admin_token):
    """Find a SOLD serial (or skip)."""
    r = requests.get(f"{API}/ha/serial-items?state=SOLD&limit=10", headers=hdr(admin_token))
    rows = r.json()
    if not rows:
        pytest.skip("No SOLD serials available for service ticket test")
    return rows[0]["serial_id"]


# ==================== SERVICE TICKET CRUD ====================

class TestTicketCRUD:
    def test_audiologist_create_with_serial(self, audiologist_token, primary_branch, some_patient, admin_token):
        sid = _sold_serial(admin_token)
        r = requests.post(f"{API}/ha/service-tickets", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient, "serial_id": sid,
            "kind": "repair", "complaint": "Receiver distortion after 6 months",
            "warranty_covered": True,
        }, timeout=15)
        assert r.status_code == 201, r.text
        t = r.json()
        assert t["ticket_no"].startswith("JOB-")
        assert t["status"] == "open"
        assert t["serial_no"]
        TestTicketCRUD.tno = t["ticket_no"]
        TestTicketCRUD.serial_id = sid
        # Serial state moved to SERVICE_IN
        s = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(admin_token)).json()
        assert s["state"] == "SERVICE_IN"

    def test_accounts_cannot_create(self, accounts_token, primary_branch, some_patient):
        r = requests.post(f"{API}/ha/service-tickets", headers=hdr(accounts_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "kind": "repair", "complaint": "should be blocked",
        }, timeout=15)
        assert r.status_code == 403, r.text

    def test_short_complaint_400(self, audiologist_token, primary_branch, some_patient):
        r = requests.post(f"{API}/ha/service-tickets", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient,
            "kind": "repair", "complaint": "x",
        }, timeout=15)
        assert r.status_code == 400, r.text


# ==================== LIFECYCLE ====================

class TestLifecycle:
    def test_move_to_in_progress(self, audiologist_token):
        tno = TestTicketCRUD.tno
        r = requests.put(f"{API}/ha/service-tickets/{tno}",
                         headers=hdr(audiologist_token),
                         json={"status": "in_progress", "diagnosis": "Receiver replacement needed"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "in_progress"
        assert r.json()["diagnosis"] == "Receiver replacement needed"

    def test_cannot_skip_to_closed(self, audiologist_token):
        tno = TestTicketCRUD.tno
        r = requests.put(f"{API}/ha/service-tickets/{tno}",
                         headers=hdr(audiologist_token),
                         json={"status": "closed"}, timeout=15)
        assert r.status_code == 409, r.text

    def test_resolve_moves_serial_back(self, audiologist_token, admin_token):
        tno = TestTicketCRUD.tno
        sid = TestTicketCRUD.serial_id
        r = requests.post(f"{API}/ha/service-tickets/{tno}/resolve",
                          headers=hdr(audiologist_token),
                          json={"resolution_notes": "Replaced receiver under warranty",
                                "cost_to_patient": 0, "warranty_covered": True}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "resolved"
        assert r.json()["resolved_at"]
        # Serial back to RETURNED (patient-owned) or IN_STOCK (clinic-owned)
        s = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(admin_token)).json()
        assert s["state"] in {"RETURNED", "IN_STOCK"}

    def test_cannot_resolve_twice(self, audiologist_token):
        tno = TestTicketCRUD.tno
        r = requests.post(f"{API}/ha/service-tickets/{tno}/resolve",
                          headers=hdr(audiologist_token),
                          json={"resolution_notes": "again", "cost_to_patient": 0}, timeout=15)
        assert r.status_code == 409

    def test_close(self, audiologist_token):
        tno = TestTicketCRUD.tno
        r = requests.post(f"{API}/ha/service-tickets/{tno}/close",
                          headers=hdr(audiologist_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "closed"
        assert r.json()["closed_at"]


class TestCancel:
    def test_cancel_damages_serial(self, audiologist_token, primary_branch, some_patient, admin_token):
        sid = _sold_serial(admin_token)
        t = requests.post(f"{API}/ha/service-tickets", headers=hdr(audiologist_token), json={
            "branch_id": primary_branch, "patient_id": some_patient, "serial_id": sid,
            "kind": "repair", "complaint": "Water damage — cancelled test",
        }, timeout=15).json()
        r = requests.post(f"{API}/ha/service-tickets/{t['ticket_no']}/cancel",
                          headers=hdr(audiologist_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "cancelled"
        # serial → DAMAGED
        s = requests.get(f"{API}/ha/serial-items/{sid}", headers=hdr(admin_token)).json()
        assert s["state"] == "DAMAGED"

    def test_front_desk_cannot_cancel(self, frontdesk_token, primary_branch, some_patient, admin_token):
        sid = _sold_serial(admin_token)
        t = requests.post(f"{API}/ha/service-tickets", headers=hdr(frontdesk_token), json={
            "branch_id": primary_branch, "patient_id": some_patient, "serial_id": sid,
            "kind": "cleaning", "complaint": "Front-desk created this",
        }, timeout=15).json()
        r = requests.post(f"{API}/ha/service-tickets/{t['ticket_no']}/cancel",
                          headers=hdr(frontdesk_token), timeout=15)
        assert r.status_code == 403
        # cleanup: admin cancels
        requests.post(f"{API}/ha/service-tickets/{t['ticket_no']}/cancel",
                      headers=hdr(requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15).json()["access_token"]))


class TestKPIs:
    def test_structure(self, admin_token):
        r = requests.get(f"{API}/ha/service-tickets-kpis", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("open", "in_progress", "resolved", "closed", "warranty_covered"):
            assert k in d and isinstance(d[k], int)


# ==================== ANALYTICS DRILL + CSV ====================

class TestDrillDown:
    def test_sales_drill_default(self, admin_token):
        r = requests.get(f"{API}/ha/analytics/sales-drill", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "count" in d and "rows" in d
        assert d["count"] == len(d["rows"])

    def test_sales_drill_date_range(self, admin_token):
        today = date.today().isoformat()
        next_d = (date.today() + timedelta(days=1)).isoformat()
        r = requests.get(f"{API}/ha/analytics/sales-drill?start={today}&end={next_d}",
                         headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200
        for s in r.json()["rows"]:
            assert s["created_at"][:10] >= today
            assert s["created_at"][:10] < next_d

    def test_sales_drill_frontdesk_forbidden(self, frontdesk_token):
        r = requests.get(f"{API}/ha/analytics/sales-drill", headers=hdr(frontdesk_token), timeout=15)
        assert r.status_code == 403


class TestCSVExport:
    def test_export_sales_csv(self, admin_token):
        r = requests.get(f"{API}/ha/analytics/export/sales.csv", headers=hdr(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        assert "attachment" in r.headers.get("content-disposition", "")
        assert r.text.startswith("sale_no,")    # header row

    def test_export_revenue_csv(self, admin_token):
        r = requests.get(f"{API}/ha/analytics/export/revenue.csv?months=12",
                         headers=hdr(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        assert r.text.startswith("month,revenue,subtotal,gst,discount,sales_count")

    def test_export_inventory_csv(self, admin_token):
        r = requests.get(f"{API}/ha/analytics/export/inventory.csv",
                         headers=hdr(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        assert r.text.startswith("serial_no,")

    def test_audiologist_cannot_export(self, audiologist_token):
        r = requests.get(f"{API}/ha/analytics/export/sales.csv", headers=hdr(audiologist_token), timeout=15)
        assert r.status_code == 403


# ==================== REGRESSION ====================

class TestRegression:
    @pytest.mark.parametrize("path", [
        "/ha/service-tickets", "/ha/service-tickets-kpis",
        "/ha/analytics/sales-drill",
        "/ha/analytics/revenue", "/ha/analytics/funnel",
        "/ha/followups", "/ha/subscriptions", "/ha/trials", "/ha/fittings",
        "/ha/sales", "/ha/quotations", "/ha/products", "/ha/serial-items",
    ])
    def test_endpoint_200(self, admin_token, path):
        r = requests.get(f"{API}{path}", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, f"{path} → {r.status_code}"
