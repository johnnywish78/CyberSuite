import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from backend.app import app


client = TestClient(app)


def test_stats_contract():
    r = client.get("/api/stats")

    assert r.status_code == 200

    data = r.json()

    assert isinstance(data, dict)


def test_system_info_contract():
    r = client.get("/api/system/info")

    assert r.status_code == 200

    data = r.json()

    required = [
        "cpu_model",
        "ram_total",
        "hostname"
    ]

    for item in required:
        assert item in data


def test_health_contract():
    r = client.get("/api/health")

    assert r.status_code == 200

    data = r.json()

    assert "ok" in data
    assert "version" in data
