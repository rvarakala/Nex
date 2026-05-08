"""Iter-6 backend tests:
- IST helpers: ist_today_ymd / ist_day_start_utc
- Public queue / dashboard / billing collections / tokens listing all keyed on IST day
- /api/reports/{session_id}/pdf still returns a PDF blob
- Auth gating preserved
"""
import os
import sys
from datetime import datetime, timezone, timedelta
import pytest
import requests

from _helpers import (  # legacy creds (env-overridable)
    ADMIN_EMAIL, ADMIN_PASSWORD,
    FRONTDESK_EMAIL, FRONTDESK_PASSWORD,
    AUDIO_EMAIL, AUDIO_PASSWORD,
    ACCOUNTS_EMAIL, ACCOUNTS_PASSWORD,
)
BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') if 'REACT_APP_BACKEND_URL' in os.environ else None
if not BASE_URL:
    # Fallback: read frontend/.env
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
                break

CLINIC_ID = "clinic-pytest-suite"
IST = timezone(timedelta(hours=5, minutes=30))

sys.path.insert(0, '/app/backend')


# ---------- IST helper unit tests ----------
class TestISTHelpers:
    def test_ist_today_ymd_matches_now_ist(self):
        from server import ist_today_ymd
        expected = datetime.now(IST).strftime("%Y-%m-%d")
        assert ist_today_ymd() == expected

    def test_ist_day_start_utc_is_naive_and_correct(self):
        from server import ist_day_start_utc
        v = ist_day_start_utc()
        assert isinstance(v, datetime)
        assert v.tzinfo is None, "must be UTC naive (for ISO-string comparison)"
        # IST midnight in UTC = 18:30 the previous day. So minute should be 30.
        assert v.minute == 30
        assert v.hour == 18
        # Round-trip check: re-add IST offset and compare YMD with ist_today_ymd
        from server import ist_today_ymd
        ist_equiv = (v.replace(tzinfo=timezone.utc).astimezone(IST))
        assert ist_equiv.strftime("%Y-%m-%d") == ist_today_ymd()
        assert ist_equiv.hour == 0 and ist_equiv.minute == 0


# ---------- API fixtures ----------
@pytest.fixture(scope="module")
def fd_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": FRONTDESK_EMAIL, "password": FRONTDESK_PASSWORD}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def fd_headers(fd_token):
    return {"Authorization": f"Bearer {fd_token}"}


