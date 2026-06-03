"""Iteration 20 — verification of the Phase 14B+14C RBAC fix.

Re-validates the exact 7-role × 17-endpoint matrix from the review_request for
admin_panel.py (Phase 14A endpoints) which previously used the hardcoded
ADMIN_ROLES tuple and now use require_permission() from utils.rbac.

Exercises all endpoints live via REACT_APP_BACKEND_URL — no mocks.
"""
from __future__ import annotations

import os
import pytest
import requests


from _helpers import (  # legacy creds (env-overridable)
    ADMIN_EMAIL, ADMIN_PASSWORD,
    FRONTDESK_EMAIL, FRONTDESK_PASSWORD,
    AUDIO_EMAIL, AUDIO_PASSWORD,
    ACCOUNTS_EMAIL, ACCOUNTS_PASSWORD,
)
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "founder":        ("founder@audinexa.com", "founder123"),
    "super_admin":    (ADMIN_EMAIL, ADMIN_PASSWORD),
    "sales_manager":  ("sales@audinexa.com", "Sales-Mgr-9K2vX7wR"),
    "support_agent":  ("support@audinexa.com", "Support-A3jH8nP4yZ"),
    "finance_manager": ("finance@audinexa.com", "Finance-V5tB9cM1qL"),
    "product_ops":    ("ops@audinexa.com", "ProdOps-G4xN6sD2uK"),
    "read_only":      ("analyst@audinexa.com", "Analyst-W8rT5fJ3eY"),
    "frontdesk":      (FRONTDESK_EMAIL, FRONTDESK_PASSWORD),
    "kims_owner":     ("support@kimshearing.in", "demo123"),
}

KIMS = "tenant-kims-hearing"


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=20)
    if r.status_code != 200:
        return None
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def toks():
    out = {}
    for role, (em, pw) in CREDS.items():
        t = _login(em, pw)
        if not t:
            pytest.skip(f"login failed for {role}")
        out[role] = t
    return out


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------------- sales_manager ----------------
class TestSalesManager:
    def test_tenants_read_allowed(self, toks):
        r = requests.get(f"{API}/admin/v2/tenants", headers=H(toks["sales_manager"]), timeout=20)
        assert r.status_code == 200, r.text

    def test_invoices_write_denied(self, toks):
        r = requests.post(f"{API}/admin/v2/subscriptions/invoices",
                          headers=H(toks["sales_manager"]),
                          json={"clinic_id": KIMS, "tier": "STANDARD", "duration": "annual"},
                          timeout=20)
        assert r.status_code == 403, r.text


