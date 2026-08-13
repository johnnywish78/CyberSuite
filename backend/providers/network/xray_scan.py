"""
CloudPilot — CDN Xray Scanner.

Scans CDN IP ranges using an Xray JSON config and reports the IPs that
are reachable over the configured protocol/port. Mirrors the CDN Xray
Scanner feature of the mirarr-app/network-checker project.

Unlike the original tool we do not shell out to an Xray binary; we probe
the target IPs over TCP/TLS using the connection settings extracted from
the JSON config, which is safe and dependency-free.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import ssl
from typing import Any

XRAY_DEFAULT_RANGES = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
]


class XrayScannerError(RuntimeError):
    """Xray scan failed."""


def _extract_settings(config: dict[str, Any]) -> dict[str, Any]:
    """Pull address / port / sni / network from an Xray JSON config."""
    outbounds = config.get("outbounds") or []

    for outbound in outbounds:
        protocol = outbound.get("protocol") or ""

        if protocol not in {"vless", "vmess", "trojan"}:
            continue

        settings = outbound.get("settings") or {}
        vnext = settings.get("vnext") or settings.get("servers") or []

        if not vnext:
            continue

        target = vnext[0]
        address = str(target.get("address") or "").strip()
        port = int(target.get("port") or 443)

        if not address:
            continue

        stream = outbound.get("streamSettings") or {}
        security = str(stream.get("security") or "").strip()
        tls_settings = stream.get("tlsSettings") or stream.get("realitySettings") or {}
        sni = str(
            tls_settings.get("serverName")
            or tls_settings.get("server_names")
            or stream.get("host")
            or address
        )

        if isinstance(sni, list):
            sni = str(sni[0]) if sni else address

        return {
            "address": address,
            "port": port,
            "sni": sni.strip() or address,
            "security": security,
            "network": str(stream.get("network") or "tcp"),
        }

    raise XrayScannerError(
        "No vless/vmess/trojan outbound found in the Xray config."
    )


class XrayScanner:
    """Scan CDN IP ranges and return the reachable ones."""

    def __init__(
        self,
        ranges: list[str] | None = None,
        sample_size: int = 512,
        concurrency: int = 128,
        timeout: float = 3.0,
    ):
        self.ranges = ranges or list(XRAY_DEFAULT_RANGES)
        self.sample_size = sample_size
        self.concurrency = concurrency
        self.timeout = timeout

    async def scan(self, config: str) -> dict[str, Any]:
        try:
            parsed = json.loads(config)
        except json.JSONDecodeError as exc:
            raise XrayScannerError(f"Invalid Xray JSON: {exc}") from exc

        settings = _extract_settings(parsed)
        ips = self._candidate_ips()

        semaphore = asyncio.Semaphore(self.concurrency)
        results: list[dict[str, Any]] = []
        checked = 0

        async def worker(ip: str) -> None:
            nonlocal checked

            async with semaphore:
                latency = await self._probe(ip, settings)

                if latency is not None:
                    results.append({"ip": ip, "latency_ms": latency})

                checked += 1

        await asyncio.gather(*(worker(ip) for ip in ips))

        results.sort(key=lambda item: item["latency_ms"])

        return {
            "address": settings["address"],
            "port": settings["port"],
            "sni": settings["sni"],
            "network": settings["network"],
            "security": settings["security"],
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
                raise XrayScannerError(f"Invalid IP range '{raw}': {exc}") from exc

        if not networks:
            raise XrayScannerError("No IP ranges were provided.")

        ips: list[str] = []
        total = 0
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
            total += take

        if not ips:
            raise XrayScannerError(
                "The provided IP ranges contain no usable addresses."
            )

        return ips

    async def _probe(
        self,
        ip: str,
        settings: dict[str, Any],
    ) -> float | None:
        loop = asyncio.get_running_loop()
        started = loop.time()

        use_tls = settings["security"] in {"tls", "reality"} or settings["port"] == 443

        try:
            if use_tls:
                context = ssl.create_default_context()
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE

                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(
                        host=ip,
                        port=settings["port"],
                        ssl=context,
                        server_hostname=settings["sni"],
                    ),
                    timeout=self.timeout,
                )
            else:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(
                        host=ip,
                        port=settings["port"],
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
