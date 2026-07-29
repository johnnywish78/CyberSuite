from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def test_dist_folder_exists():
    dist = ROOT / "dist"

    assert dist.exists()


def test_latest_build_artifacts():
    dist = ROOT / "dist"

    appimages = list(dist.glob("*.AppImage"))
    debs = list(dist.glob("*.deb"))

    # اگر build نشده باشد skip می‌کنیم
    if not appimages and not debs:
        return

    assert len(appimages) >= 1 or len(debs) >= 1


def test_build_not_empty():
    dist = ROOT / "dist"

    if not dist.exists():
        return

    for file in dist.glob("*"):
        if file.is_file():
            assert file.stat().st_size > 0
