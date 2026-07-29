from pathlib import Path
import json


ROOT = Path(__file__).resolve().parent.parent


def test_electron_entry():
    main = ROOT / "desktop" / "main.js"

    assert main.exists()

    content = main.read_text()

    assert "BrowserWindow" in content
    assert "app.whenReady" in content


def test_preload_api():
    preload = ROOT / "desktop" / "preload.js"

    assert preload.exists()

    content = preload.read_text()

    assert "contextBridge" in content


def test_renderer_html():
    html = ROOT / "desktop" / "renderer" / "index.html"

    assert html.exists()

    content = html.read_text()

    assert "<html" in content.lower()


def test_renderer_links():
    html = ROOT / "desktop" / "renderer" / "index.html"

    content = html.read_text()

    assert "app.js" in content
    assert "style.css" in content


def test_package_scripts():
    package = ROOT / "package.json"

    with open(package) as f:
        data = json.load(f)

    scripts = data["scripts"]

    assert "start" in scripts
    assert "build" in scripts
