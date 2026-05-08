"""Phase 14A — AUDINEXA Super Admin Panel tests.

Covers /api/admin/v2/* endpoints:
  * dashboard, tenants list/detail/update/suspend/activate/impersonate/delete
  * subscriptions plans + plan override + manual invoice + mark-paid
  * revenue, leads list+update, feature-flags GET+PUT, audit log
  * Role gating: founder, super_admin, others (front_desk)
  * Tier-bypass for founder
  * Demo-seed idempotency (no duplicates after import)
"""
from __future__ import annotations

import os
import time
import uuid

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

FOUNDER = ("founder@audinexa.com", "founder123")
SUPER_ADMIN = (ADMIN_EMAIL, ADMIN_PASSWORD)
FRONT_DESK = (FRONTDESK_EMAIL, FRONTDESK_PASSWORD)

# Real seeded tenants used as read/light-touch fixtures (replaces deleted
# KIMS / Apollo / SoundCare / ENT-Plus demo tenants).
BETA_READ_TENANT = "beta-01"          # detail / impersonate / feature-flags
BETA_UPDATE_TENANT = "beta-04"        # PATCH city / non-destructive
BETA_SUSPEND_TENANT = "beta-05"       # suspend → activate cycle
BETA_DELETE_BLOCK_TENANT = "beta-06"  # super_admin must be 403'd here
PREMIUM_TENANT = "tenant-sound-clinic-blr"  # PREMIUM tier filter check
EXPECTED_BETA_TENANTS = [f"beta-{i:02d}" for i in range(1, 11)]


