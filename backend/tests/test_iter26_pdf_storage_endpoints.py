"""Iter26 — Hybrid PDF Storage endpoint behaviour & RBAC.

Covers all scenarios from the review request that the existing
test_pdf_retention.py does not assert directly:
  * GET /admin/v2/system/storage as founder — bucket schema & retention_days
  * POST /admin/v2/system/storage/purge-pdfs body {} — schema returned
  * POST /admin/v2/system/storage/purge-pdfs body {"days":0} — skip path
  * POST .../purge-pdfs with {"days":7} as support agent — must 403
  * GET .../system/storage as Delhi tenant admin — must 403
  * Regression: GET /admin/v2/system/data-health still works for founder
"""
import os
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j["token"]


# ---------- Founder happy-path ----------

def test_storage_stats_as_founder_schema():
    tok = _login("founder@audinexa.com", "founder123")
    r = requests.get(f"{API}/admin/v2/system/storage", headers={"Authorization": f"Bearer {tok}"}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "buckets" in d
    assert "retention_days" in d
    assert d["retention_days"] == 30, d
    bs = d["buckets"]
    assert "session_reports" in bs and bs["session_reports"]["swept"] is True
    # Image buckets are listed but NOT swept
    for bn in ("clinic_logos", "user_signatures", "user_avatars", "transfer_signatures"):
        assert bn in bs, f"missing bucket {bn}"
        assert bs[bn]["swept"] is False, f"{bn} should not be swept"
        assert isinstance(bs[bn]["count"], int)
        assert isinstance(bs[bn]["total_bytes"], int)


def test_purge_default_body_returns_schema():
    tok = _login("founder@audinexa.com", "founder123")
    r = requests.post(f"{API}/admin/v2/system/storage/purge-pdfs",
                      headers={"Authorization": f"Bearer {tok}"}, json={}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("retention_days") == 30, d
    # Default sweep returns scanned/purged/freed/cutoff_iso
    for key in ("scanned", "purged", "freed_bytes", "cutoff_iso"):
        assert key in d, f"missing {key} in response: {d}"


def test_purge_days_zero_skips():
    tok = _login("founder@audinexa.com", "founder123")
    r = requests.post(f"{API}/admin/v2/system/storage/purge-pdfs",
                      headers={"Authorization": f"Bearer {tok}"}, json={"days": 0}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("retention_days") == 0, d
    assert "skipped" in d, d
    assert d.get("purged", 0) == 0


def test_purge_days_invalid_returns_400():
    tok = _login("founder@audinexa.com", "founder123")
    r = requests.post(f"{API}/admin/v2/system/storage/purge-pdfs",
                      headers={"Authorization": f"Bearer {tok}"}, json={"days": "abc"}, timeout=20)
    assert r.status_code == 400, r.text


# ---------- RBAC negatives ----------

def test_support_agent_cannot_override_days():
    tok = _login("support@audinexa.com", "Support-A3jH8nP4yZ")
    r = requests.post(f"{API}/admin/v2/system/storage/purge-pdfs",
                      headers={"Authorization": f"Bearer {tok}"}, json={"days": 7}, timeout=20)
    assert r.status_code == 403, f"support should not override days, got {r.status_code} {r.text}"


def test_support_agent_can_view_storage_stats():
    """system:read permission should allow GET /system/storage."""
    tok = _login("support@audinexa.com", "Support-A3jH8nP4yZ")
    r = requests.get(f"{API}/admin/v2/system/storage",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=20)
    assert r.status_code == 200, r.text
    assert "buckets" in r.json()


def test_support_agent_default_purge_allowed():
    """Body {} (no days override) should NOT 403 — only override needs founder."""
    tok = _login("support@audinexa.com", "Support-A3jH8nP4yZ")
    r = requests.post(f"{API}/admin/v2/system/storage/purge-pdfs",
                      headers={"Authorization": f"Bearer {tok}"}, json={}, timeout=20)
    assert r.status_code == 200, r.text


def test_tenant_admin_cannot_view_storage():
    tok = _login("admin@delhi.test", "delhiadmin123")
    r = requests.get(f"{API}/admin/v2/system/storage",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=20)
    assert r.status_code == 403, f"tenant admin should be forbidden, got {r.status_code} {r.text}"


def test_tenant_admin_cannot_purge():
    tok = _login("admin@delhi.test", "delhiadmin123")
    r = requests.post(f"{API}/admin/v2/system/storage/purge-pdfs",
                      headers={"Authorization": f"Bearer {tok}"}, json={}, timeout=20)
    assert r.status_code == 403


def test_unauthenticated_blocked():
    r = requests.get(f"{API}/admin/v2/system/storage", timeout=20)
    assert r.status_code in (401, 403)


# ---------- Regression: data-health still works ----------

def test_data_health_regression():
    tok = _login("founder@audinexa.com", "founder123")
    r = requests.get(f"{API}/admin/v2/system/data-health",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "overall" in d, d
    assert "auto_incidents_opened" in d, d
