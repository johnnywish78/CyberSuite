from pathlib import Path
import json


ROOT = Path(__file__).resolve().parent.parent


def test_package_json_exists():
    assert (ROOT / "package.json").exists()


def test_package_json_valid():
    with open(ROOT / "package.json") as f:
        data = json.load(f)

    assert data["name"] == "johnny-cybersuite-x"
    assert "version" in data
    assert "build" in data


def test_electron_main_exists():
    assert (ROOT / "desktop" / "main.js").exists()


def test_preload_exists():
    assert (ROOT / "desktop" / "preload.js").exists()


def test_renderer_exists():
    renderer = ROOT / "desktop" / "renderer"

    assert renderer.exists()

    assert (renderer / "index.html").exists()
    assert (renderer / "style.css").exists()
    assert (renderer / "app.js").exists()


def test_backend_exists():
    backend = ROOT / "backend"

    assert backend.exists()
    assert (backend / "app.py").exists()


def test_version_file():
    version = ROOT / "version.json"

    assert version.exists()

    with open(version) as f:
        data = json.load(f)

    assert "version" in data
    assert len(data["version"]) > 0
