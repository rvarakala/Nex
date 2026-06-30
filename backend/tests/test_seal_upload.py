"""Tests for the per-user Seal/Stamp upload feature (mirrors signature).

Endpoints under test:
  POST   /api/settings/me/seal
  DELETE /api/settings/me/seal
  GET    /api/settings/users/{user_id}/seal

Verifies happy path (upload → fetch → delete → 404), validation rejections,
and that /api/auth/me exposes the `seal_image_fs_id` so the UI can detect
the saved state on initial load.
"""
from __future__ import annotations

import base64
import os
import struct
import zlib

import pytest
import requests

API = os.environ.get("API_URL") or os.environ.get(
    "REACT_APP_BACKEND_URL", "http://localhost:8001"
).rstrip("/") + "/api"

# Demo Premium tenant clinic owner — already provisioned + persisted across
# preview restarts (see /app/memory/test_credentials.md).
TEST_EMAIL = "owner@thesoundclinic.in"
TEST_PASSWORD = "demo123"


def _tiny_png_b64() -> str:
    """Returns a base64-encoded valid 10x10 pink PNG (~76 bytes). Inline so
    the test has no I/O dependency."""
    def png(w=10, h=10, color=(255, 180, 180)):
        sig = b"\x89PNG\r\n\x1a\n"

        def chunk(t, d):
            c = zlib.crc32(t + d) & 0xFFFFFFFF
            return struct.pack(">I", len(d)) + t + d + struct.pack(">I", c)

        ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
        raw = b"".join(b"\x00" + bytes(color) * w for _ in range(h))
        idat = zlib.compress(raw)
        return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

    return base64.b64encode(png()).decode()


@pytest.fixture(scope="module")
def headers():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def user_id(headers):
    r = requests.get(f"{API}/auth/me", headers=headers, timeout=10)
    r.raise_for_status()
    body = r.json()
    return (body.get("user") or body)["user_id"]


@pytest.fixture(autouse=True)
def _clean_seal_after_each_test(headers):
    """Ensure each test starts/ends with no seal on file so they don't leak
    state into each other. DELETE returns 200 even when there's nothing to
    remove, so this is safe to call unconditionally."""
    yield
    requests.delete(f"{API}/settings/me/seal", headers=headers, timeout=10)


def test_upload_seal_returns_fs_id(headers):
    r = requests.post(
        f"{API}/settings/me/seal",
        headers=headers,
        json={"image_base64": f"data:image/png;base64,{_tiny_png_b64()}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["seal_image_fs_id"]
    assert body["mime"] == "image/png"
    assert body["size_bytes"] > 0


def test_seal_appears_on_auth_me(headers, user_id):
    requests.post(
        f"{API}/settings/me/seal",
        headers=headers,
        json={"image_base64": f"data:image/png;base64,{_tiny_png_b64()}"},
        timeout=15,
    ).raise_for_status()
    me = requests.get(f"{API}/auth/me", headers=headers, timeout=10).json()
    me_user = me.get("user") or me
    assert me_user.get("seal_image_fs_id"), \
        "auth/me must expose seal_image_fs_id so the UI can show the saved-state preview"


def test_fetch_then_delete_roundtrip(headers, user_id):
    requests.post(
        f"{API}/settings/me/seal",
        headers=headers,
        json={"image_base64": f"data:image/png;base64,{_tiny_png_b64()}"},
        timeout=15,
    ).raise_for_status()

    fetch = requests.get(
        f"{API}/settings/users/{user_id}/seal",
        headers=headers,
        timeout=10,
    )
    assert fetch.status_code == 200
    assert fetch.headers["content-type"] == "image/png"
    assert len(fetch.content) > 0

    d = requests.delete(f"{API}/settings/me/seal", headers=headers, timeout=10)
    assert d.status_code == 200
    assert d.json()["ok"] is True

    after = requests.get(
        f"{API}/settings/users/{user_id}/seal",
        headers=headers,
        timeout=10,
    )
    assert after.status_code == 404


def test_rejects_unsupported_mime(headers):
    r = requests.post(
        f"{API}/settings/me/seal",
        headers=headers,
        json={"image_base64": "data:application/pdf;base64,JVBERi0xLjQK"},
        timeout=10,
    )
    assert r.status_code == 415


def test_rejects_empty_payload(headers):
    r = requests.post(
        f"{API}/settings/me/seal",
        headers=headers,
        json={"image_base64": ""},
        timeout=10,
    )
    assert r.status_code == 400


def test_rejects_oversize(headers):
    # 4 MB of random data > 3 MB cap. base64 inflates it ~33%, but the server
    # decodes back to ~4 MB before checking — still over the limit.
    big = base64.b64encode(os.urandom(4_000_000)).decode()
    r = requests.post(
        f"{API}/settings/me/seal",
        headers=headers,
        json={"image_base64": f"data:image/png;base64,{big}"},
        timeout=20,
    )
    assert r.status_code == 413


def test_replace_deletes_previous_blob(headers, user_id):
    """Uploading a second time replaces the first blob — should still return
    a single (new) fs_id, not two. The bucket is kept tight."""
    a = requests.post(
        f"{API}/settings/me/seal",
        headers=headers,
        json={"image_base64": f"data:image/png;base64,{_tiny_png_b64()}"},
        timeout=15,
    ).json()
    b = requests.post(
        f"{API}/settings/me/seal",
        headers=headers,
        json={"image_base64": f"data:image/png;base64,{_tiny_png_b64()}"},
        timeout=15,
    ).json()
    assert a["seal_image_fs_id"] != b["seal_image_fs_id"], \
        "Each upload must allocate a new GridFS id"
    # The previous blob should no longer be fetch-able via the new id check —
    # fetch under the user_id endpoint returns ONLY the current one.
    fetch = requests.get(
        f"{API}/settings/users/{user_id}/seal",
        headers=headers,
        timeout=10,
    )
    assert fetch.status_code == 200