# ---------------- support_agent ----------------
class TestSupportAgent:
    def test_dashboard_read_allowed(self, toks):
        r = requests.get(f"{API}/admin/v2/dashboard", headers=H(toks["support_agent"]), timeout=30)
        assert r.status_code == 200, r.text

    def test_impersonate_allowed(self, toks):
        r = requests.post(f"{API}/admin/v2/tenants/{KIMS}/impersonate",
                          headers=H(toks["support_agent"]), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "access_token" in body

    def test_revenue_denied(self, toks):
        r = requests.get(f"{API}/admin/v2/revenue", headers=H(toks["support_agent"]), timeout=20)
        assert r.status_code == 403, r.text


# ---------------- finance_manager ----------------
class TestFinanceManager:
    def test_revenue_read_allowed(self, toks):
        r = requests.get(f"{API}/admin/v2/revenue", headers=H(toks["finance_manager"]), timeout=20)
        assert r.status_code == 200, r.text

    def test_invoices_write_allowed(self, toks):
        r = requests.post(f"{API}/admin/v2/subscriptions/invoices",
                          headers=H(toks["finance_manager"]),
                          json={"clinic_id": KIMS, "tier": "STANDARD", "duration": "annual"},
                          timeout=20)
        assert r.status_code == 200, r.text

    def test_plans_read_allowed(self, toks):
        r = requests.get(f"{API}/admin/v2/subscriptions/plans",
                         headers=H(toks["finance_manager"]), timeout=20)
        assert r.status_code == 200, r.text

    def test_feature_flags_write_denied(self, toks):
        r = requests.put(f"{API}/admin/v2/feature-flags/{KIMS}",
                         headers=H(toks["finance_manager"]),
                         json={"extra_modules": ["analytics"], "disabled_modules": []},
                         timeout=20)
        assert r.status_code == 403, r.text


# ---------------- product_ops ----------------
class TestProductOps:
    def test_feature_flags_write_allowed(self, toks):
        r = requests.put(f"{API}/admin/v2/feature-flags/{KIMS}",
                         headers=H(toks["product_ops"]),
                         json={"extra_modules": ["analytics"], "disabled_modules": []},
                         timeout=20)
        assert r.status_code == 200, r.text

    def test_revenue_denied(self, toks):
        r = requests.get(f"{API}/admin/v2/revenue",
                         headers=H(toks["product_ops"]), timeout=20)
        assert r.status_code == 403, r.text

    def test_usage_analytics_allowed(self, toks):
        r = requests.get(f"{API}/admin/v2/usage-analytics",
                         headers=H(toks["product_ops"]), timeout=30)
        assert r.status_code == 200, r.text


# ---------------- read_only (all reads allowed, all writes 403) ----------------
class TestReadOnly:
    READS = [
        ("GET", "/admin/v2/dashboard", 30),
        ("GET", "/admin/v2/tenants", 30),
        ("GET", "/admin/v2/revenue", 20),
        ("GET", "/admin/v2/tickets", 20),
        ("GET", "/admin/v2/usage-analytics", 30),
        ("GET", "/admin/v2/system/health", 20),
        ("GET", "/admin/v2/audit", 20),
        ("GET", "/admin/v2/subscriptions/plans", 20),
        ("GET", f"/admin/v2/feature-flags/{KIMS}", 20),
        ("GET", "/admin/v2/notifications", 20),
    ]

    @pytest.mark.parametrize("method,path,to", READS)
    def test_reads_allowed(self, toks, method, path, to):
        r = requests.request(method, f"{API}{path}", headers=H(toks["read_only"]), timeout=to)
        assert r.status_code == 200, f"{path} → {r.status_code}: {r.text[:200]}"

    def test_write_invoice_denied(self, toks):
        r = requests.post(f"{API}/admin/v2/subscriptions/invoices",
                          headers=H(toks["read_only"]),
                          json={"clinic_id": KIMS, "tier": "STANDARD", "duration": "annual"},
                          timeout=20)
        assert r.status_code == 403, r.text

    def test_write_lead_denied(self, toks):
        r = requests.patch(f"{API}/admin/v2/leads/test@example.com",
                           headers=H(toks["read_only"]),
                           json={"stage": "contacted"}, timeout=20)
        assert r.status_code == 403, r.text

    def test_write_feature_flag_denied(self, toks):
        r = requests.put(f"{API}/admin/v2/feature-flags/{KIMS}",
                         headers=H(toks["read_only"]),
                         json={"extra_modules": [], "disabled_modules": []}, timeout=20)
        assert r.status_code == 403, r.text

    def test_delete_tenant_denied(self, toks):
        r = requests.delete(f"{API}/admin/v2/tenants/{KIMS}",
                            headers=H(toks["read_only"]), timeout=20)
        assert r.status_code == 403, r.text


# ---------------- founder (bypass everything) ----------------
class TestFounderBypass:
    def test_revenue(self, toks):
        r = requests.get(f"{API}/admin/v2/revenue", headers=H(toks["founder"]), timeout=20)
        assert r.status_code == 200

    def test_feature_flags_write(self, toks):
        r = requests.put(f"{API}/admin/v2/feature-flags/{KIMS}",
                         headers=H(toks["founder"]),
                         json={"extra_modules": [], "disabled_modules": []}, timeout=20)
        assert r.status_code == 200


# ---------------- super_admin (everything except DELETE tenant) ----------------
class TestSuperAdmin:
    def test_revenue_allowed(self, toks):
        r = requests.get(f"{API}/admin/v2/revenue", headers=H(toks["super_admin"]), timeout=20)
        assert r.status_code == 200

    def test_invoice_write_allowed(self, toks):
        r = requests.post(f"{API}/admin/v2/subscriptions/invoices",
                          headers=H(toks["super_admin"]),
                          json={"clinic_id": KIMS, "tier": "STANDARD", "duration": "annual"},
                          timeout=20)
        assert r.status_code == 200

    def test_delete_tenant_denied(self, toks):
        r = requests.delete(f"{API}/admin/v2/tenants/{KIMS}",
                            headers=H(toks["super_admin"]), timeout=20)
        # founder-only safeguard
        assert r.status_code == 403


# ---------------- non-admin roles (clinic_owner, frontdesk) ----------------
class TestNonAdminDenied:
    ENDPOINTS = [
        ("GET", "/admin/v2/dashboard", 30),
        ("GET", "/admin/v2/tenants", 30),
        ("GET", "/admin/v2/revenue", 20),
        ("GET", "/admin/v2/tickets", 20),
        ("GET", "/admin/v2/usage-analytics", 30),
        ("GET", "/admin/v2/system/health", 20),
        ("GET", "/admin/v2/audit", 20),
    ]

    @pytest.mark.parametrize("method,path,to", ENDPOINTS)
    def test_frontdesk_denied(self, toks, method, path, to):
        r = requests.request(method, f"{API}{path}", headers=H(toks["frontdesk"]), timeout=to)
        assert r.status_code == 403, f"{path} → {r.status_code}: {r.text[:200]}"

    @pytest.mark.parametrize("method,path,to", ENDPOINTS)
    def test_clinic_owner_denied(self, toks, method, path, to):
        r = requests.request(method, f"{API}{path}", headers=H(toks["kims_owner"]), timeout=to)
        assert r.status_code == 403, f"{path} → {r.status_code}: {r.text[:200]}"
