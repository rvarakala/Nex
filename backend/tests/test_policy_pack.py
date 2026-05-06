"""End-to-end test for the ISO 27001 / DPDP Policy Pack endpoints."""
import os
import requests

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"


def _login():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@delhi.test", "password": "delhiadmin123"}, timeout=15)
    r.raise_for_status()
    return r.json().get("access_token") or r.json()["token"]


def test_policy_pack():
    h = {"Authorization": f"Bearer {_login()}"}

    # 1. List endpoint
    r = requests.get(f"{API}/legal/policies", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["count"] == 7, d
    ids = {p["id"] for p in d["policies"]}
    assert "01_information_security" in ids
    assert "07_business_continuity" in ids
    assert d["dpdp_aligned"] is True

    # 2. Render endpoint — placeholders substituted
    r = requests.get(f"{API}/legal/policies/03_data_protection_privacy", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["title"] == "Data Protection & Privacy Policy"
    assert d["code"] == "DPP-03"
    md = d["markdown"]
    # No raw placeholders should remain
    assert "{{" not in md, f"Unsubstituted placeholder in rendered markdown: {md[:300]}"
    # Clinic-specific values are present
    assert "Delhi" in md, md[:300]
    ctx = d["context"]
    assert ctx["clinic_id"] == "clinic-delhi-test"
    assert "@" in ctx["dpo_email"]

    # 3. PDF endpoint — must return %PDF-1.x bytes
    r = requests.get(f"{API}/legal/policies/03_data_protection_privacy/pdf", headers=h, timeout=15)
    assert r.status_code == 200, r.status_code
    assert r.headers["content-type"] == "application/pdf", r.headers
    assert r.content[:5] == b"%PDF-", r.content[:20]
    assert len(r.content) > 1000, len(r.content)  # non-trivial PDF

    # 4. Unknown policy → 404
    r = requests.get(f"{API}/legal/policies/99_nonexistent", headers=h, timeout=10)
    assert r.status_code == 404, r.text

    # 5. All 7 render successfully (smoke)
    for p in d["title"], "01_information_security", "02_access_control", \
              "03_data_protection_privacy", "04_incident_response", \
              "05_data_retention_deletion", "06_vendor_sub_processors", \
              "07_business_continuity":
        if "_" not in str(p):
            continue
        r = requests.get(f"{API}/legal/policies/{p}", headers=h, timeout=15)
        assert r.status_code == 200, f"{p}: {r.text[:200]}"

    # 6. Auth required
    r = requests.get(f"{API}/legal/policies", timeout=10)
    assert r.status_code in (401, 403), r.status_code

    print("PASS: 7 policies, render + PDF + auth + 404 all OK.")


if __name__ == "__main__":
    test_policy_pack()
