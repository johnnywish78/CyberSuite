#!/bin/bash
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo -e "\033[1;33m╔══════════════════════════════════╗\033[0m"
echo -e "\033[1;33m║   Johnny CyberSuite X v3.7.0     ║\033[0m"
echo -e "\033[1;33m╚══════════════════════════════════╝\033[0m"

# Kill any old process on port 8765
echo "[*] Freeing port 8765..."
fuser -k 8765/tcp 2>/dev/null || true
sleep 0.5

# VENV با مسیر مطلق
if [ ! -d "$DIR/venv" ]; then
  echo "[*] Creating venv with python3..."
  python3 -m venv "$DIR/venv"
fi

# فعال‌سازی با مسیر مطلق
source "$DIR/venv/bin/activate"

# Python deps (با مسیر مطلق pip)
echo "[*] Checking Python dependencies..."
"$DIR/venv/bin/pip" install -q -r backend/requirements.txt

# Node deps
if [ ! -d "node_modules/electron" ]; then
  echo "[*] Installing Node dependencies..."
  npm install
fi

# Start backend on port 8765
echo "[*] Starting backend on :8765..."
PYTHONPATH="$DIR" python3 -m uvicorn backend.app:app \
  --host 127.0.0.1 --port 8765 --log-level warning &
BACKEND_PID=$!
echo "[✓] Backend PID: $BACKEND_PID"

# Wait for backend ready
echo -n "[*] Waiting for backend"
for i in {1..30}; do
  if curl -sf http://127.0.0.1:8765/api/health > /dev/null 2>&1; then
    echo -e " \033[32m✓ Ready\033[0m"
    break
  fi
  echo -n "."
  sleep 0.4
done

# Launch Electron (with venv python in PATH)
echo "[*] Launching Electron..."
npm start

# Cleanup on exit
echo "[*] Shutting down..."
kill $BACKEND_PID 2>/dev/null || true
fuser -k 8765/tcp 2>/dev/null || true
echo "[✓] Bye!"