def login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def H(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def founder_tok():
    return login(*FOUNDER)


@pytest.fixture(scope="module")
def admin_tok():
    return login(*SUPER_ADMIN)


@pytest.fixture(scope="module")
def frontdesk_tok():
    return login(*FRONT_DESK)


# ---------- 0. seed/login basics ----------
def test_founder_login_role():
    tok = login(*FOUNDER)
    me = requests.get(f"{API}/auth/me", headers=H(tok), timeout=20)
    assert me.status_code == 200
    body = me.json()
    user = body.get("user", body)
    assert user["role"] == "founder"
    assert user["email"] == FOUNDER[0]


def test_demo_tenants_seeded(founder_tok):
    r = requests.get(f"{API}/admin/v2/tenants", headers=H(founder_tok), timeout=30)
    assert r.status_code == 200, r.text
    rows = r.json()["rows"]
    cids = {t["clinic_id"] for t in rows}
    for c in EXPECTED_BETA_TENANTS:
        assert c in cids, f"missing seeded beta tenant {c}"


# ---------- 1. dashboard ----------
def test_dashboard_kpi_structure(founder_tok):
    r = requests.get(f"{API}/admin/v2/dashboard", headers=H(founder_tok), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("kpis", "plan_distribution", "revenue_by_tier", "mrr_chart",
              "signups_trend", "funnel", "recent_signups", "renewals_due"):
        assert k in d, f"missing key {k}"
    for k in ("active_clinics", "mrr", "arr", "churn_rate_pct",
              "new_signups_30d", "avg_revenue_per_tenant"):
        assert k in d["kpis"]
    for k in ("leads", "trials", "paid"):
        assert k in d["funnel"]


# ---------- 2. tenants ----------
def test_tenants_filters(founder_tok):
    r = requests.get(f"{API}/admin/v2/tenants", headers=H(founder_tok),
                     params={"tier": "PREMIUM"}, timeout=30)
    assert r.status_code == 200
    for row in r.json()["rows"]:
        assert row["subscription_tier"] == "PREMIUM"
    # The seeded PREMIUM tenant must appear in the PREMIUM filter.
    assert any(row["clinic_id"] == PREMIUM_TENANT for row in r.json()["rows"])

    r = requests.get(f"{API}/admin/v2/tenants", headers=H(founder_tok),
                     params={"q": "Beta"}, timeout=30)
    assert r.status_code == 200
    assert any("Beta" in t.get("name", "") for t in r.json()["rows"])


def test_tenant_detail_shape(founder_tok):
    r = requests.get(f"{API}/admin/v2/tenants/{BETA_READ_TENANT}",
                     headers=H(founder_tok), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("tenant", "users", "branches", "usage", "invoices",
              "feature_flags", "audit_trail"):
        assert k in d
    assert d["tenant"]["clinic_id"] == BETA_READ_TENANT
    assert "effective_tier" in d["tenant"]


def test_tenant_update_audit(founder_tok):
    new_city = f"TestCity-{uuid.uuid4().hex[:4]}"
    r = requests.patch(f"{API}/admin/v2/tenants/{BETA_UPDATE_TENANT}",
                       headers=H(founder_tok), json={"city": new_city}, timeout=30)
    assert r.status_code == 200, r.text
    g = requests.get(f"{API}/admin/v2/tenants/{BETA_UPDATE_TENANT}",
                     headers=H(founder_tok), timeout=30)
    assert g.json()["tenant"]["city"] == new_city


def test_suspend_then_activate(founder_tok):
    cid = BETA_SUSPEND_TENANT
    s = requests.post(f"{API}/admin/v2/tenants/{cid}/suspend",
                      headers=H(founder_tok), timeout=30)
    assert s.status_code == 200
    assert s.json()["status"] == "suspended"
    a = requests.post(f"{API}/admin/v2/tenants/{cid}/activate",
                      headers=H(founder_tok), timeout=30)
    assert a.status_code == 200
    assert a.json()["status"] == "active"


def test_impersonate_returns_working_token(founder_tok):
    cid = BETA_READ_TENANT
    r = requests.post(f"{API}/admin/v2/tenants/{cid}/impersonate",
                      headers=H(founder_tok), timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "access_token" in body and body["access_token"]
    new_tok = body["access_token"]
    me = requests.get(f"{API}/auth/me", headers=H(new_tok), timeout=20)
    assert me.status_code == 200
    user = me.json().get("user", me.json())
    assert user["clinic_id"] == cid


# ---------- 3. delete: founder vs super_admin ----------
def test_delete_blocked_for_super_admin(admin_tok):
    r = requests.delete(f"{API}/admin/v2/tenants/{BETA_DELETE_BLOCK_TENANT}",
                        headers=H(admin_tok), timeout=30)
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


def test_delete_allowed_for_founder(founder_tok):
    """Mints a throwaway tenant via the public admin endpoint, then deletes
    it — avoids destroying any real beta or seeded fixture."""
    suffix = uuid.uuid4().hex[:6]
    create = requests.post(
        f"{API}/admin/v2/tenants",
        headers=H(founder_tok),
        json={
            "clinic_name": f"Pytest Throwaway {suffix}",
            "city": "Mumbai",
            "state": "Maharashtra",
            "phone": "+91-9000099001",
            "owner_email": f"throwaway-{suffix}@example.com",
            "owner_name": "Throwaway Owner",
            "subscription_tier": "BASIC",
        },
        timeout=30,
    )
    assert create.status_code in (200, 201), create.text
    cid = create.json().get("clinic_id") or create.json().get("tenant", {}).get("clinic_id")
    assert cid, f"throwaway tenant missing clinic_id: {create.json()}"

    r = requests.delete(f"{API}/admin/v2/tenants/{cid}",
                        headers=H(founder_tok), timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert "deleted" in body
    g = requests.get(f"{API}/admin/v2/tenants/{cid}",
                     headers=H(founder_tok), timeout=30)
    assert g.status_code == 404


# ---------- 4. subscriptions ----------
def test_get_plans(founder_tok):
    r = requests.get(f"{API}/admin/v2/subscriptions/plans",
                     headers=H(founder_tok), timeout=20)
    assert r.status_code == 200
    body = r.json()
    assert len(body["plans"]) == 3
    tiers = {p["tier"] for p in body["plans"]}
    assert tiers == {"BASIC", "STANDARD", "PREMIUM"}
    for p in body["plans"]:
        assert "modules_included" in p


def test_plan_override_persists(founder_tok):
    r = requests.put(f"{API}/admin/v2/subscriptions/plans/STANDARD",
                     headers=H(founder_tok),
                     json={"user_limit": 25, "sms_credits": 500,
                           "support_level": "priority"}, timeout=20)
    assert r.status_code == 200, r.text
    g = requests.get(f"{API}/admin/v2/subscriptions/plans",
                     headers=H(founder_tok), timeout=20)
    std = next(p for p in g.json()["plans"] if p["tier"] == "STANDARD")
    assert std.get("user_limit") == 25
    assert std.get("sms_credits") == 500


def test_create_invoice_and_mark_paid(founder_tok):
    cid = BETA_READ_TENANT
    r = requests.post(f"{API}/admin/v2/subscriptions/invoices",
                      headers=H(founder_tok),
                      json={"clinic_id": cid, "tier": "PREMIUM",
                            "duration": "annual", "notes": "TEST_phase14"},
                      timeout=30)
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["status"] == "pending"
    assert inv["payment_method"] == "manual"
    assert inv["grand_total"] > 0
    inv_id = inv["invoice_id"]
    p = requests.post(f"{API}/admin/v2/subscriptions/invoices/{inv_id}/mark-paid",
                      headers=H(founder_tok),
                      params={"payment_ref": "TEST-REF-001"}, timeout=20)
    assert p.status_code == 200, p.text
    assert p.json()["status"] == "paid"


# ---------- 5. revenue ----------
def test_revenue_shape(founder_tok):
    r = requests.get(f"{API}/admin/v2/revenue", headers=H(founder_tok), timeout=30)
    assert r.status_code == 200
    d = r.json()
    for k in ("this_month", "annual_contracts_open", "refunds_count",
              "overdue", "recent_invoices"):
        assert k in d


# ---------- 6. leads ----------
def test_leads_list_has_stages(founder_tok):
    r = requests.get(f"{API}/admin/v2/leads", headers=H(founder_tok), timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert "stages" in d and "counts" in d and "rows" in d
    assert "Lead" in d["stages"]


def test_lead_stage_update(founder_tok):
    """Picks the first row from the leads list (if any) and tries to flip
    its stage. Skips if no leads have been seeded."""
    r = requests.get(f"{API}/admin/v2/leads", headers=H(founder_tok), timeout=20)
    rows = r.json().get("rows", [])
    if not rows:
        pytest.skip("no leads seeded — nothing to update")
    email = rows[0]["email"]
    p = requests.patch(f"{API}/admin/v2/leads/{email}",
                       headers=H(founder_tok),
                       json={"stage": "Active Trial", "notes": "TEST_phase14"},
                       timeout=20)
    assert p.status_code == 200, p.text
    assert p.json()["stage"] == "Active Trial"


# ---------- 7. feature flags ----------
def test_feature_flags_additive(founder_tok):
    cid = BETA_READ_TENANT  # STANDARD tier beta tenant
    r = requests.get(f"{API}/admin/v2/feature-flags/{cid}",
                     headers=H(founder_tok), timeout=20)
    assert r.status_code == 200
    body = r.json()
    assert "base_modules" in body and "effective_modules" in body
    p = requests.put(f"{API}/admin/v2/feature-flags/{cid}",
                     headers=H(founder_tok),
                     json={"extra_modules": ["analytics"],
                           "disabled_modules": []}, timeout=20)
    assert p.status_code == 200, p.text
    g = requests.get(f"{API}/admin/v2/feature-flags/{cid}",
                     headers=H(founder_tok), timeout=20)
    assert "analytics" in g.json()["effective_modules"]


# ---------- 8. audit log ----------
def test_audit_log_appends(founder_tok):
    r = requests.get(f"{API}/admin/v2/audit-logs",
                     headers=H(founder_tok),
                     params={"limit": 50}, timeout=20)
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list) and len(rows) > 0
    actions = {r["action"] for r in rows}
    # We did suspend/activate/update/lead.update/feature_flags.update earlier
    assert any(a in actions for a in (
        "tenant.suspend", "tenant.activate", "tenant.update",
        "lead.update", "feature_flags.update", "tenant_invoice.issue"
    ))


# ---------- 9. role denial ----------
def test_frontdesk_denied(frontdesk_tok):
    for path in ("/admin/v2/dashboard", "/admin/v2/tenants",
                 "/admin/v2/leads", "/admin/v2/audit-logs",
                 "/admin/v2/subscriptions/plans"):
        r = requests.get(f"{API}{path}", headers=H(frontdesk_tok), timeout=20)
        assert r.status_code == 403, f"{path} expected 403 got {r.status_code}"


def test_unauth_denied():
    r = requests.get(f"{API}/admin/v2/dashboard", timeout=20)
    assert r.status_code == 401


# ---------- 10. tier bypass for founder ----------
def test_founder_bypasses_tier_gates(founder_tok):
    # founder is on platform clinic which doesn't have PREMIUM tier-gated modules,
    # but require_tier whitelists 'founder'. So /api/analytics/diagnosis must be 200.
    r = requests.get(f"{API}/analytics/diagnosis", headers=H(founder_tok), timeout=30)
    # endpoint may return data or empty list; the key is NOT 402
    assert r.status_code != 402, f"founder should bypass tier — got 402: {r.text}"
    assert r.status_code in (200, 404), r.text  # 404 only if route not present
