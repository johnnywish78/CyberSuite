#!/bin/bash

set -e

echo "================================="
echo " Johnny CyberSuite X Release"
echo "================================="

echo "[1/5] Building..."
npm run build


echo "[2/5] Fixing sandbox..."

find dist -name chrome-sandbox -exec sudo chown root:root {} \;
find dist -name chrome-sandbox -exec sudo chmod 4755 {} \;


echo "[3/5] Preparing AppImage..."

if [ -f "./appimagetool.AppImage" ]; then

    chmod +x ./appimagetool.AppImage

    rm -f "dist/Johnny CyberSuite X-3.7.1.AppImage"

    ./appimagetool.AppImage \
    dist/squashfs-root \
    "dist/Johnny CyberSuite X-3.7.1.AppImage"

    chmod +x "dist/Johnny CyberSuite X-3.7.1.AppImage"

else
    echo "appimagetool missing"
fi


echo "[4/5] Checking output..."

ls -lh dist


echo "[5/5] Done ✓"