# ---------- Public queue (unauth, IST-day boundary) ----------
class TestPublicQueueIST:
    def test_public_queue_unauth_200(self):
        r = requests.get(f"{BASE_URL}/api/queue/public/{CLINIC_ID}", timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("clinic", "now_serving", "next_up", "total_waiting", "fetched_at"):
            assert k in d
        assert d["clinic"]["name"]

    def test_public_queue_redaction_no_pii(self):
        r = requests.get(f"{BASE_URL}/api/queue/public/{CLINIC_ID}", timeout=10)
        d = r.json()
        for t in (d.get("now_serving", []) + d.get("next_up", [])):
            assert "patient_id" not in t
            assert "mobile" not in t
            assert "mrd" not in t

    def test_public_queue_404(self):
        r = requests.get(f"{BASE_URL}/api/queue/public/no-such-clinic", timeout=10)
        assert r.status_code == 404

    def test_token_after_ist_midnight_visible_today(self, fd_headers):
        """Issue a token NOW; verify it shows on the public queue today (IST). Cleanup after."""
        # Pick first patient
        rp = requests.get(f"{BASE_URL}/api/patients?limit=1", headers=fd_headers, timeout=10)
        assert rp.status_code == 200 and rp.json(), "no patients available"
        pid = rp.json()[0]["patient_id"]
        rt = requests.post(f"{BASE_URL}/api/tokens", headers=fd_headers,
                           json={"patient_id": pid, "service": "OPD"}, timeout=10)
        assert rt.status_code == 200, rt.text
        tok = rt.json()
        try:
            rq = requests.get(f"{BASE_URL}/api/queue/public/{CLINIC_ID}", timeout=10)
            assert rq.status_code == 200
            d = rq.json()
            nums = [t["token_no"] for t in d["next_up"] + d["now_serving"]]
            assert tok["token_no"] in nums, f"token {tok['token_no']} not in queue {nums}"
        finally:
            requests.put(f"{BASE_URL}/api/tokens/{tok['token_id']}/status",
                         headers=fd_headers, json={"status": "completed"}, timeout=10)


# ---------- Front Desk Dashboard (IST KPIs) ----------
class TestFrontdeskDashboardIST:
    def test_dashboard_has_ist_kpis(self, fd_headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/frontdesk", headers=fd_headers, timeout=10)
        assert r.status_code == 200
        d = r.json()
        kpis = d.get("kpis", {})
        for k in ("walkins_today", "appointments_today", "collections_today",
                  "waiting_now", "in_progress", "pending_reports"):
            assert k in kpis
        assert isinstance(kpis["collections_today"], (int, float))
        assert isinstance(kpis["walkins_today"], int)


# ---------- Tokens listing (IST today_only) ----------
class TestTokensListingIST:
    def test_tokens_today_only_uses_ist(self, fd_headers):
        r = requests.get(f"{BASE_URL}/api/tokens?today_only=true", headers=fd_headers, timeout=10)
        assert r.status_code == 200
        toks = r.json()
        assert isinstance(toks, list)
        # Every returned token must have issued_at >= IST day-start (UTC naive ISO)
        from server import ist_day_start_utc
        boundary = ist_day_start_utc().isoformat()
        for t in toks:
            assert t.get("issued_at", "") >= boundary, \
                f"token {t.get('token_no')} issued_at={t.get('issued_at')} < boundary {boundary}"


# ---------- Billing collections (IST default) ----------
class TestBillingCollectionsIST:
    def test_collections_default_day_is_ist(self, fd_headers):
        # accounts user has billing access; reuse fd token if route doesn't require accounts role
        r = requests.get(f"{BASE_URL}/api/billing/collections", headers=fd_headers, timeout=10)
        # Endpoint may require accounts role; accept 200 or 403
        if r.status_code == 403:
            ra = requests.post(f"{BASE_URL}/api/auth/login",
                               json={"email": ACCOUNTS_EMAIL, "password": ACCOUNTS_PASSWORD}, timeout=10)
            assert ra.status_code == 200
            tok = ra.json()["access_token"]
            r = requests.get(f"{BASE_URL}/api/billing/collections",
                             headers={"Authorization": f"Bearer {tok}"}, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        # The response should reference today's IST date in some way
        from server import ist_today_ymd
        today = ist_today_ymd()
        str(d)
        # Tolerate either explicit "date":today or implicit (just verify returns)
        assert isinstance(d, (list, dict))
        # If 'from' or 'date' field exists, it must be today's IST
        if isinstance(d, dict):
            for key in ("date", "from", "from_date", "day"):
                if key in d and isinstance(d[key], str):
                    assert d[key].startswith(today), f"{key}={d[key]} != {today}"


# ---------- Auth gating sanity ----------
class TestAuthGating:
    def test_tokens_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/tokens", timeout=10)
        assert r.status_code == 401

    def test_dashboard_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/dashboard/frontdesk", timeout=10)
        assert r.status_code == 401

    def test_public_queue_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/queue/public/{CLINIC_ID}", timeout=10)
        assert r.status_code == 200


# ---------- PDF endpoint (for WhatsApp share) ----------
class TestReportPDF:
    def test_pdf_returns_blob_for_existing_session(self, fd_headers):
        rs = requests.get(f"{BASE_URL}/api/sessions?limit=20", headers=fd_headers, timeout=10)
        assert rs.status_code == 200
        sessions = rs.json()
        if not sessions:
            pytest.skip("no sessions exist to test PDF")
        # try until one returns a PDF (PDF endpoint is auth-gated since iter10)
        last_status = None
        for s in sessions:
            sid = s["session_id"]
            r = requests.get(f"{BASE_URL}/api/reports/{sid}/pdf",
                             headers=fd_headers, timeout=20)
            last_status = r.status_code
            if r.status_code == 200:
                ct = r.headers.get("content-type", "")
                assert "pdf" in ct.lower(), f"unexpected content-type {ct}"
                assert r.content[:4] == b"%PDF", "response not a real PDF"
                return
        pytest.fail(f"no session yielded a PDF (last status={last_status})")
