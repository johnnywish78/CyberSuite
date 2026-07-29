import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from backend.app import app


client = TestClient(app)


# =========================
# Core
# =========================

def test_root():
    r = client.get("/")
    assert r.status_code in [200, 404]


def test_health():
    r = client.get("/api/health")

    assert r.status_code == 200

    data = r.json()

    assert data["ok"] is True
    assert "version" in data


def test_version_format():
    r = client.get("/api/health")

    data = r.json()

    assert isinstance(data["version"], str)
    assert len(data["version"]) > 0


# =========================
# System
# =========================

def test_stats():
    r = client.get("/api/stats")

    assert r.status_code == 200
    assert isinstance(r.json(), dict)


def test_system_info():
    r = client.get("/api/system/info")

    assert r.status_code == 200

    data = r.json()

    assert "cpu_model" in data
    assert "ram_total" in data
    assert "hostname" in data


def test_processes():
    r = client.get("/api/system/processes")

    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_disks():
    r = client.get("/api/system/disk")

    assert r.status_code == 200


# =========================
# Network Center
# =========================

def test_network_info():
    r = client.get("/api/network/info")

    assert r.status_code == 200
    assert isinstance(r.json(), dict)


def test_network_interfaces():
    r = client.get("/api/net/interfaces")

    assert r.status_code == 200


def test_network_connections():
    r = client.get("/api/net/connections")

    assert r.status_code == 200


# =========================
# Themes / Settings
# =========================

def test_themes():
    r = client.get("/api/themes")

    assert r.status_code == 200


def test_theme_assets():
    r = client.get("/api/theme-assets")

    assert r.status_code == 200


def test_settings():
    r = client.get("/api/settings")

    assert r.status_code == 200


# =========================
# VPN
# =========================

def test_vpn_status():
    r = client.get("/api/vpn/status")

    assert r.status_code == 200


def test_vpn_profiles():
    r = client.get("/api/vpn/profiles")

    assert r.status_code == 200

    assert isinstance(r.json(), list)


# =========================
# AI Center
# =========================

def test_ai_providers():
    r = client.get("/api/ai/providers")

    assert r.status_code == 200


# =========================
# Reports
# =========================

def test_reports():
    r = client.get("/api/reports")

    assert r.status_code == 200

    assert isinstance(r.json(), list)
