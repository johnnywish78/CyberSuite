"""
CloudPilot — BPB deployment state store.

Persists deployment records (generated credentials and URLs) to a
local JSON file so the desktop app can show personal config after
restarts without re-deploying.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from backend.settings import ROOT_DIR

_DATA_DIR = ROOT_DIR / "backend" / "data"
_DEFAULT_STORE_PATH = _DATA_DIR / "bpb_deployments.json"


class DeploymentStore:
    def __init__(self, path: Path | None = None):
        self.path = path or _DEFAULT_STORE_PATH
        self._lock = threading.Lock()

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}

        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def _write(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def save(self, worker_name: str, record: dict[str, Any]) -> None:
        with self._lock:
            data = self._read()
            data[worker_name] = record
            self._write(data)

    def get(self, worker_name: str) -> dict[str, Any] | None:
        with self._lock:
            return self._read().get(worker_name)

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            records = self._read()
            return list(records.values())

    def delete(self, worker_name: str) -> bool:
        with self._lock:
            data = self._read()
            removed = data.pop(worker_name, None) is not None
            if removed:
                self._write(data)
            return removed