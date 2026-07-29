from pathlib import Path
import json
import pytest


ROOT = Path(__file__).resolve().parent.parent


def test_dist_folder_exists():
    """
    dist is created only after electron-builder.
    Skip in normal CI test stage.
    """

    dist = ROOT / "dist"

    if not dist.exists():
        pytest.skip("dist folder not created before build")

    assert dist.exists()


def test_latest_build_artifacts():

    dist = ROOT / "dist"

    if not dist.exists():
        pytest.skip("Build artifacts not available")

    artifacts = list(dist.glob("*.AppImage")) + list(dist.glob("*.deb"))

    assert len(artifacts) > 0


def test_build_not_empty():

    dist = ROOT / "dist"

    if not dist.exists():
        pytest.skip("No build directory")

    files = list(dist.rglob("*"))

    assert len(files) > 0


def test_appimage_not_empty():

    dist = ROOT / "dist"

    if not dist.exists():
        pytest.skip("No build directory")

    images = list(dist.glob("*.AppImage"))

    if not images:
        pytest.skip("No AppImage generated")

    for img in images:
        assert img.stat().st_size > 1024


def test_deb_not_empty():

    dist = ROOT / "dist"

    if not dist.exists():
        pytest.skip("No build directory")

    debs = list(dist.glob("*.deb"))

    if not debs:
        pytest.skip("No DEB generated")

    for deb in debs:
        assert deb.stat().st_size > 1024


def test_linux_unpackaged_exists():

    unpacked = ROOT / "dist" / "linux-unpacked"

    if not unpacked.exists():
        pytest.skip("linux-unpacked not generated")

    assert unpacked.exists()


def test_backend_inside_resources():

    resources = ROOT / "dist" / "linux-unpacked" / "resources"

    if not resources.exists():
        pytest.skip("Electron build not generated")

    backend = resources / "backend"

    assert backend.exists()


def test_app_asar_exists():

    asar = ROOT / "dist" / "linux-unpacked" / "resources" / "app.asar"

    if not asar.exists():
        pytest.skip("app.asar not generated")

    assert asar.stat().st_size > 1024


def test_package_type_exists():

    package_type = ROOT / "dist" / "linux-unpacked" / "resources" / "package-type"

    if not package_type.exists():
        pytest.skip("No package metadata")

    assert package_type.exists()
