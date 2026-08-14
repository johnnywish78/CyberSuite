# -*- mode: python ; coding: utf-8 -*-
"""CloudPilot backend — PyInstaller build spec.

Builds a self-contained one-folder executable named `cloudpilot-backend`
into `dist/backend/`. electron-builder copies this folder into the app
resources so the packaged Electron shell can launch it without requiring
a system Python installation.

Build:  pyinstaller --clean --noconfirm packaging/backend.spec
"""

from PyInstaller.utils.hooks import collect_all
import os

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

# FastAPI/Starlette/Pydantic load a number of modules dynamically, so we
# collect each framework wholesale instead of guessing hidden imports.
datas = [(os.path.join(ROOT, "version.json"), ".")]
binaries = []
hiddenimports = []

for package in ("uvicorn", "fastapi", "starlette", "pydantic", "pydantic_core", "dotenv"):
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

a = Analysis(
    [os.path.join(ROOT, "backend", "server.py")],
    pathex=[ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="cloudpilot-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="cloudpilot-backend",
)
