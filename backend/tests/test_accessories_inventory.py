"""Tests for the Accessories inventory feature (Jan 2026).

Covers:
- GET /api/ha/accessory-stock-hydrated (kpis + items shape, filters)
- POST /api/ha/products/preset-ric-receiver (create-and-seed + role gate)
- POST /api/ha/products/{id}/init-accessory-stock (idempotency + role gate + serialised rejection)
- POST /api/ha/accessory-stock/{sku_id}/adjust (positive/negative + 409 below-zero)
- POST /api/ha/products with new accessory_kind/category/variant_labels
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

OWNER = ("owner@thesoundclinic.in", "demo123")
AUDIO = ("aditi@thesoundclinic.in", "demo123")   # audiologist — should be gated
FRONTDESK = ("meera@thesoundclinic.in", "demo123")  # front_desk — should be gated
BRANCH_ID = "BR-SOUNDCLINIC-HQ"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def owner_headers():
    return {"Authorization": f"Bearer {_login(*OWNER)}"}


@pytest.fixture(scope="module")
def audio_headers():
    return {"Authorization": f"Bearer {_login(*AUDIO)}"}


@pytest.fixture(scope="module")
def frontdesk_headers():
    return {"Authorization": f"Bearer {_login(*FRONTDESK)}"}


# ---------- GET /accessory-stock-hydrated ----------
class TestHydrated:
    def test_shape_and_kpis(self, owner_headers):
        r = requests.get(f"{API}/ha/accessory-stock-hydrated", headers=owner_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "kpis" in data and "items" in data
        for k in ("total_skus", "zero_stock", "low_stock", "ok_stock"):
            assert k in data["kpis"], f"missing kpi {k}"
            assert isinstance(data["kpis"][k], int)
        # KPI arithmetic
        k = data["kpis"]
        assert k["ok_stock"] == max(0, k["total_skus"] - k["zero_stock"] - k["low_stock"])
        # Items should be hydrated
        if data["items"]:
            row = data["items"][0]
            assert "product" in row
            assert "branch" in row
            assert "qty_on_hand" in row and "reorder_level" in row

    def test_low_stock_only_filter_preserves_kpi_totals(self, owner_headers):
        r_all = requests.get(f"{API}/ha/accessory-stock-hydrated", headers=owner_headers, timeout=20)
        r_low = requests.get(
            f"{API}/ha/accessory-stock-hydrated?low_stock_only=true",
            headers=owner_headers, timeout=20,
        )
        assert r_all.status_code == 200 and r_low.status_code == 200
        # KPIs are full-clinic — should be identical regardless of filter
        assert r_all.json()["kpis"] == r_low.json()["kpis"]
        # Items may be fewer when filtered
        assert len(r_low.json()["items"]) <= len(r_all.json()["items"])

    def test_branch_filter(self, owner_headers):
        r = requests.get(
            f"{API}/ha/accessory-stock-hydrated?branch_id={BRANCH_ID}",
            headers=owner_headers, timeout=20,
        )
        assert r.status_code == 200
        for row in r.json()["items"]:
            assert row["branch_id"] == BRANCH_ID


# ---------- POST /products/preset-ric-receiver ----------
class TestRicPreset:
    def test_role_gate_audiologist_forbidden(self, audio_headers):
        r = requests.post(
            f"{API}/ha/products/preset-ric-receiver",
            headers=audio_headers,
            json={"brand": "TEST_RoleGate", "branch_ids": [BRANCH_ID]},
            timeout=20,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_role_gate_frontdesk_forbidden(self, frontdesk_headers):
        r = requests.post(
            f"{API}/ha/products/preset-ric-receiver",
            headers=frontdesk_headers,
            json={"brand": "TEST_RoleGate2", "branch_ids": [BRANCH_ID]},
            timeout=20,
        )
        assert r.status_code == 403

    def test_owner_can_create_and_seed(self, owner_headers):
        brand = f"TEST_RIC_{int(time.time())}"
        r = requests.post(
            f"{API}/ha/products/preset-ric-receiver",
            headers=owner_headers,
            json={"brand": brand, "branch_ids": [BRANCH_ID], "reorder_level": 5},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["stock_rows_created"] == 9
        prod = body["product"]
        assert prod["accessory_kind"] == "ric_receiver"
        assert prod["accessory_category"] == "replaceable"
        assert prod["is_serialised"] is False
        assert prod["form_factor"] == "accessory"
        assert prod["variant_labels"] == ["1M", "2M", "3M", "10P", "2P", "3P", "1S", "2S", "3S"]
        # Verify persistence via hydrated endpoint
        r2 = requests.get(
            f"{API}/ha/accessory-stock-hydrated?product_id={prod['product_id']}",
            headers=owner_headers, timeout=20,
        )
        assert r2.status_code == 200
        rows = r2.json()["items"]
        assert len(rows) == 9
        assert {row["variant"] for row in rows} == set(prod["variant_labels"])


# ---------- POST /products/{id}/init-accessory-stock ----------
class TestInitStock:
    @pytest.fixture(scope="class")
    def battery_product(self, owner_headers):
        payload = {
            "brand": f"TEST_BAT_{int(time.time())}",
            "model": "Battery 312",
            "form_factor": "accessory",
            "is_serialised": False,
            "mrp": 30,
            "gst_rate": 18,
            "hsn": "8506",
            "accessory_kind": "battery",
            "accessory_category": "consumable",
            "variant_labels": [],
        }
        r = requests.post(f"{API}/ha/products", headers=owner_headers, json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        prod = r.json()
        # Confirm new fields persisted
        assert prod.get("accessory_kind") == "battery"
        assert prod.get("accessory_category") == "consumable"
        return prod

    def test_init_stock_creates_one_row_no_variants(self, owner_headers, battery_product):
        pid = battery_product["product_id"]
        r = requests.post(
            f"{API}/ha/products/{pid}/init-accessory-stock",
            headers=owner_headers,
            json={"branch_ids": [BRANCH_ID], "variants": [], "reorder_level": 20},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["created"] == 1
        assert body["skipped_existing"] == 0

    def test_init_stock_is_idempotent(self, owner_headers, battery_product):
        pid = battery_product["product_id"]
        r = requests.post(
            f"{API}/ha/products/{pid}/init-accessory-stock",
            headers=owner_headers,
            json={"branch_ids": [BRANCH_ID], "variants": [], "reorder_level": 20},
            timeout=20,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["created"] == 0
        assert body["skipped_existing"] >= 1

    def test_init_stock_role_gate(self, audio_headers, battery_product):
        pid = battery_product["product_id"]
        r = requests.post(
            f"{API}/ha/products/{pid}/init-accessory-stock",
            headers=audio_headers,
            json={"branch_ids": [BRANCH_ID], "variants": [], "reorder_level": 5},
            timeout=20,
        )
        assert r.status_code == 403

    def test_init_stock_rejects_serialised_product(self, owner_headers):
        # Create a serialised accessory product (e.g. charger)
        payload = {
            "brand": f"TEST_CHRG_{int(time.time())}",
            "model": "Charger",
            "form_factor": "accessory",
            "is_serialised": True,
            "accessory_kind": "charger",
            "accessory_category": "addon",
        }
        rp = requests.post(f"{API}/ha/products", headers=owner_headers, json=payload, timeout=20)
        assert rp.status_code in (200, 201), rp.text
        pid = rp.json()["product_id"]
        r = requests.post(
            f"{API}/ha/products/{pid}/init-accessory-stock",
            headers=owner_headers,
            json={"branch_ids": [BRANCH_ID], "variants": [], "reorder_level": 1},
            timeout=20,
        )
        assert r.status_code == 400


# ---------- POST /accessory-stock/{sku_id}/adjust ----------
class TestAdjust:
    def _first_sku(self, owner_headers):
        r = requests.get(f"{API}/ha/accessory-stock-hydrated", headers=owner_headers, timeout=20)
        assert r.status_code == 200
        items = r.json()["items"]
        assert items, "no accessory stock rows exist in fixture data"
        # Prefer a row that has some qty to allow +/- flows
        with_qty = [x for x in items if x["qty_on_hand"] > 0]
        return (with_qty[0] if with_qty else items[0])

    def test_positive_delta_and_persistence(self, owner_headers):
        sku = self._first_sku(owner_headers)
        before = sku["qty_on_hand"]
        r = requests.post(
            f"{API}/ha/accessory-stock/{sku['sku_id']}/adjust",
            headers=owner_headers,
            json={"delta": 5, "reason": "stock_in"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["qty_on_hand"] == before + 5

    def test_negative_delta(self, owner_headers):
        sku = self._first_sku(owner_headers)
        before = sku["qty_on_hand"]
        r = requests.post(
            f"{API}/ha/accessory-stock/{sku['sku_id']}/adjust",
            headers=owner_headers,
            json={"delta": -2, "reason": "damaged"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["qty_on_hand"] == before - 2

    def test_below_zero_rejected(self, owner_headers):
        sku = self._first_sku(owner_headers)
        r = requests.post(
            f"{API}/ha/accessory-stock/{sku['sku_id']}/adjust",
            headers=owner_headers,
            json={"delta": -(sku["qty_on_hand"] + 999), "reason": "adjustment"},
            timeout=20,
        )
        assert r.status_code == 409

    def test_adjust_role_gate(self, audio_headers, owner_headers):
        sku = self._first_sku(owner_headers)
        r = requests.post(
            f"{API}/ha/accessory-stock/{sku['sku_id']}/adjust",
            headers=audio_headers,
            json={"delta": 1, "reason": "stock_in"},
            timeout=20,
        )
        assert r.status_code == 403
