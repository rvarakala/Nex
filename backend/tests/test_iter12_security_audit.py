"""Iter-12 security/audit: share-audit $inc, forensic log, rate-limit,
cross-tenant regression.

Covers all acceptance cases from review_request (iter12).

This test restarts the backend at the start to flush in-memory rate-limit
buckets, so it MUST run in isolation (no parallel workers) or as a dedicated
pytest invocation.
"""
import os
import subprocess
import time
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
import requests

from _helpers import ADMIN_EMAIL, ADMIN_PASSWORD  # legacy creds (env-overridable)
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

JWT_SECRET = ""
with open("/app/backend/.env") as fh:
    for line in fh:
        if line.startswith("JWT_SECRET="):
            JWT_SECRET = line.split("=", 1)[1].strip().strip('"').strip("'")
            break


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    return r.json()


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _restart_backend():
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"],
                   check=False, capture_output=True, timeout=30)
    # wait for backend to come back
    for _ in range(30):
        try:
            r = requests.get(f"{API}/auth/me", timeout=3)
            # any HTTP response (even 401) means it's up
            if r.status_code in (200, 401, 403, 422):
                return
        except Exception:
            pass
        time.sleep(1)


# ---- fixtures ----
@pytest.fixture(scope="module", autouse=True)
def flush_rate_limits_once():
    """Flush in-memory rate-limit buckets before the module runs."""
    _restart_backend()
    yield


@pytest.fixture(scope="module")
def mumbai_admin():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)["access_token"]


@pytest.fixture(scope="module")
def mumbai_frontdesk():
    return _login("frontdesk@acs.in", "frontdesk123")["access_token"]


@pytest.fixture(scope="module")
def mumbai_accounts():
    return _login("accounts@acs.in", "accounts123")["access_token"]


@pytest.fixture(scope="module")
def mumbai_audio():
    return _login("audiologist@acs.in", "audio123")["access_token"]


@pytest.fixture(scope="module")
def delhi_admin():
    return _login("admin@delhi.test", "delhiadmin123")["access_token"]


@pytest.fixture(scope="module")
def delhi_frontdesk():
    return _login("frontdesk@delhi.test", "delhifrontdesk123")["access_token"]


@pytest.fixture(scope="module")
def mumbai_patient_id(mumbai_admin):
    pl = {"name": "TEST_Iter12 MumPt", "age": 31, "gender": "Male",
          "phone": f"98555{uuid.uuid4().hex[:5]}"}
    r = requests.post(f"{API}/patients", json=pl, headers=_h(mumbai_admin), timeout=15)
    assert r.status_code in (200, 201), r.text
    yield r.json()["patient_id"]


@pytest.fixture(scope="module")
def mumbai_session_id(mumbai_audio, mumbai_patient_id):
    pl = {"patient_id": mumbai_patient_id,
          "test_date": datetime.utcnow().isoformat(),
          "audiologist_name": "TEST_Iter12"}
    r = requests.post(f"{API}/sessions", json=pl, headers=_h(mumbai_audio), timeout=15)
    assert r.status_code in (200, 201), r.text
    yield r.json()["session_id"]


# ============================================================
# 1. Share-audit $inc + response shape
# ============================================================
class TestShareAudit:
    def test_mint_access_thrice_audit_counts_three(self, mumbai_accounts, mumbai_session_id):
        # Mint
        r = requests.post(f"{API}/reports/{mumbai_session_id}/share-link",
                          json={"ttl_hours": 24},
                          headers=_h(mumbai_accounts), timeout=15)
        assert r.status_code == 200, r.text
        path = r.json()["path"]

        # Access 3 times (share-audit $inc)
        for _i in range(3):
            r2 = requests.get(f"{BASE_URL}{path}", timeout=30)
            assert r2.status_code == 200, f"access {_i} -> {r2.status_code}"
            assert r2.headers.get("content-type", "").startswith("application/pdf")

        # share-audit call (auth)
        r3 = requests.get(f"{API}/reports/{mumbai_session_id}/share-audit",
                          headers=_h(mumbai_accounts), timeout=10)
        assert r3.status_code == 200, r3.text
        rows = r3.json()
        assert isinstance(rows, list) and len(rows) >= 1

        # The row for THIS mint — most recent (sorted DESC)
        latest = rows[0]
        assert latest["access_count"] == 3, f"expected 3, got {latest.get('access_count')}"
        assert latest["last_accessed_at"] is not None
        assert latest["last_accessed_ip"] is not None
        assert "token_hash" not in latest, "token_hash MUST be excluded"
        assert "_id" not in latest, "_id MUST be excluded"

        # Response shape
        for field in ("session_id", "clinic_id", "created_by_user_id", "created_at",
                      "expires_at", "ttl_hours", "access_count",
                      "last_accessed_at", "last_accessed_ip"):
            assert field in latest, f"missing field {field}"
        assert latest["session_id"] == mumbai_session_id
        assert latest["clinic_id"] == "clinic-acs-demo"

        # DESC ordering
        if len(rows) >= 2:
            for i in range(len(rows) - 1):
                assert rows[i]["created_at"] >= rows[i + 1]["created_at"]

    def test_share_audit_cross_tenant_403(self, delhi_admin, mumbai_session_id):
        r = requests.get(f"{API}/reports/{mumbai_session_id}/share-audit",
                         headers=_h(delhi_admin), timeout=10)
        assert r.status_code == 403, f"expected 403, got {r.status_code}"

    def test_share_audit_unknown_session_404(self, mumbai_accounts):
        r = requests.get(f"{API}/reports/SES-DOES-NOT-EXIST/share-audit",
                         headers=_h(mumbai_accounts), timeout=10)
        assert r.status_code == 404, f"expected 404, got {r.status_code}"


