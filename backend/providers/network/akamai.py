"""
CloudPilot — Akamai IP Scanner.

Scans Akamai edge IP ranges over TLS and reports the reachable ones.
Mirrors the Akamai Scanner feature of the mirarr-app/network-checker
project.
"""

from __future__ import annotations

import asyncio
import ipaddress
import ssl
from typing import Any

AKAMAI_RANGES = [
    "23.32.0.0/11",
    "23.64.0.0/14",
    "63.64.0.0/10",
    "72.246.0.0/15",
    "96.6.0.0/15",
    "104.64.0.0/10",
    "184.24.0.0/13",
    "209.64.0.0/12",
    "209.170.64.0/18",
    "173.222.0.0/15",
]

AKAMAI_SNI = "www.akamai.com"
AKAMAI_PORT = 443


class AkamaiScanError(RuntimeError):
    """Akamai scan failed."""


class AkamaiScanner:
    """Scan Akamai IP ranges and return the reachable ones."""

    def __init__(
        self,
        ranges: list[str] | None = None,
        sample_size: int = 512,
        concurrency: int = 128,
        timeout: float = 3.0,
    ):
        self.ranges = ranges or list(AKAMAI_RANGES)
        self.sample_size = sample_size
        self.concurrency = concurrency
        self.timeout = timeout

    async def scan(self, sni: str = AKAMAI_SNI) -> dict[str, Any]:
        clean_sni = (sni or AKAMAI_SNI).strip().lower() or AKAMAI_SNI

        ips = self._candidate_ips()

        semaphore = asyncio.Semaphore(self.concurrency)
        results: list[dict[str, Any]] = []
        checked = 0

        async def worker(ip: str) -> None:
            nonlocal checked

            async with semaphore:
                latency = await self._probe(ip, clean_sni)

                if latency is not None:
                    results.append({"ip": ip, "latency_ms": latency})

                checked += 1

        await asyncio.gather(*(worker(ip) for ip in ips))

        results.sort(key=lambda item: item["latency_ms"])

        return {
            "sni": clean_sni,
            "port": AKAMAI_PORT,
            "scanned": checked,
            "reachable": len(results),
            "results": results,
        }

    def _candidate_ips(self) -> list[str]:
        networks: list[ipaddress.IPv4Network] = []

        for raw in self.ranges:
            raw = raw.strip()

            if not raw:
                continue

            try:
                networks.append(ipaddress.ip_network(raw, strict=False))
            except ValueError as exc:
                raise AkamaiScanError(f"Invalid IP range '{raw}': {exc}") from exc

        if not networks:
            raise AkamaiScanError("No IP ranges were provided.")

        ips: list[str] = []
        remaining = max(1, self.sample_size)

        for net in networks:
            if remaining <= 0:
                break

            addresses = [str(addr) for addr in net.hosts()]

            if not addresses:
                continue

            take = min(remaining, len(addresses))
            step = max(1, len(addresses) // take)
            ips.extend(addresses[::step][:take])
            remaining -= take

        if not ips:
            raise AkamaiScanError(
                "The provided IP ranges contain no usable addresses."
            )

        return ips

    async def _probe(self, ip: str, sni: str) -> float | None:
        loop = asyncio.get_running_loop()
        started = loop.time()

        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(
                    host=ip,
                    port=AKAMAI_PORT,
                    ssl=context,
                    server_hostname=sni,
                ),
                timeout=self.timeout,
            )
        except (asyncio.TimeoutError, OSError, ssl.SSLError):
            return None

        elapsed_ms = (loop.time() - started) * 1000.0

        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass

        return round(elapsed_ms, 1)
