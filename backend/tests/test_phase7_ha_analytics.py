"""Phase 7 HA Analytics — backend tests (final phase per user's 7-phase plan).

Covers:
- Revenue (monthly series + brand split + totals)
- Audiologist performance (sales, revenue, below-floor %, WA sends)
- Inventory health (aging + dead counts + fast-moving accessories)
- Funnel (stages + conversion rates + avg trial-to-convert)
- Retention (missed followups, active subs, loyalty, upgrade pipeline)
- Role gates (only clinic_owner / super_admin / accounts allowed)
"""
import os
import pytest
import requests


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
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="session")
def admin_token(): return _login("admin@acs.in", "admin123")


@pytest.fixture(scope="session")
def accounts_token(): return _login("accounts@acs.in", "accounts123")


@pytest.fixture(scope="session")
def audiologist_token(): return _login("audiologist@acs.in", "audio123")


@pytest.fixture(scope="session")
def frontdesk_token(): return _login("frontdesk@acs.in", "frontdesk123")


# ==================== REVENUE ====================

class TestRevenue:
    def test_structure(self, admin_token):
        r = requests.get(f"{API}/ha/analytics/revenue?months=12", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(d.keys()) >= {"window_months", "total_revenue", "total_sales_count",
                                  "avg_ticket", "monthly", "brand_split"}
        assert d["window_months"] == 12
        assert isinstance(d["monthly"], list)
        assert isinstance(d["brand_split"], list)

    def test_consistency(self, admin_token):
        """Sum of monthly.revenue should equal total_revenue (floating tolerance)."""
        d = requests.get(f"{API}/ha/analytics/revenue?months=12", headers=hdr(admin_token)).json()
        s = sum(m["revenue"] for m in d["monthly"])
        assert abs(s - d["total_revenue"]) < 1, f"{s} vs {d['total_revenue']}"

    def test_avg_ticket(self, admin_token):
        d = requests.get(f"{API}/ha/analytics/revenue", headers=hdr(admin_token)).json()
        if d["total_sales_count"] > 0:
            expected = round(d["total_revenue"] / d["total_sales_count"], 2)
            assert abs(d["avg_ticket"] - expected) < 0.5

    def test_invalid_months_clamp(self, admin_token):
        r = requests.get(f"{API}/ha/analytics/revenue?months=999", headers=hdr(admin_token))
        assert r.status_code == 200
        assert r.json()["window_months"] == 12     # clamped back to default


# ==================== AUDIOLOGISTS ====================

class TestAudiologists:
    def test_structure(self, admin_token):
        r = requests.get(f"{API}/ha/analytics/audiologists?days=90", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["window_days"] == 90
        for row in d["rows"]:
            for k in ("user_id", "name", "role", "sales_count", "revenue",
                      "below_floor_count", "below_floor_pct", "paid_conversion_pct",
                      "paid_count", "wa_sends"):
                assert k in row

    def test_no_accounts_role_in_performance(self, admin_token):
        """Accounts user who creates paid-tracker records shouldn't appear as an audiologist."""
        d = requests.get(f"{API}/ha/analytics/audiologists", headers=hdr(admin_token)).json()
        for row in d["rows"]:
            assert row["role"] != "accounts"


# ==================== INVENTORY HEALTH ====================

class TestInventory:
    def test_structure(self, admin_token):
        r = requests.get(f"{API}/ha/analytics/inventory", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "totals" in d and "aging_by_product" in d and "fast_moving_accessories" in d
        assert {"in_stock_total", "aging_units", "dead_units", "cost_blocked"} <= set(d["totals"].keys())
        assert d["aging_days"] == 90
        assert d["dead_days"] == 180

    def test_custom_thresholds(self, admin_token):
        r = requests.get(f"{API}/ha/analytics/inventory?aging_days=30&dead_days=60",
                         headers=hdr(admin_token))
        assert r.status_code == 200
        assert r.json()["aging_days"] == 30
        assert r.json()["dead_days"] == 60


# ==================== FUNNEL ====================

class TestFunnel:
    def test_structure(self, admin_token):
        r = requests.get(f"{API}/ha/analytics/funnel?days=90", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["window_days"] == 90
        stages = d["stages"]
        expected = {"consultations", "quotations", "trials_issued",
                    "trials_converted", "trials_returned", "trials_lost",
                    "sales_total", "sales_paid"}
        assert expected <= set(stages.keys())
        rates = d["rates"]
        for k in ("quote_per_consult_pct", "trial_per_quote_pct",
                  "convert_per_trial_pct", "lost_per_trial_pct", "paid_per_sale_pct"):
            assert k in rates
        # avg days can be None or a number
        assert d["avg_trial_to_convert_days"] is None or isinstance(d["avg_trial_to_convert_days"], (int, float))


# ==================== RETENTION ====================

class TestRetention:
    def test_structure(self, admin_token):
        r = requests.get(f"{API}/ha/analytics/retention", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        expected = {"missed_followups", "dismissed_followups", "dismissed_pct",
                    "active_subscriptions", "loyal_repeat_patients", "upgrade_pipeline_size"}
        assert expected <= set(d.keys())
        for k in expected:
            assert isinstance(d[k], (int, float))


# ==================== ROLE GATES ====================

class TestRoleGates:
    @pytest.mark.parametrize("ep", ["revenue", "audiologists", "inventory", "funnel", "retention"])
    def test_front_desk_forbidden(self, frontdesk_token, ep):
        r = requests.get(f"{API}/ha/analytics/{ep}", headers=hdr(frontdesk_token), timeout=15)
        assert r.status_code == 403, f"{ep}: {r.status_code}"

    @pytest.mark.parametrize("ep", ["revenue", "audiologists", "inventory", "funnel", "retention"])
    def test_audiologist_forbidden(self, audiologist_token, ep):
        r = requests.get(f"{API}/ha/analytics/{ep}", headers=hdr(audiologist_token), timeout=15)
        assert r.status_code == 403, f"{ep}: {r.status_code}"

    @pytest.mark.parametrize("ep", ["revenue", "audiologists", "inventory", "funnel", "retention"])
    def test_accounts_allowed(self, accounts_token, ep):
        r = requests.get(f"{API}/ha/analytics/{ep}", headers=hdr(accounts_token), timeout=15)
        assert r.status_code == 200, f"{ep}: {r.status_code} {r.text}"


# ==================== FULL STACK REGRESSION ====================

class TestRegression:
    @pytest.mark.parametrize("path", [
        "/ha/analytics/revenue", "/ha/analytics/audiologists",
        "/ha/analytics/inventory", "/ha/analytics/funnel", "/ha/analytics/retention",
        "/ha/followups", "/ha/subscriptions", "/ha/trials", "/ha/fittings",
        "/ha/sales", "/ha/quotations", "/ha/products", "/ha/serial-items",
        "/branches", "/vendors", "/patients",
    ])
    def test_endpoint_200(self, admin_token, path):
        r = requests.get(f"{API}{path}", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, f"{path} → {r.status_code}"
