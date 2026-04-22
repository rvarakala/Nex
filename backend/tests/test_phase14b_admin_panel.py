"""Phase 14B + 14C — AUDINEXA Super Admin Panel extended tests.

Covers /api/admin/v2/* new endpoints:
  * Support Desk (tickets list/create/update + SLA + stats)
  * Usage Analytics (per-tenant + churn-risk)
  * System Health (api/db/gateways + incidents create/resolve)
  * Marketing CRM (campaigns list/create + CAC + totals)
  * Notifications Center (send + list + feed for clinic_owner)
  * Audit Log filtered viewer (actor/action/target/since)
  * Settings GET/PUT (founder+super_admin only)
  * Internal Users CRUD + RBAC matrix
  * Granular RBAC enforcement across 5 internal roles
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

FOUNDER = ("founder@audinexa.com", "founder123")
SUPER_ADMIN = ("admin@acs.in", "admin123")
SALES_MGR = ("sales@audinexa.com", "sales123")
SUPPORT_AGT = ("support@audinexa.com", "support123")
FINANCE_MGR = ("finance@audinexa.com", "finance123")
PRODUCT_OPS = ("ops@audinexa.com", "ops123")
READ_ONLY = ("analyst@audinexa.com", "analyst123")
FRONT_DESK = ("frontdesk@acs.in", "frontdesk123")
KIMS_OWNER = ("support@kimshearing.in", "demo123")


def login(email: str, password: str) -> str | None:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    if r.status_code != 200:
        return None
    return r.json()["access_token"]


def H(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def founder_tok():
    t = login(*FOUNDER)
    if not t:
        pytest.skip("founder login failed")
    return t


@pytest.fixture(scope="module")
def admin_tok():
    t = login(*SUPER_ADMIN)
    if not t:
        pytest.skip("super_admin login failed")
    return t


@pytest.fixture(scope="module")
def sales_tok():
    t = login(*SALES_MGR)
    if not t:
        pytest.skip("sales_manager seed missing")
    return t


@pytest.fixture(scope="module")
def support_tok():
    t = login(*SUPPORT_AGT)
    if not t:
        pytest.skip("support_agent seed missing")
    return t


@pytest.fixture(scope="module")
def finance_tok():
    t = login(*FINANCE_MGR)
    if not t:
        pytest.skip("finance_manager seed missing")
    return t


@pytest.fixture(scope="module")
def ops_tok():
    t = login(*PRODUCT_OPS)
    if not t:
        pytest.skip("product_ops seed missing")
    return t


@pytest.fixture(scope="module")
def readonly_tok():
    t = login(*READ_ONLY)
    if not t:
        pytest.skip("read_only seed missing")
    return t


@pytest.fixture(scope="module")
def kims_tok():
    t = login(*KIMS_OWNER)
    if not t:
        pytest.skip("kims_owner missing")
    return t


# ============= 0. SEED =============
def test_internal_users_seeded(founder_tok):
    r = requests.get(f"{API}/admin/v2/internal-users", headers=H(founder_tok), timeout=20)
    assert r.status_code == 200, r.text
    rows = r.json()
    emails = {u["email"] for u in rows}
    expected = {"founder@audinexa.com", "sales@audinexa.com", "support@audinexa.com",
                "finance@audinexa.com", "ops@audinexa.com", "analyst@audinexa.com"}
    missing = expected - emails
    assert not missing, f"missing seeded internal users: {missing}"


# ============= 1. SUPPORT DESK =============
def test_tickets_list_with_stats(founder_tok):
    r = requests.get(f"{API}/admin/v2/tickets", headers=H(founder_tok), timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "rows" in body and "stats" in body and "count" in body
    s = body["stats"]
    for k in ("avg_response_hrs", "avg_resolution_hrs", "sla_breaches",
              "open_by_priority", "categories", "statuses", "priorities"):
        assert k in s, f"missing stats.{k}"
    assert "Open" in s["statuses"]
    assert "urgent" in s["priorities"]


def test_tickets_create_with_sla(founder_tok):
    payload = {
        "clinic_id": "tenant-kims-hearing",
        "category": "Bug",
        "priority": "urgent",
        "subject": f"TEST_phase14b ticket {uuid.uuid4().hex[:6]}",
        "body": "Reproducer: …",
    }
    r = requests.post(f"{API}/admin/v2/tickets", headers=H(founder_tok), json=payload, timeout=20)
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["status"] == "Open"
    assert t["priority"] == "urgent"
    assert t["sla_due_at"] is not None
    assert t["ticket_id"].startswith("TKT-")
    # SLA gap should be ~2h for urgent
    from datetime import datetime
    created = datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
    sla = datetime.fromisoformat(t["sla_due_at"].replace("Z", "+00:00"))
    delta_h = (sla - created).total_seconds() / 3600.0
    assert 1.9 <= delta_h <= 2.1, f"urgent SLA should be 2h, got {delta_h}"
    pytest.tkt_id = t["ticket_id"]


def test_tickets_filter_by_status(founder_tok):
    r = requests.get(f"{API}/admin/v2/tickets", headers=H(founder_tok), params={"status": "Open"}, timeout=20)
    assert r.status_code == 200
    for row in r.json()["rows"]:
        assert row["status"] == "Open"


def test_ticket_reply_then_resolve(founder_tok):
    tid = getattr(pytest, "tkt_id", None)
    if not tid:
        pytest.skip("no created ticket")
    # reply
    r = requests.patch(f"{API}/admin/v2/tickets/{tid}", headers=H(founder_tok),
                       json={"reply": "Working on it"}, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["first_response_at"] is not None
    assert any(m.get("kind") == "reply" for m in body["thread"])
    # resolve
    r2 = requests.patch(f"{API}/admin/v2/tickets/{tid}", headers=H(founder_tok),
                        json={"status": "Resolved"}, timeout=20)
    assert r2.status_code == 200
    assert r2.json()["status"] == "Resolved"
    assert r2.json()["resolved_at"] is not None


def test_ticket_invalid_category(founder_tok):
    r = requests.post(f"{API}/admin/v2/tickets", headers=H(founder_tok),
                      json={"category": "NotARealCat", "subject": "valid subj", "body": "y"}, timeout=20)
    assert r.status_code == 400


# ============= 2. USAGE ANALYTICS =============
def test_usage_analytics_shape(founder_tok):
    r = requests.get(f"{API}/admin/v2/usage-analytics", headers=H(founder_tok),
                     params={"days": 30}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["window_days"] == 30
    for k in ("total_tenants", "high_risk", "medium_risk", "low_risk",
              "platform_dau", "platform_mau"):
        assert k in d["totals"]
    if d["rows"]:
        row = d["rows"][0]
        for k in ("clinic_id", "name", "tier", "dau", "mau", "feature_adoption",
                  "inactive_days", "churn_risk"):
            assert k in row
        assert row["churn_risk"] in ("low", "medium", "high")


# ============= 3. SYSTEM HEALTH =============
def test_system_health_subsystems(founder_tok):
    r = requests.get(f"{API}/admin/v2/system/health", headers=H(founder_tok), timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("api", "database", "email_gateway", "sms_gateway",
              "whatsapp_gateway", "queue_backlog", "last_backup", "incidents"):
        assert k in d
    assert d["api"]["status"] == "healthy"
    assert d["database"]["status"] in ("healthy", "down")
    assert d["email_gateway"]["status"] in ("mocked", "healthy", "degraded", "down")


def test_incident_create_and_resolve(founder_tok):
    r = requests.post(f"{API}/admin/v2/system/incidents", headers=H(founder_tok),
                      json={"title": "TEST_phase14b incident", "severity": "minor",
                            "summary": "synthetic"}, timeout=20)
    assert r.status_code == 200, r.text
    inc = r.json()
    assert inc["incident_id"].startswith("INC-")
    assert inc["resolved_at"] is None
    iid = inc["incident_id"]
    r2 = requests.post(f"{API}/admin/v2/system/incidents/{iid}/resolve",
                       headers=H(founder_tok), timeout=20)
    assert r2.status_code == 200, r2.text
    assert r2.json()["resolved_at"] is not None
    # resolving again should 404
    r3 = requests.post(f"{API}/admin/v2/system/incidents/{iid}/resolve",
                       headers=H(founder_tok), timeout=20)
    assert r3.status_code == 404


# ============= 4. MARKETING CRM =============
def test_marketing_campaigns_enriched(founder_tok):
    r = requests.get(f"{API}/admin/v2/marketing/campaigns", headers=H(founder_tok), timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "campaigns" in d and "totals" in d
    for k in ("total_budget", "total_leads", "total_converted",
              "overall_conversion_pct", "blended_cac", "partner_referrals_converted"):
        assert k in d["totals"]
    if d["campaigns"]:
        c = d["campaigns"][0]
        for k in ("campaign_id", "name", "source", "leads_generated",
                  "converted", "conversion_pct", "cac"):
            assert k in c


def test_create_campaign(founder_tok):
    r = requests.post(f"{API}/admin/v2/marketing/campaigns", headers=H(founder_tok),
                      json={"name": f"TEST_phase14b camp {uuid.uuid4().hex[:5]}",
                            "source": "google-ads", "channel": "paid",
                            "budget": 50000.0}, timeout=20)
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["campaign_id"].startswith("CAM-")
    assert c["budget"] == 50000.0


# ============= 5. NOTIFICATIONS =============
def test_send_broadcast_and_list(founder_tok):
    r = requests.post(f"{API}/admin/v2/notifications/send", headers=H(founder_tok),
                      json={"title": "TEST_phase14b broadcast",
                            "body": "Hello tenants",
                            "audience": "all",
                            "channels": ["in-app", "email"]}, timeout=20)
    assert r.status_code == 200, r.text
    n = r.json()
    assert n["notification_id"].startswith("NOT-")
    assert n["delivered_in_app"] is True
    assert n["target_count"] >= 1
    # list
    g = requests.get(f"{API}/admin/v2/notifications", headers=H(founder_tok), timeout=20)
    assert g.status_code == 200
    assert any(x["notification_id"] == n["notification_id"] for x in g.json())


def test_feed_visible_to_clinic_owner(founder_tok, kims_tok):
    # broadcast to all
    requests.post(f"{API}/admin/v2/notifications/send", headers=H(founder_tok),
                  json={"title": "TEST_feed all", "body": "ping", "audience": "all",
                        "channels": ["in-app"]}, timeout=20)
    feed = requests.get(f"{API}/admin/v2/notifications/feed", headers=H(kims_tok), timeout=20)
    assert feed.status_code == 200, feed.text
    titles = [n["title"] for n in feed.json()]
    assert any("TEST_feed all" in t for t in titles)


def test_send_to_specific_tenant(founder_tok):
    r = requests.post(f"{API}/admin/v2/notifications/send", headers=H(founder_tok),
                      json={"title": "TEST_targeted", "body": "x",
                            "audience": "tenant",
                            "audience_filter": "tenant-kims-hearing",
                            "channels": ["in-app"]}, timeout=20)
    assert r.status_code == 200
    n = r.json()
    assert n["target_count"] == 1
    assert "tenant-kims-hearing" in n["target_clinic_ids"]


# ============= 6. AUDIT LOG VIEWER =============
def test_audit_filtered(founder_tok):
    r = requests.get(f"{API}/admin/v2/audit", headers=H(founder_tok),
                     params={"action": "ticket"}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("count", "rows", "by_action", "by_actor"):
        assert k in d
    if d["rows"]:
        for row in d["rows"]:
            assert "ticket" in row["action"].lower()


# ============= 7. SETTINGS =============
def test_get_settings_defaults(founder_tok):
    r = requests.get(f"{API}/admin/v2/settings", headers=H(founder_tok), timeout=20)
    assert r.status_code == 200, r.text
    s = r.json()
    for k in ("brand_name", "currency", "timezone", "trial_duration_days",
              "tax_rate_pct", "email_templates", "default_onboarding_checklist"):
        assert k in s


def test_settings_update_founder(founder_tok):
    new_brand = f"TEST_BRAND_{uuid.uuid4().hex[:4]}"
    r = requests.put(f"{API}/admin/v2/settings", headers=H(founder_tok),
                     json={"brand_name": new_brand, "trial_duration_days": 21}, timeout=20)
    assert r.status_code == 200, r.text
    g = requests.get(f"{API}/admin/v2/settings", headers=H(founder_tok), timeout=20)
    assert g.json()["brand_name"] == new_brand
    assert g.json()["trial_duration_days"] == 21


def test_settings_update_denied_for_sales(sales_tok):
    r = requests.put(f"{API}/admin/v2/settings", headers=H(sales_tok),
                     json={"brand_name": "HACK"}, timeout=20)
    assert r.status_code == 403


# ============= 8. INTERNAL USERS =============
def test_invite_internal_user(founder_tok):
    email = f"test_phase14b_{uuid.uuid4().hex[:6]}@audinexa.com"
    r = requests.post(f"{API}/admin/v2/internal-users", headers=H(founder_tok),
                      json={"email": email, "name": "Test User",
                            "password": "Testpass123!", "role": "read_only"}, timeout=20)
    assert r.status_code == 200, r.text
    u = r.json()
    assert u["email"] == email
    assert u["role"] == "read_only"
    pytest.invited_user_id = u["user_id"]


def test_invite_internal_user_invalid_role(founder_tok):
    r = requests.post(f"{API}/admin/v2/internal-users", headers=H(founder_tok),
                      json={"email": f"x_{uuid.uuid4().hex[:5]}@audinexa.com",
                            "name": "X", "password": "Pass1234!",
                            "role": "no_such_role"}, timeout=20)
    assert r.status_code == 400


def test_disable_internal_user(founder_tok):
    uid = getattr(pytest, "invited_user_id", None)
    if not uid:
        pytest.skip("no user invited")
    r = requests.patch(f"{API}/admin/v2/internal-users/{uid}",
                       headers=H(founder_tok),
                       params={"active": False}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["active"] is False


def test_internal_users_denied_for_sales(sales_tok):
    r = requests.get(f"{API}/admin/v2/internal-users", headers=H(sales_tok), timeout=20)
    assert r.status_code == 403


# ============= 9. RBAC MATRIX =============
def test_rbac_matrix_visible_to_founder(founder_tok):
    r = requests.get(f"{API}/admin/v2/rbac/matrix", headers=H(founder_tok), timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert "roles" in d and "matrix" in d
    for role in ("founder", "super_admin", "sales_manager", "support_agent",
                 "finance_manager", "product_ops", "read_only"):
        assert role in d["matrix"]


def test_rbac_matrix_denied_for_sales(sales_tok):
    r = requests.get(f"{API}/admin/v2/rbac/matrix", headers=H(sales_tok), timeout=20)
    assert r.status_code == 403


def test_rbac_matrix_visible_to_product_ops(ops_tok):
    r = requests.get(f"{API}/admin/v2/rbac/matrix", headers=H(ops_tok), timeout=20)
    assert r.status_code == 200


# ============= 10. RBAC ENFORCEMENT (5 internal roles) =============
class TestRbacSalesManager:
    def test_can_read_leads(self, sales_tok):
        r = requests.get(f"{API}/admin/v2/leads", headers=H(sales_tok), timeout=20)
        assert r.status_code == 200

    def test_can_read_marketing(self, sales_tok):
        r = requests.get(f"{API}/admin/v2/marketing/campaigns", headers=H(sales_tok), timeout=20)
        assert r.status_code == 200

    def test_cannot_write_tickets(self, sales_tok):
        r = requests.post(f"{API}/admin/v2/tickets", headers=H(sales_tok),
                          json={"category": "Bug", "subject": "x", "body": "y"}, timeout=20)
        assert r.status_code == 403


class TestRbacSupportAgent:
    def test_can_write_tickets(self, support_tok):
        r = requests.post(f"{API}/admin/v2/tickets", headers=H(support_tok),
                          json={"category": "Training", "subject": "TEST_support_agt",
                                "body": "z"}, timeout=20)
        assert r.status_code == 200, r.text

    def test_cannot_write_revenue(self, support_tok):
        # try to create an invoice (revenue:write equivalent)
        r = requests.post(f"{API}/admin/v2/subscriptions/invoices", headers=H(support_tok),
                          json={"clinic_id": "tenant-kims-hearing", "tier": "STANDARD",
                                "duration": "annual"}, timeout=20)
        assert r.status_code == 403


class TestRbacFinanceManager:
    def test_can_read_revenue(self, finance_tok):
        r = requests.get(f"{API}/admin/v2/revenue", headers=H(finance_tok), timeout=20)
        assert r.status_code == 200

    def test_can_read_invoices(self, finance_tok):
        # invoice listing happens inside revenue endpoint; also try plans
        r = requests.get(f"{API}/admin/v2/subscriptions/plans", headers=H(finance_tok), timeout=20)
        assert r.status_code == 200

    def test_cannot_write_features(self, finance_tok):
        r = requests.put(f"{API}/admin/v2/feature-flags/tenant-kims-hearing",
                         headers=H(finance_tok),
                         json={"extra_modules": ["analytics"], "disabled_modules": []}, timeout=20)
        assert r.status_code == 403


class TestRbacProductOps:
    def test_can_write_features(self, ops_tok):
        r = requests.put(f"{API}/admin/v2/feature-flags/tenant-kims-hearing",
                         headers=H(ops_tok),
                         json={"extra_modules": ["analytics"], "disabled_modules": []}, timeout=20)
        assert r.status_code == 200, r.text

    def test_cannot_write_revenue(self, ops_tok):
        r = requests.post(f"{API}/admin/v2/subscriptions/invoices", headers=H(ops_tok),
                          json={"clinic_id": "tenant-kims-hearing", "tier": "STANDARD",
                                "duration": "annual"}, timeout=20)
        assert r.status_code == 403


class TestRbacReadOnly:
    def test_can_read_dashboard(self, readonly_tok):
        r = requests.get(f"{API}/admin/v2/dashboard", headers=H(readonly_tok), timeout=30)
        assert r.status_code == 200

    def test_can_read_tenants(self, readonly_tok):
        r = requests.get(f"{API}/admin/v2/tenants", headers=H(readonly_tok), timeout=30)
        assert r.status_code == 200

    def test_cannot_write_anything(self, readonly_tok):
        # tickets:write
        r1 = requests.post(f"{API}/admin/v2/tickets", headers=H(readonly_tok),
                           json={"category": "Bug", "subject": "x", "body": "y"}, timeout=20)
        assert r1.status_code == 403
        # marketing:write
        r2 = requests.post(f"{API}/admin/v2/marketing/campaigns", headers=H(readonly_tok),
                           json={"name": "X", "source": "google-ads", "budget": 1.0}, timeout=20)
        assert r2.status_code == 403
        # notifications:write
        r3 = requests.post(f"{API}/admin/v2/notifications/send", headers=H(readonly_tok),
                           json={"title": "X", "body": "y", "audience": "all",
                                 "channels": ["in-app"]}, timeout=20)
        assert r3.status_code == 403


# ============= 11. UNAUTH =============
def test_tickets_unauth():
    r = requests.get(f"{API}/admin/v2/tickets", timeout=20)
    assert r.status_code == 401
