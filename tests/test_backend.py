import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from backend.app import app


client = TestClient(app)


# -------------------------
# Basic Backend
# -------------------------

def test_backend_root():
    response = client.get("/")
    assert response.status_code in [200, 404]


def test_health():
    response = client.get("/api/health")

    assert response.status_code == 200

    data = response.json()

    assert data["ok"] is True
    assert "version" in data


# -------------------------
# System Stats
# -------------------------

def test_stats_endpoint():
    response = client.get("/api/stats")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, dict)


def test_system_info():
    response = client.get("/api/system/info")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, dict)
    assert "cpu_model" in data
    assert "ram_total" in data


# -------------------------
# Network Center
# -------------------------

def test_network_info():
    response = client.get("/api/network/info")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, dict)


# -------------------------
# Themes / Settings
# -------------------------

def test_themes():
    response = client.get("/api/themes")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, (dict, list))


def test_theme_assets():
    response = client.get("/api/theme-assets")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, (dict, list))


# -------------------------
# VPN
# -------------------------

def test_vpn_status():
    response = client.get("/api/vpn/status")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, dict)


def test_vpn_profiles():
    response = client.get("/api/vpn/profiles")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, list)


# -------------------------
# AI Center
# -------------------------

def test_ai_providers():
    response = client.get("/api/ai/providers")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, (dict, list))


# -------------------------
# Reports
# -------------------------

def test_reports_list():
    response = client.get("/api/reports")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, list)
