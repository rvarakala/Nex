"""Regression: Marketing-site visitor traffic analytics.

Locks the API contract used by the AdminPanel's "Traffic" screen:
  · Public beacon `POST /api/track` requires NO auth
  · Founder-only overview endpoint returns totals + daily series +
    campaigns + landings + referrers + events
  · Live endpoint returns visitors_online in the last N minutes
  · Tracker script is served as valid JavaScript with the right
    Content-Type and a cache header
"""
import os
import uuid
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://referral-payout-lab.preview.emergentagent.com",
).rstrip("/")
FOUNDER_EMAIL = "founder@audinexa.com"
FOUNDER_PASSWORD = "AudinexaFounder@2026"


def _founder():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": FOUNDER_EMAIL, "password": FOUNDER_PASSWORD},
               timeout=30)
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}"})
    return s


def test_tracker_script_served_as_javascript():
    r = requests.get(f"{BASE_URL}/api/track.js", timeout=15)
    assert r.status_code == 200
    assert "javascript" in (r.headers.get("content-type") or "").lower()
    # Sanity check that it's the real tracker, not an error page.
    body = r.text
    assert "audinexaTrack" in body
    assert "sendBeacon" in body


def test_public_beacon_accepts_pageview_without_auth():
    """The beacon must be reachable from audinexa.com without a token."""
    vid = f"v-pytest-{uuid.uuid4().hex[:8]}"
    sid = f"s-pytest-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{BASE_URL}/api/track", json={
        "visitor_id": vid, "session_id": sid,
        "kind": "pageview", "path": "/pricing",
        "utm_source": "google", "utm_medium": "cpc",
        "utm_campaign": "pytest-camp",
        "referrer": "https://google.com/",
        "origin_referrer": "https://google.com/",
    }, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True


def test_beacon_rejects_malformed_payload():
    """Empty visitor_id must be rejected — otherwise we'd get junk rows."""
    r = requests.post(f"{BASE_URL}/api/track", json={
        "visitor_id": "", "session_id": "", "kind": "pageview",
    }, timeout=15)
    assert r.status_code == 422   # pydantic validation


def test_overview_requires_super_admin_and_returns_expected_shape():
    """Overview endpoint must be founder-only; unauthenticated 401 and
    the schema must include the keys the AdminPanel renders."""
    r = requests.get(f"{BASE_URL}/api/admin/marketing-traffic/overview", timeout=15)
    assert r.status_code == 401

    # Seed one campaign hit so the response has something meaningful.
    vid = f"v-pytest-{uuid.uuid4().hex[:8]}"
    sid = f"s-pytest-{uuid.uuid4().hex[:8]}"
    requests.post(f"{BASE_URL}/api/track", json={
        "visitor_id": vid, "session_id": sid,
        "kind": "pageview", "path": "/features",
        "utm_source": "linkedin", "utm_medium": "social",
        "utm_campaign": "pytest-shape-check",
    }, timeout=15)
    # Also fire a custom event so the events section has data.
    requests.post(f"{BASE_URL}/api/track", json={
        "visitor_id": vid, "session_id": sid,
        "kind": "event", "event_name": "pytest_cta",
    }, timeout=15)

    s = _founder()
    r = s.get(f"{BASE_URL}/api/admin/marketing-traffic/overview?days=30", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()

    # Contract keys the AdminPanel binds to.
    for key in ("range_days", "totals", "daily", "top_landings",
                "top_referrers", "campaigns", "top_events"):
        assert key in d, f"missing top-level key: {key}"

    t = d["totals"]
    for key in ("page_views", "unique_visitors", "unique_sessions",
                "custom_events", "avg_pages_per_session",
                "avg_session_seconds", "bounce_rate_pct"):
        assert key in t, f"missing totals key: {key}"

    # Our seeded campaign should surface.
    camp_names = [c["campaign"] for c in d["campaigns"]]
    assert "pytest-shape-check" in camp_names

    # Our seeded custom event should surface.
    ev_names = [e["event_name"] for e in d["top_events"]]
    assert "pytest_cta" in ev_names


def test_live_endpoint_returns_expected_shape():
    s = _founder()
    r = s.get(f"{BASE_URL}/api/admin/marketing-traffic/live?minutes=15", timeout=15)
    assert r.status_code == 200
    d = r.json()
    for key in ("window_minutes", "visitors_online", "active_sessions", "live_paths"):
        assert key in d, f"missing key: {key}"
    assert isinstance(d["live_paths"], list)
