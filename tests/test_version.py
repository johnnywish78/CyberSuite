from pathlib import Path
import json


ROOT = Path(__file__).resolve().parent.parent


def read_json(path):
    with open(path) as f:
        return json.load(f)


def test_version_consistency():

    package = read_json(ROOT / "package.json")
    version = read_json(ROOT / "version.json")

    package_version = package.get("version")
    file_version = version.get("version")

    assert package_version == file_version


def test_version_format():

    version = read_json(ROOT / "version.json")

    value = version["version"]

    parts = value.split(".")

    assert len(parts) == 3
    assert all(x.isdigit() for x in parts)