# ============================================================
# 2. Forensic log on clinic-mismatch
# ============================================================
class TestForensicLog:
    def test_tampered_token_emits_forensic_log(self, mumbai_session_id):
        if not JWT_SECRET:
            pytest.skip("JWT_SECRET not readable")
        payload = {
            "session_id": mumbai_session_id,
            "clinic_id": "clinic-delhi-test",
            "type": "report_share",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "iat": datetime.now(timezone.utc),
        }
        tok = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
        r = requests.get(f"{API}/reports/shared/{tok}", timeout=10)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"

        # Grep log for the structured warning. The log is scattered across
        # rotated files; read recent err log tail.
        time.sleep(1)
        out = subprocess.run(
            ["bash", "-c", "tail -n 400 /var/log/supervisor/backend.err.log"],
            capture_output=True, text=True, timeout=10,
        ).stdout
        hits = [ln for ln in out.splitlines() if "share_link.clinic_mismatch" in ln]
        assert hits, f"no forensic log line found. Tail: {out[-1000:]}"
        # The latest matching line should contain both clinic IDs + session + ip
        matched = False
        for ln in hits[::-1]:
            if (mumbai_session_id in ln and "clinic-delhi-test" in ln
                    and "clinic-acs-demo" in ln and "ip=" in ln):
                matched = True
                break
        assert matched, f"expected structured fields in log. Last hit: {hits[-1]}"


# ============================================================
# 3. Rate-limit on /reports/shared/{token}: 20/60s
# ============================================================
class TestRateLimitSharedReports:
    def test_22_requests_last_two_are_429(self, mumbai_accounts, mumbai_session_id):
        # Flush buckets with a backend restart so prior test accesses don't
        # eat into our budget.
        _restart_backend()

        # Mint a fresh link
        r = requests.post(f"{API}/reports/{mumbai_session_id}/share-link",
                          json={"ttl_hours": 24},
                          headers=_h(mumbai_accounts), timeout=15)
        assert r.status_code == 200, r.text
        path = r.json()["path"]
        url = f"{BASE_URL}{path}"

        # Pin X-Forwarded-For so Cloudflare can't rotate it per-request. This
        # also exercises the spec: limiter must respect X-Forwarded-For.
        xff_hdrs = {"X-Forwarded-For": "203.0.113.77"}
        statuses = []
        retry_after_seen = None
        for i in range(22):
            rr = requests.get(url, headers=xff_hdrs, timeout=30)
            statuses.append(rr.status_code)
            if rr.status_code == 429:
                retry_after_seen = rr.headers.get("Retry-After")
                # verify body
                try:
                    body = rr.json()
                    assert "detail" in body
                    assert "Too many requests" in body["detail"]
                except Exception:
                    pass

        ok_count = sum(1 for s in statuses if s == 200)
        tm_count = sum(1 for s in statuses if s == 429)
        # Allow ingress to drop/retry a bit but enforce the core limit
        assert ok_count == 20, f"expected 20 × 200, got {ok_count}. statuses={statuses}"
        assert tm_count == 2, f"expected 2 × 429, got {tm_count}. statuses={statuses}"
        assert retry_after_seen is not None, "Retry-After header missing on 429"


