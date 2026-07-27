#!/bin/bash

set -e

echo "=== Repacking AppImage ==="

cd "$(dirname "$0")/.."

APPIMAGE_TOOL="./appimagetool.AppImage"
OUTPUT="dist/Johnny CyberSuite X-3.7.1.AppImage"

if [ ! -f "$APPIMAGE_TOOL" ]; then
    echo "appimagetool not found"
    exit 1
fi

rm -f "$OUTPUT"

"$APPIMAGE_TOOL" \
dist/squashfs-root \
"$OUTPUT"

chmod +x "$OUTPUT"

echo "AppImage rebuilt ✓"
ls -lh "$OUTPUT"
