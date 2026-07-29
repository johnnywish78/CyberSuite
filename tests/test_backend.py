import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from backend.app import app


client = TestClient(app)


def test_health_endpoint():
    response = client.get("/api/health")

    assert response.status_code == 200

    data = response.json()

    assert data["ok"] is True
    assert "version" in data


def test_stats_endpoint():
    response = client.get("/api/stats")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, dict)


def test_network_info_endpoint():
    response = client.get("/api/network/info")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, dict)


def test_system_info_endpoint():
    response = client.get("/api/system/info")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, dict)

    assert "os" in data
    assert "cpu_model" in data


def test_themes_endpoint():
    response = client.get("/api/themes")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, (dict, list))


def test_assets_endpoint():
    response = client.get("/api/assets")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, (dict, list))
