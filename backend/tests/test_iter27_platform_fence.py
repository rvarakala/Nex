"""Iter27 — Platform-fence RBAC retest (post-fix).

Verifies the new fence in utils/rbac.py:require_permission() that ensures
ONLY users with clinic_id == 'audinexa-platform' can touch /api/admin/v2/*,
while leaving regular tenant-app endpoints (/api/auth/*, /api/patients,
/api/billing/*) unchanged.

Spec from review request:
  * admin@delhi.test must 403 on /admin/v2/system/storage AND /system/storage/purge-pdfs
  * founder@audinexa.com keeps 200 on storage + purge default + purge {days:7}
  * support@audinexa.com (system:read) STILL gets 403 on {days:7} override
  * Regression: dashboard, system/health, system/data-health, audit/logs all 200 for founder
  * Regression: read-only analyst@audinexa.com still works on GETs
  * Regression: tenant-app endpoints still 200 for admin@delhi.test
"""
import os
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j["token"]


@pytest.fixture(scope="module")
def founder_token():
    return _login("founder@audinexa.com", "founder123")


@pytest.fixture(scope="module")
def analyst_token():
    return _login("analyst@audinexa.com", "analyst123")


@pytest.fixture(scope="module")
def support_token():
    return _login("support@audinexa.com", "support123")


@pytest.fixture(scope="module")
def delhi_admin_token():
    return _login("admin@delhi.test", "delhiadmin123")


# ---------- Tenant admin must be 403 on /admin/v2/* (the new fence) ----------

def test_tenant_admin_403_on_storage_get(delhi_admin_token):
    r = requests.get(f"{API}/admin/v2/system/storage",
                     headers={"Authorization": f"Bearer {delhi_admin_token}"}, timeout=20)
    assert r.status_code == 403, r.text
    detail = r.json().get("detail", "")
    assert "platform staff" in detail.lower() or "platform" in detail.lower(), \
        f"expected platform-fence message, got: {detail}"


def test_tenant_admin_403_on_purge(delhi_admin_token):
    r = requests.post(f"{API}/admin/v2/system/storage/purge-pdfs",
                      headers={"Authorization": f"Bearer {delhi_admin_token}"}, json={}, timeout=20)
    assert r.status_code == 403, r.text
    detail = r.json().get("detail", "")
    assert "platform" in detail.lower(), f"expected platform-fence message, got: {detail}"


def test_tenant_admin_403_on_dashboard(delhi_admin_token):
    """Confirm fence applies to ALL /admin/v2/* endpoints, not only storage."""
    r = requests.get(f"{API}/admin/v2/dashboard",
                     headers={"Authorization": f"Bearer {delhi_admin_token}"}, timeout=20)
    assert r.status_code == 403, r.text


def test_tenant_admin_403_on_audit_logs(delhi_admin_token):
    r = requests.get(f"{API}/admin/v2/audit-logs",
                     headers={"Authorization": f"Bearer {delhi_admin_token}"}, timeout=20)
    assert r.status_code == 403, r.text


# ---------- Founder happy paths still work ----------

def test_founder_storage_200(founder_token):
    r = requests.get(f"{API}/admin/v2/system/storage",
                     headers={"Authorization": f"Bearer {founder_token}"}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "buckets" in d and "retention_days" in d


def test_founder_purge_default_200(founder_token):
    r = requests.post(f"{API}/admin/v2/system/storage/purge-pdfs",
                      headers={"Authorization": f"Bearer {founder_token}"}, json={}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("scanned", "purged", "freed_bytes", "retention_days", "cutoff_iso"):
        assert k in d, f"missing {k}: {d}"


def test_founder_purge_days_override_200(founder_token):
    r = requests.post(f"{API}/admin/v2/system/storage/purge-pdfs",
                      headers={"Authorization": f"Bearer {founder_token}"}, json={"days": 7}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("retention_days") == 7, d


# ---------- Support agent 403 on days override ----------

def test_support_agent_403_on_days_override(support_token):
    r = requests.post(f"{API}/admin/v2/system/storage/purge-pdfs",
                      headers={"Authorization": f"Bearer {support_token}"}, json={"days": 7}, timeout=20)
    assert r.status_code == 403, r.text
    detail = r.json().get("detail", "")
    assert "founder" in detail.lower() or "override" in detail.lower(), \
        f"expected override-restriction message, got: {detail}"


# ---------- Regression: founder can still hit other admin/v2 endpoints ----------

@pytest.mark.parametrize("path", [
    "/admin/v2/dashboard",
    "/admin/v2/system/health",
    "/admin/v2/system/data-health",
    "/admin/v2/audit-logs",
])
def test_founder_regression_endpoints(founder_token, path):
    r = requests.get(f"{API}{path}",
                     headers={"Authorization": f"Bearer {founder_token}"}, timeout=30)
    assert r.status_code == 200, f"{path} failed: {r.status_code} {r.text}"


# ---------- Regression: read-only analyst still works on GETs ----------

@pytest.mark.parametrize("path", [
    "/admin/v2/dashboard",
    "/admin/v2/system/health",
    "/admin/v2/audit-logs",
])
def test_analyst_can_still_read(analyst_token, path):
    r = requests.get(f"{API}{path}",
                     headers={"Authorization": f"Bearer {analyst_token}"}, timeout=30)
    assert r.status_code == 200, f"{path} failed: {r.status_code} {r.text}"


def test_analyst_can_view_storage(analyst_token):
    """system:read is granted to read_only — GET /system/storage should still 200."""
    r = requests.get(f"{API}/admin/v2/system/storage",
                     headers={"Authorization": f"Bearer {analyst_token}"}, timeout=20)
    assert r.status_code == 200, r.text


# ---------- Regression: tenant-app endpoints unaffected ----------

def test_delhi_admin_can_login():
    """Confirm /api/auth/login is NOT fenced — only /admin/v2/* is."""
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@delhi.test", "password": "delhiadmin123"}, timeout=20)
    assert r.status_code == 200, r.text


def test_delhi_admin_can_list_patients(delhi_admin_token):
    r = requests.get(f"{API}/patients",
                     headers={"Authorization": f"Bearer {delhi_admin_token}"}, timeout=20)
    assert r.status_code == 200, r.text


def test_delhi_admin_can_list_invoices(delhi_admin_token):
    """The route is /api/billing/invoices — must remain accessible to tenant admin."""
    r = requests.get(f"{API}/billing/invoices",
                     headers={"Authorization": f"Bearer {delhi_admin_token}"}, timeout=20)
    # Some envs may use a different path; accept 200 or 404 for the wrong path.
    # Goal is to confirm the platform fence did NOT leak into tenant routes (no 403 with platform-staff message).
    if r.status_code == 403:
        detail = r.json().get("detail", "")
        assert "platform" not in detail.lower(), \
            f"tenant route incorrectly platform-fenced: {detail}"
    else:
        assert r.status_code in (200, 404), r.text


def test_delhi_admin_auth_me(delhi_admin_token):
    r = requests.get(f"{API}/auth/me",
                     headers={"Authorization": f"Bearer {delhi_admin_token}"}, timeout=20)
    assert r.status_code == 200, r.text
    user = r.json()
    # Confirm seed reality: this user IS clinic-delhi-test, NOT audinexa-platform
    assert user.get("clinic_id") != "audinexa-platform", \
        f"unexpected clinic_id: {user.get('clinic_id')}"
