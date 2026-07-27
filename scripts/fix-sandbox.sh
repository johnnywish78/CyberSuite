#!/bin/bash

set -e

echo "=== Fixing Electron sandbox ==="

# Fix chrome-sandbox permissions
find dist -name chrome-sandbox -exec sudo chown root:root {} \;
find dist -name chrome-sandbox -exec sudo chmod 4755 {} \;

echo "chrome-sandbox fixed ✓"


# Patch AppRun inside squashfs-root if exists
if [ -f "dist/squashfs-root/AppRun" ]; then

    echo "Patching AppRun..."

    cp dist/squashfs-root/AppRun dist/squashfs-root/AppRun.backup

    sed -i 's/exec "\$BIN"/exec "\$BIN" --no-sandbox/g' \
    dist/squashfs-root/AppRun

    echo "AppRun patched ✓"

fi


echo "Sandbox fix completed ✓"
