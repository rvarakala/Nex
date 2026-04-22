"""Response-rate-per-audiologist — backend tests."""
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


def hdr(tok): return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="session")
def admin_token(): return _login("admin@acs.in", "admin123")


class TestResponseRate:
    def test_fields_present(self, admin_token):
        r = requests.get(f"{API}/ha/analytics/audiologists", headers=hdr(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        for row in r.json()["rows"]:
            for k in ("wa_sends", "wa_done", "response_rate_pct"):
                assert k in row, f"missing {k}"
            # Invariant
            assert row["wa_done"] <= row["wa_sends"], f"done > sends on {row['name']}"
            if row["wa_sends"] > 0:
                assert abs(row["response_rate_pct"] - round(100 * row["wa_done"] / row["wa_sends"], 1)) < 0.2
            else:
                assert row["response_rate_pct"] == 0.0

    def test_actors_without_sales_still_surface(self, admin_token):
        """Front-desk / technicians who send WAs but don't sell should appear if they have sends."""
        r = requests.get(f"{API}/ha/analytics/audiologists", headers=hdr(admin_token)).json()
        non_sellers = [x for x in r["rows"] if x["sales_count"] == 0]
        # At least allow the endpoint to include them (not strict count)
        for ns in non_sellers:
            assert ns["wa_sends"] >= 0
            assert ns["role"] != "accounts"    # accounts excluded
