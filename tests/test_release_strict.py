from pathlib import Path
import json


ROOT = Path(__file__).resolve().parent.parent


def test_build_config():

    with open(ROOT / "package.json") as f:
        data=json.load(f)


    build=data["build"]


    assert "appId" in build
    assert "productName" in build
    assert "linux" in build



def test_linux_targets():

    with open(ROOT / "package.json") as f:
        data=json.load(f)


    targets=data["build"]["linux"]["target"]

    assert "deb" in targets
    assert "AppImage" in targets
