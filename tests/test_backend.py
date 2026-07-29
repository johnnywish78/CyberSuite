import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Add project root
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from backend.app import app


client = TestClient(app)


def test_backend_starts():
    response = client.get("/")
    assert response.status_code in [200, 404]


def test_stats_endpoint():
    response = client.get("/api/stats")
    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, dict)
