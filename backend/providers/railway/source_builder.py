"""
CloudPilot — avaco-railway source packaging.

Bundles the Avaco Railway Relay source tree into a gzipped tarball so
it can be uploaded to Railway via the `railway up` endpoint.
"""

from __future__ import annotations

import io
import tarfile
from pathlib import Path

SOURCE_DIR = Path(__file__).resolve().parent / "source"


class RailwaySourceError(RuntimeError):
    """Failed to package the relay source."""


def build_source_tarball() -> bytes:
    """Return a gzipped tar archive of the relay source tree.

    The archive root is ``./`` so Railway builds the project directly
    from the uploaded files (Nixpacks detects package.json).
    """
    if not SOURCE_DIR.is_dir():
        raise RailwaySourceError(
            f"Railway source tree missing at {SOURCE_DIR}."
        )

    files = sorted(
        path for path in SOURCE_DIR.rglob("*") if path.is_file()
    )

    if not files:
        raise RailwaySourceError("Railway source tree is empty.")

    buffer = io.BytesIO()

    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for path in files:
            relative = path.relative_to(SOURCE_DIR).as_posix()
            info = tarfile.TarInfo(name=f"./{relative}")
            info.size = path.stat().st_size
            info.mtime = 0
            archive.addfile(info, path.open("rb"))

    return buffer.getvalue()
