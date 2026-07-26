#!/bin/bash

echo "Fixing chrome-sandbox permissions..."

find dist -name chrome-sandbox -exec sudo chown root:root {} \;
find dist -name chrome-sandbox -exec sudo chmod 4755 {} \;

echo "Done."
