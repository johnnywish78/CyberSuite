#!/bin/bash

set -e

echo "=== Repacking AppImage ==="

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

VERSION=$(cat VERSION)

APPIMAGE_TOOL="./appimagetool.AppImage"
OUTPUT="dist/Johnny CyberSuite X-${VERSION}.AppImage"

if [ ! -f "$APPIMAGE_TOOL" ]; then
    echo "appimagetool not found"
    exit 1
fi

if [ ! -d "dist/squashfs-root" ]; then
    echo "squashfs-root missing"
    exit 1
fi

rm -f "$OUTPUT"

"$APPIMAGE_TOOL" \
    dist/squashfs-root \
    "$OUTPUT"

chmod +x "$OUTPUT"

echo "AppImage rebuilt ✓"
ls -lh "$OUTPUT"
