"""
Version consistency tests.

`package.json#version` is the single source of truth; the generated
`version.json` and `VERSION` artifacts must always match it, and the
backend must report the same value on `/api/health`.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend import settings
from backend.app import app

ROOT = Path(settings.ROOT_DIR)
client = TestClient(app)


def _package_json_version() -> str:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    return package["version"]


def test_version_json_matches_package_json():
    assert (ROOT / "version.json").exists()
    data = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))
    assert data["version"] == _package_json_version()


def test_version_text_file_matches_package_json():
    assert (ROOT / "VERSION").exists()
    assert (ROOT / "VERSION").read_text(encoding="utf-8").strip() == _package_json_version()


def test_service_version_matches_package_json():
    assert settings.service_version() == _package_json_version()


def test_health_reports_version():
    body = client.get("/api/health").json()
    assert body["version"] == _package_json_version()