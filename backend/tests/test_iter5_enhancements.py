"""Iteration 5 enhancement tests: Public Queue TV endpoint, Book-Next CTA prerequisites, Cmd+K (backend-side only).

Focus: validate the new GET /api/queue/public/{clinic_id} unauthenticated endpoint.
- 200 with shape {clinic, now_serving, next_up, total_waiting, fetched_at} for valid clinic
- 404 for unknown clinic
- Privacy redaction of patient_name to "First L." format
- No sensitive fields leaked (patient_id, mobile, mrd)
- Confirms a sibling authenticated endpoint still returns 401 without Bearer
- Polling test: issue token then re-fetch within 10s sees the new token
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"
CLINIC_ID = "clinic-acs-demo"


@pytest.fixture(scope="module")
def fd_token():
    r = requests.post(f"{API}/auth/login", json={"email": "frontdesk@acs.in", "password": "frontdesk123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def fd_headers(fd_token):
    return {"Authorization": f"Bearer {fd_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def test_patient(fd_headers):
    """Create a TEST_QTV patient with a multi-word name to verify redaction."""
    payload = {
        "name": "TESTQTV Ramesh Kumar",
        "age": 45,
        "gender": "Male",
        "mobile": "9988776655",
    }
    r = requests.post(f"{API}/patients", json=payload, headers=fd_headers, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Public Queue Endpoint ----------

class TestPublicQueue:
    def test_public_queue_no_auth_returns_200(self):
        r = requests.get(f"{API}/queue/public/{CLINIC_ID}", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # Required shape
        for key in ("clinic", "now_serving", "next_up", "total_waiting", "fetched_at"):
            assert key in data, f"missing {key} in {list(data.keys())}"
        assert isinstance(data["now_serving"], list)
        assert isinstance(data["next_up"], list)
        assert isinstance(data["total_waiting"], int)
        assert data["clinic"]["name"]
        # _id must NOT leak through
        assert "_id" not in data["clinic"]

    def test_public_queue_404_for_bogus_clinic(self):
        r = requests.get(f"{API}/queue/public/bogus-id-xxx", timeout=15)
        assert r.status_code == 404

    def test_public_queue_explicitly_no_auth_header_works(self):
        # Send completely empty headers (no Authorization)
        s = requests.Session()
        s.headers.clear()
        r = s.get(f"{API}/queue/public/{CLINIC_ID}", timeout=15)
        assert r.status_code == 200

    def test_authd_endpoint_still_requires_bearer(self):
        # spot-check sibling auth endpoint
        r = requests.get(f"{API}/tokens", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


# ---------- Privacy Redaction & Polling ----------

class TestPublicQueuePrivacy:
    def test_token_appears_in_public_queue_with_redacted_name(self, fd_headers, test_patient):
        # Issue a token
        r = requests.post(
            f"{API}/tokens",
            json={"patient_id": test_patient["patient_id"], "service": "Audiometry"},
            headers=fd_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        tok = r.json()
        token_no = tok["token_no"]

        # Poll the public queue (tests the 5s "freshness")
        found = None
        sensitive_leak = []
        for _ in range(3):
            time.sleep(1)
            pr = requests.get(f"{API}/queue/public/{CLINIC_ID}", timeout=15)
            assert pr.status_code == 200
            payload = pr.json()
            for entry in payload["next_up"] + payload["now_serving"]:
                if entry.get("token_no") == token_no:
                    found = entry
                    for forbidden in ("patient_id", "mobile", "patient_mobile", "mrd"):
                        if forbidden in entry:
                            sensitive_leak.append(forbidden)
                    break
            if found:
                break

        assert found is not None, "Newly-issued token not visible in public queue within 3s polls"
        assert not sensitive_leak, f"Leaked sensitive fields: {sensitive_leak}"

        # Redaction: original name = "TESTQTV Ramesh Kumar" → expect "TESTQTV K."  (first + last initial.)
        # Implementation in server.py: f"{parts[0]} {parts[-1][0]}."
        name = found.get("patient_name", "")
        assert name.endswith("."), f"name not redacted: {name!r}"
        assert "Ramesh" not in name and "Kumar" not in name, f"Full middle/last name leaked: {name!r}"
        assert name.startswith("TESTQTV"), f"first name dropped: {name!r}"

    def test_cleanup_complete_token(self, fd_headers, test_patient):
        # Mark the test patient's tokens as completed to clean up
        r = requests.get(f"{API}/tokens", headers=fd_headers, timeout=15)
        assert r.status_code == 200
        for t in r.json():
            if t.get("patient_id") == test_patient["patient_id"] and t.get("status") in {"waiting", "in_consultation", "in_testing"}:
                requests.put(
                    f"{API}/tokens/{t['token_id']}/status",
                    json={"status": "completed"},
                    headers=fd_headers,
                    timeout=15,
                )


# ---------- Book Next CTA prerequisite: ensure a PAID invoice exists ----------

class TestPaidInvoicePresence:
    def test_paid_invoice_exists_or_create_one(self, fd_headers, test_patient):
        # First check if paid invoice already exists
        r = requests.get(f"{API}/billing/invoices?status=paid&limit=5", headers=fd_headers, timeout=15)
        assert r.status_code == 200
        if r.json():
            return  # already have a paid invoice
        # Otherwise create one with full payment
        # Get any catalogue service
        sr = requests.get(f"{API}/billing/services", headers=fd_headers, timeout=15)
        assert sr.status_code == 200
        services = [s for s in sr.json() if s.get("active", True)]
        assert services, "No services in catalogue to create invoice"
        svc = services[0]
        line = {
            "service_id": svc["service_id"],
            "name": svc["name"],
            "qty": 1,
            "unit_price": float(svc.get("price", 500)),
            "gst_rate": float(svc.get("gst_rate", 0)),
            "exempt": bool(svc.get("exempt", False)),
        }
        # Compute grand total roughly to send as initial_payment
        sub = line["qty"] * line["unit_price"]
        tax = 0.0 if line["exempt"] else round(sub * line["gst_rate"] / 100, 2)
        grand = round(sub + tax, 2)
        payload = {
            "patient_id": test_patient["patient_id"],
            "lines": [line],
            "notes": "TEST_QTV paid invoice",
            "initial_payment": {"amount": grand, "method": "cash"},
        }
        cr = requests.post(f"{API}/billing/invoices", json=payload, headers=fd_headers, timeout=15)
        assert cr.status_code == 200, cr.text
        inv = cr.json()
        assert inv["status"] == "paid", f"expected paid, got {inv['status']} (grand={grand} paid={inv.get('paid_total')})"
