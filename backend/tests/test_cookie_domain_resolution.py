"""Regression — cookie Domain auto-detection for the audinexa.com family.

Bug (2026-06-02 P0 incident #3): production founder reported "not
authenticated" on every admin page when accessing https://www.audinexa.com.
The API silently 308-redirects POSTs from www → apex, login succeeds, but
the resulting cookies are set with no Domain attribute → host-only on
`audinexa.com`. The browser at www.audinexa.com never sends them on
follow-up API calls → "Not authenticated".

Fix: when the request host is in the audinexa.com family, auto-set
`Domain=.audinexa.com` so cookies are shared apex↔www↔any subdomain.

This module exercises `_resolve_cookie_domain` directly because it's the
single decision point. (Integration testing via FastAPI's TestClient would
require pinning the Host header, which is fine for a single test but not
worth the fixture cost for a 4-case parameterised unit test.)
"""
import os
from unittest import mock

from utils.auth_cookies import _resolve_cookie_domain


class _FakeReq:
    def __init__(self, host: str):
        self.headers = {"host": host}
        self.url = type("U", (), {"hostname": host.split(":")[0]})()


def test_apex_audinexa_gets_dotted_domain():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("AUTH_COOKIE_DOMAIN", None)
        assert _resolve_cookie_domain(_FakeReq("audinexa.com")) == ".audinexa.com"


def test_www_audinexa_gets_dotted_domain():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("AUTH_COOKIE_DOMAIN", None)
        assert _resolve_cookie_domain(_FakeReq("www.audinexa.com")) == ".audinexa.com"


def test_api_audinexa_subdomain_gets_dotted_domain():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("AUTH_COOKIE_DOMAIN", None)
        assert _resolve_cookie_domain(_FakeReq("api.audinexa.com")) == ".audinexa.com"


def test_preview_pod_remains_host_only():
    """Each preview deploy has its own unique hostname — wildcard makes no
    sense. Must return None to keep cookies host-only on preview."""
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("AUTH_COOKIE_DOMAIN", None)
        assert _resolve_cookie_domain(
            _FakeReq("careful-feedback.preview.emergentagent.com")
        ) is None


def test_localhost_remains_host_only():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("AUTH_COOKIE_DOMAIN", None)
        assert _resolve_cookie_domain(_FakeReq("localhost:3000")) is None
        assert _resolve_cookie_domain(_FakeReq("127.0.0.1")) is None


def test_no_request_returns_none():
    """Belt-and-braces — never crash if caller forgets to pass request."""
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("AUTH_COOKIE_DOMAIN", None)
        assert _resolve_cookie_domain(None) is None


def test_env_var_overrides_auto_detect():
    """Operator-controlled override takes precedence."""
    with mock.patch.dict(os.environ, {"AUTH_COOKIE_DOMAIN": "audinexa.com"}, clear=False):
        # No leading dot — operator chose host-only audinexa.com explicitly.
        assert _resolve_cookie_domain(_FakeReq("www.audinexa.com")) == "audinexa.com"


def test_audinexa_lookalike_does_not_get_dotted_domain():
    """`my-audinexa.com` is a different eTLD+1; must NOT inherit our cookie scope."""
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("AUTH_COOKIE_DOMAIN", None)
        assert _resolve_cookie_domain(_FakeReq("my-audinexa.com")) is None
        assert _resolve_cookie_domain(_FakeReq("not-audinexa.com")) is None
