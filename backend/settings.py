import json
from pathlib import Path

# Writable runtime settings (works inside AppImage)
SETTINGS_FILE = Path.home() / ".config" / "Johnny CyberSuite X" / "settings.json"

if not SETTINGS_FILE.exists():
    src = Path(__file__).parent / "settings.json"
    if src.exists():
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(
            src.read_text(encoding="utf-8"),
            encoding="utf-8"
        )
THEMES_FILE       = Path(__file__).parent.parent / "themes.json"
THEME_ASSETS_FILE = Path(__file__).parent.parent / "theme_assets.json"

def load_settings():
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {}

def save_settings(data):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def load_themes():
    if THEMES_FILE.exists():
        try:
            with open(THEMES_FILE, "r", encoding="utf-8") as f:
                return json.load(f).get("themes", [])
        except:
            pass
    return []

def load_theme_assets():
    """Online asset map per theme id (bg / font / icon / music). Editable by hand."""
    if THEME_ASSETS_FILE.exists():
        try:
            with open(THEME_ASSETS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {}


def load_ai_settings() -> dict:
    """Return the 'ai' sub-object from settings.json."""
    return load_settings().get("ai", {})


def save_ai_settings(data: dict):
    """Merge data into settings['ai'] and persist."""
    s = load_settings()
    ai = s.get("ai", {})
    ai.update(data)
    s["ai"] = ai
    save_settings(s)
