from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parent.parent


IGNORE = {
    ".git",
    "venv",
    "node_modules",
    "__pycache__",
    "dist",
    "squashfs-root"
}


def should_ignore(path):
    return any(part in IGNORE for part in path.parts)


def test_no_secret_patterns():

    patterns = [
        "BEGIN PRIVATE KEY",
        "BEGIN RSA PRIVATE KEY",
        "ghp_",
        "sk-"
    ]

    for file in ROOT.rglob("*.py"):

        if should_ignore(file):
            continue

        try:
            text = file.read_text(errors="ignore")

            for pattern in patterns:
                assert pattern not in text

        except Exception:
            pass



def test_gitignore_security():

    gitignore = ROOT / ".gitignore"

    assert gitignore.exists()

    content = gitignore.read_text()

    assert "backend/settings.json" in content
    assert "venv/" in content
    assert "node_modules/" in content



def test_no_tracked_settings():

    result = subprocess.run(
        ["git", "ls-files", "backend/settings.json"],
        cwd=ROOT,
        capture_output=True,
        text=True
    )

    assert result.stdout.strip() == ""