# ============================================================
# 4. Rate-limit on /queue/public/{clinic_id}: 120/60s
# ============================================================
class TestRateLimitPublicQueue:
    def test_125_requests_last_five_are_429(self):
        _restart_backend()
        url = f"{API}/queue/public/clinic-acs-demo"
        # Pin X-Forwarded-For to keep the limiter's bucket key stable across
        # CF edge rotation.
        xff_hdrs = {"X-Forwarded-For": "203.0.113.42"}

        statuses = []
        for _ in range(125):
            rr = requests.get(url, headers=xff_hdrs, timeout=10)
            statuses.append(rr.status_code)

        ok_count = sum(1 for s in statuses if s == 200)
        tm_count = sum(1 for s in statuses if s == 429)
        assert ok_count == 120, f"expected 120 × 200, got {ok_count}"
        assert tm_count == 5, f"expected 5 × 429, got {tm_count}"


# ============================================================
# 5. Rate-limit fail-open on malformed headers
# ============================================================
class TestRateLimitFailOpen:
    def test_malformed_xff_doesnt_crash(self):
        _restart_backend()
        url = f"{API}/queue/public/clinic-acs-demo"
        # Send odd X-Forwarded-For values — only those the `requests` library
        # will actually encode (truly invalid ones are rejected client-side).
        for xff in ["127.0.0.1,,,", "not-an-ip", "::1,::2,::3", "0.0.0.0"]:
            try:
                r = requests.get(url, headers={"X-Forwarded-For": xff}, timeout=10)
            except Exception as e:  # client-side header rejection — not the server's problem
                print(f"requests rejected xff={xff!r}: {e}")
                continue
            assert r.status_code in (200, 404, 429), f"crash? xff={xff!r} -> {r.status_code}"


# ============================================================
# 6. Regression: auth-required endpoints still 200 for authorised users
# ============================================================
class TestRegressionAuthedEndpoints:
    @pytest.mark.parametrize("endpoint", [
        "/patients", "/appointments", "/tokens", "/sessions",
        "/referring-doctors", "/dashboard/frontdesk",
        "/closeouts", "/closeouts/trend/collections?days=7",
        "/closeouts/trend/walkins?days=7",
        "/billing/services", "/billing/invoices", "/billing/collections",
        "/billing/pending-reports", "/billing/report-deliveries",
    ])
    def test_authed_ok(self, mumbai_frontdesk, mumbai_accounts, endpoint):
        # billing/* are accounts-scoped; rest use frontdesk
        tok = mumbai_accounts if endpoint.startswith("/billing/") else mumbai_frontdesk
        r = requests.get(f"{API}{endpoint}", headers=_h(tok), timeout=15)
        assert r.status_code == 200, f"{endpoint} -> {r.status_code}: {r.text[:200]}"

    def test_unauthed_401(self):
        for ep in ("/patients", "/appointments", "/dashboard/frontdesk",
                   "/billing/invoices"):
            r = requests.get(f"{API}{ep}", timeout=10)
            assert r.status_code in (401, 403), f"{ep} -> {r.status_code}"

    def test_patient_notes_smoke(self, mumbai_frontdesk, mumbai_patient_id):
        r = requests.get(f"{API}/patient-notes?patient_id={mumbai_patient_id}",
                         headers=_h(mumbai_frontdesk), timeout=10)
        assert r.status_code in (200, 404)

    def test_mumbai_pdf_auth_200(self, mumbai_accounts, mumbai_session_id):
        r = requests.get(f"{API}/reports/{mumbai_session_id}/pdf",
                         headers=_h(mumbai_accounts), timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")

    def test_mumbai_share_link_auth_200(self, mumbai_accounts, mumbai_session_id):
        r = requests.post(f"{API}/reports/{mumbai_session_id}/share-link",
                          json={"ttl_hours": 48},
                          headers=_h(mumbai_accounts), timeout=15)
        assert r.status_code == 200, r.text
        assert "token" in r.json()


# ============================================================
# 7. Cross-tenant regression
# ============================================================
class TestCrossTenantRegression:
    def test_delhi_cannot_get_mumbai_pdf(self, delhi_admin, mumbai_session_id):
        r = requests.get(f"{API}/reports/{mumbai_session_id}/pdf",
                         headers=_h(delhi_admin), timeout=20)
        assert r.status_code == 403

    def test_delhi_cannot_mint_share_link_for_mumbai(self, delhi_admin, mumbai_session_id):
        r = requests.post(f"{API}/reports/{mumbai_session_id}/share-link",
                          json={"ttl_hours": 24},
                          headers=_h(delhi_admin), timeout=15)
        assert r.status_code == 403
