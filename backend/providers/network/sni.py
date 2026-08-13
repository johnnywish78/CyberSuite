"""
CloudPilot — SNI spoof checker.

Determines whether the local ISP allows SNI spoofing. It connects to a
target (default Cloudflare) and observes whether the TLS handshake
succeeds when the SNI is masked with a decoy, which indicates whether
SNI-based filtering is bypassable. Mirrors the SNI Spoof Check of the
mirarr-app/network-checker project.
"""

from __future__ import annotations

import asyncio
import socket
import ssl
from typing import Any

DEFAULT_HOST = "chatgpt.com"
DEFAULT_DECOY = "icloud.com"
PROBE_IPS = ["1.1.1.1", "1.0.0.1"]


class SniSpoofError(RuntimeError):
    """SNI spoof check failed."""


class SniSpoofChecker:
    """Check whether SNI spoofing is possible on the local connection."""

    def __init__(self, timeout: float = 5.0):
        self.timeout = timeout

    async def check(
        self,
        host: str = DEFAULT_HOST,
        decoy: str = DEFAULT_DECOY,
    ) -> dict[str, Any]:
        host = (host or DEFAULT_HOST).strip().lower()
        decoy = (decoy or DEFAULT_DECOY).strip().lower()

        result = await self._check_one(host, decoy)

        return {
            "host": host,
            "decoy": decoy,
            **result,
        }

    async def _check_one(self, host: str, decoy: str) -> dict[str, Any]:
        """Probe with the real SNI and with a decoy SNI."""
        real = await self._tls_with_sni(host, host)
        spoofed = await self._tls_with_sni(host, decoy)

        return {
            "real_sni": real,
            "spoofed_sni": spoofed,
            "spoof_supported": spoofed is not None,
        }

    async def _tls_with_sni(self, host: str, sni: str) -> float | None:
        """Return handshake latency using the given SNI, or None."""
        loop = asyncio.get_running_loop()

        for ip in PROBE_IPS:
            started = loop.time()

            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(
                        host=ip,
                        port=443,
                        ssl=ssl.create_default_context(),
                        server_hostname=sni,
                    ),
                    timeout=self.timeout,
                )
            except (asyncio.TimeoutError, OSError, ssl.SSLError):
                continue

            elapsed_ms = (loop.time() - started) * 1000.0

            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

            return round(elapsed_ms, 1)

        return None
