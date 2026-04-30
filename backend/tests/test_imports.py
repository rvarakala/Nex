"""Regression tests for /api/imports/patients/* — bulk patient CSV import.

Verifies:
  * Template download (auth + CSV format)
  * Preview validates correctly (ok / skip / fail classification)
  * Commit is idempotent and preserves provided MRDs while auto-generating
    sequence numbers for missing ones.
  * Front-desk users cannot access any of the import endpoints.
"""
import io

import pytest
import requests


API = "http://localhost:8001/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=10)
    r.raise_for_status()
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def owner_token():
    return _login("owner@thesoundclinic.in", "demo123")


@pytest.fixture(scope="module")
def frontdesk_token():
    return _login("meera@thesoundclinic.in", "demo123")


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def test_template_download(owner_token):
    r = requests.get(f"{API}/imports/patients/template", headers=_h(owner_token), timeout=10)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    body = r.text
    # Header line + at least one example row.
    assert "name,age,gender,mobile" in body
    assert "Asha Iyer" in body


def test_template_403_for_frontdesk(frontdesk_token):
    r = requests.get(f"{API}/imports/patients/template", headers=_h(frontdesk_token), timeout=10)
    assert r.status_code == 403


def test_preview_classifies_rows_correctly(owner_token):
    csv = (
        "name,age,gender,mobile,existing_mrd,email\n"
        "Reg Test Alpha,40,Male,9112233440,REG-A,a@x.in\n"
        "Reg Test Beta,,Bogus,9112233441,,b@x.in\n"   # fail: gender + age
        "Reg Test Gamma,30,Female,9112233440,,g@x.in\n"  # skip: dup mobile in file
    )
    files = {"file": ("test.csv", io.BytesIO(csv.encode()), "text/csv")}
    r = requests.post(f"{API}/imports/patients/preview", headers=_h(owner_token), files=files, timeout=10)
    assert r.status_code == 200
    body = r.json()
    statuses = {row["name"]: row["status"] for row in body["rows"]}
    assert statuses["Reg Test Alpha"] == "ok"
    assert statuses["Reg Test Beta"] == "fail"
    assert statuses["Reg Test Gamma"] == "skip"
    assert body["tally"]["will_create"] == 1
    assert body["tally"]["will_skip"] == 1
    assert body["tally"]["will_fail"] == 1


def test_preview_403_for_frontdesk(frontdesk_token):
    files = {"file": ("x.csv", io.BytesIO(b"name,age,gender\nA,30,Male\n"), "text/csv")}
    r = requests.post(f"{API}/imports/patients/preview", headers=_h(frontdesk_token), files=files, timeout=10)
    assert r.status_code == 403


def test_preview_rejects_non_csv(owner_token):
    files = {"file": ("hello.txt", io.BytesIO(b"name\nfoo"), "text/plain")}
    r = requests.post(f"{API}/imports/patients/preview", headers=_h(owner_token), files=files, timeout=10)
    assert r.status_code == 400


def test_commit_creates_and_preserves_mrd(owner_token):
    # Use unique mobiles so this test is rerunnable.
    import time
    suffix = str(int(time.time()))[-6:]
    csv = (
        "name,age,gender,mobile,existing_mrd\n"
        f"Pytest Bulk One {suffix},50,Male,98700{suffix[:5]},PYT-{suffix}-A\n"
        f"Pytest Bulk Two {suffix},28,Female,98701{suffix[:5]},\n"
    )
    files = {"file": ("bulk.csv", io.BytesIO(csv.encode()), "text/csv")}
    pr = requests.post(f"{API}/imports/patients/preview", headers=_h(owner_token), files=files, timeout=10)
    assert pr.status_code == 200
    iid = pr.json()["import_id"]

    cr = requests.post(
        f"{API}/imports/patients/commit",
        headers=_h(owner_token),
        json={"import_id": iid},
        timeout=15,
    )
    assert cr.status_code == 200
    assert cr.json()["tally"]["created"] == 2

    # Idempotency — second commit returns already_committed without dupes.
    cr2 = requests.post(
        f"{API}/imports/patients/commit",
        headers=_h(owner_token),
        json={"import_id": iid},
        timeout=10,
    )
    assert cr2.status_code == 200
    assert cr2.json()["already_committed"] is True

    # Verify the explicit MRD was preserved and the auto MRD follows the clinic prefix.
    r = requests.get(f"{API}/patients?q=Pytest+Bulk", headers=_h(owner_token), timeout=10)
    assert r.status_code == 200
    found = {p["name"]: p["mrd"] for p in r.json() if "Pytest Bulk" in p["name"] and suffix in p["name"]}
    assert found.get(f"Pytest Bulk One {suffix}") == f"PYT-{suffix}-A"
    auto_mrd = found.get(f"Pytest Bulk Two {suffix}")
    assert auto_mrd and auto_mrd.startswith("TSC-")  # The Sound Clinic prefix


def test_commit_unknown_id_returns_404(owner_token):
    r = requests.post(
        f"{API}/imports/patients/commit",
        headers=_h(owner_token),
        json={"import_id": "imp_does_not_exist"},
        timeout=10,
    )
    assert r.status_code == 404


def test_recent_history_visible_to_owner(owner_token):
    r = requests.get(f"{API}/imports/patients/recent", headers=_h(owner_token), timeout=10)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
