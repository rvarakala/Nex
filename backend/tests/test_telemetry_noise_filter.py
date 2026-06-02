"""Regression — `/api/_telemetry/frontend-error` must drop noise."""
import requests

from _helpers import API


def _post(payload):
    return requests.post(
        f"{API}/_telemetry/frontend-error",
        json=payload,
    )


def test_401_unhandledrejection_is_filtered():
    """The classic 'wrong password' noise pattern: axios bubbles its
    rejection as an unhandledrejection with message 'Request failed
    with status code 401'. Must NOT be written to error_logs."""
    r = _post({
        "message": "Request failed with status code 401",
        "source": "unhandledrejection",
        "route": "/login",
        "stack": None,
        "session_id": None,
        "extra": {},
        "user_agent": "pytest",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("filtered") == "noise"
    assert "log_id" not in body, "filtered row should not produce a log_id"


def test_404_unhandledrejection_is_filtered():
    r = _post({
        "message": "Request failed with status code 404",
        "source": "unhandledrejection",
        "route": "/patients/UNKNOWN",
    })
    assert r.json().get("filtered") == "noise"


def test_cancelled_request_is_filtered():
    r = _post({
        "message": "canceled",
        "source": "unhandledrejection",
        "route": "/billing",
    })
    assert r.json().get("filtered") == "noise"


def test_real_crash_is_still_written():
    """A genuine 500-class failure (server crashed) MUST still be logged."""
    r = _post({
        "message": "Request failed with status code 500",
        "source": "unhandledrejection",
        "route": "/api/something",
    })
    body = r.json()
    assert body.get("ok") is True
    assert "log_id" in body, "real 5xx error must be written, got: " + str(body)


def test_real_react_crash_is_still_written():
    """A React render crash (source=boundary) is always written."""
    r = _post({
        "message": "Cannot read properties of undefined (reading 'map')",
        "source": "boundary",
        "route": "/billing/invoices",
        "stack": "at SomeComponent (App.js:42)",
    })
    body = r.json()
    assert "log_id" in body
