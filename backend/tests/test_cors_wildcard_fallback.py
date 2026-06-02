"""Regression — production CORS misconfiguration fallback.

Bug (2026-06-02 P0 incident #2): production env had `CORS_ORIGINS=*` set.
Combined with cookie auth (`withCredentials: true`), every browser request
got rejected by the same-origin policy because the spec forbids
`Allow-Origin: *` + credentialed responses → frontend showed "Network Error".

Fix: when `CORS_ORIGINS=*`, the wildcard is IGNORED in favour of the regex
fallback (which is credential-compatible). This test pins that behaviour so
nobody re-introduces the silent downgrade.
"""
import importlib
import os
from unittest import mock


def _reload_server_cors() -> dict:
    """Re-import server.py with patched env, returning the resolved CORS kwargs."""
    import server  # noqa: F401
    importlib.reload(__import__("server"))
    import server as srv  # noqa: F811
    # _cors_kwargs is module-local; read via getattr to keep it robust.
    return {
        "allow_credentials": srv._allow_credentials,
        "allow_origin_regex": srv._allow_origin_regex,
        "allow_origins": srv._allow_origins,
    }


def test_wildcard_cors_is_ignored_and_falls_back_to_regex():
    """CORS_ORIGINS='*' must NOT propagate. Credentials must stay enabled,
    and the regex fallback must cover audinexa.com."""
    with mock.patch.dict(os.environ, {"CORS_ORIGINS": "*"}, clear=False):
        cfg = _reload_server_cors()
    assert cfg["allow_credentials"] is True, (
        "Cookie auth needs credentials; never disable them silently."
    )
    assert cfg["allow_origin_regex"] is not None
    assert "audinexa\\.com" in cfg["allow_origin_regex"]
    assert "*" not in cfg["allow_origins"], (
        "Wildcard must not leak through to CORSMiddleware when cookies are in use."
    )


def test_unset_cors_uses_regex_fallback():
    with mock.patch.dict(os.environ, {}, clear=False):
        os.environ.pop("CORS_ORIGINS", None)
        cfg = _reload_server_cors()
    assert cfg["allow_credentials"] is True
    assert cfg["allow_origin_regex"] is not None
    assert cfg["allow_origins"] == []


def test_explicit_allowlist_overrides_regex_as_documented():
    with mock.patch.dict(
        os.environ,
        {"CORS_ORIGINS": "https://audinexa.com,https://www.audinexa.com"},
        clear=False,
    ):
        cfg = _reload_server_cors()
    assert cfg["allow_credentials"] is True
    assert "https://audinexa.com" in cfg["allow_origins"]
    assert "https://www.audinexa.com" in cfg["allow_origins"]
