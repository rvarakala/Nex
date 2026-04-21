"""Backend tests for AI narrative generation endpoint + session prerequisites."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    # Fallback to frontend/.env
    try:
        with open('/app/frontend/.env') as f:
            for line in f:
                if line.startswith('REACT_APP_BACKEND_URL='):
                    BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
                    break
    except Exception:
        pass

API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def patient_id(api_client):
    r = api_client.post(f"{API}/patients", json={
        "name": "TEST_AI_Patient",
        "age": 45,
        "gender": "Male",
    })
    assert r.status_code == 200, r.text
    return r.json()["patient_id"]


@pytest.fixture(scope="module")
def session_id(api_client, patient_id):
    r = api_client.post(f"{API}/sessions", json={"patient_id": patient_id})
    assert r.status_code == 200, r.text
    sid = r.json()["session_id"]

    # Populate with clinical data: PTA sloping SNHL bilaterally + Type A tymps
    payload = {
        "right_ear_audiogram": {
            "ear": "right",
            "ac_measurements": [
                {"frequency": 250, "threshold_db": 15},
                {"frequency": 500, "threshold_db": 20},
                {"frequency": 1000, "threshold_db": 25},
                {"frequency": 2000, "threshold_db": 35},
                {"frequency": 4000, "threshold_db": 45},
                {"frequency": 8000, "threshold_db": 55},
            ],
            "bc_measurements": [
                {"frequency": 500, "threshold_db": 15},
                {"frequency": 1000, "threshold_db": 25},
                {"frequency": 2000, "threshold_db": 30},
                {"frequency": 4000, "threshold_db": 40},
            ],
        },
        "left_ear_audiogram": {
            "ear": "left",
            "ac_measurements": [
                {"frequency": 250, "threshold_db": 20},
                {"frequency": 500, "threshold_db": 25},
                {"frequency": 1000, "threshold_db": 30},
                {"frequency": 2000, "threshold_db": 40},
                {"frequency": 4000, "threshold_db": 50},
                {"frequency": 8000, "threshold_db": 60},
            ],
            "bc_measurements": [
                {"frequency": 500, "threshold_db": 20},
                {"frequency": 1000, "threshold_db": 28},
                {"frequency": 2000, "threshold_db": 38},
                {"frequency": 4000, "threshold_db": 45},
            ],
        },
        "impedance_data": {
            "tympanometry": {
                "right": {"jerger_type": "A", "me_pressure": -10, "compliance": 0.7, "volume": 1.2, "probe_hz": 226},
                "left":  {"jerger_type": "A", "me_pressure": -5,  "compliance": 0.8, "volume": 1.1, "probe_hz": 226},
            }
        },
    }
    r2 = api_client.put(f"{API}/sessions/{sid}", json=payload)
    assert r2.status_code == 200, r2.text
    return sid


# ---------- Health ----------
def test_health(api_client):
    r = api_client.get(f"{API}/health")
    assert r.status_code == 200
    assert r.json()["status"] == "healthy"


# ---------- AI narrative generation ----------
def test_ai_generate_all(api_client, session_id):
    r = api_client.post(f"{API}/ai/narrative/generate",
                        json={"session_id": session_id, "target": "all"},
                        timeout=90)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["target"] == "all"
    result = body["result"]
    for key in ("puretone_findings", "immitence_findings", "speech_findings",
                "recommendations", "further_advice"):
        assert key in result, f"Missing {key} in response"
    assert isinstance(result["recommendations"], list)
    # PTA + tympanometry data provided → both should be non-empty
    assert isinstance(result["puretone_findings"], str) and len(result["puretone_findings"]) > 20
    assert isinstance(result["immitence_findings"], str) and len(result["immitence_findings"]) > 10


def test_ai_generate_puretone_only(api_client, session_id):
    r = api_client.post(f"{API}/ai/narrative/generate",
                        json={"session_id": session_id, "target": "puretone_findings"},
                        timeout=90)
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    assert "puretone_findings" in result
    assert len(result["puretone_findings"]) > 20
    # Must NOT contain other clinical field keys
    assert "immitence_findings" not in result
    assert "speech_findings" not in result


def test_ai_generate_immitence_only(api_client, session_id):
    r = api_client.post(f"{API}/ai/narrative/generate",
                        json={"session_id": session_id, "target": "immitence_findings"},
                        timeout=90)
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    assert "immitence_findings" in result
    assert len(result["immitence_findings"]) > 10


def test_ai_generate_recommendations_list(api_client, session_id):
    r = api_client.post(f"{API}/ai/narrative/generate",
                        json={"session_id": session_id, "target": "recommendations"},
                        timeout=90)
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    assert "recommendations" in result
    assert isinstance(result["recommendations"], list)
    assert len(result["recommendations"]) >= 1
    assert all(isinstance(x, str) and x for x in result["recommendations"])


def test_ai_generate_invalid_target(api_client, session_id):
    # Pydantic _Literal constraint will actually yield 422 from FastAPI; accept 400/422.
    r = api_client.post(f"{API}/ai/narrative/generate",
                        json={"session_id": session_id, "target": "invalid"})
    assert r.status_code in (400, 422), r.text


def test_ai_generate_unknown_session(api_client):
    r = api_client.post(f"{API}/ai/narrative/generate",
                        json={"session_id": "nonexistent-session-id-xyz", "target": "all"})
    assert r.status_code == 404, r.text
