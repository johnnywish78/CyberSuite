"""
CloudPilot — Clean IP checker.

Scans Cloudflare (and other) IP ranges from the user's own internet
connection and reports which ones are reachable and how fast they
respond. These "clean IPs" can be used to pin the panel config / VPN
subscriptions to IPs that are not filtered by the local ISP.

Inspired by the Edge IP Checker of the mirarr-app/network-checker
project (https://github.com/mirarr-app/network-checker).
"""

from __future__ import annotations

import asyncio
import ipaddress
import ssl
from dataclasses import dataclass, field
from typing import Any

CLEAN_IP_SNI = "speed.cloudflare.com"
CLEAN_IP_PORT = 443

DEFAULT_RANGES = [
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

DEFAULT_SAMPLE_SIZE = 512


class CleanIpError(RuntimeError):
    """Clean IP scan failed."""


@dataclass
class ScanOptions:
    snis: list[str] = field(
        default_factory=lambda: [CLEAN_IP_SNI]
    )
    port: int = CLEAN_IP_PORT
    ranges: list[str] = field(default_factory=list)
    sample_size: int = DEFAULT_SAMPLE_SIZE
    concurrency: int = 128
    timeout: float = 3.0


@dataclass
class ScanResult:
    ip: str
    latency_ms: float
    sni: str
    port: int


def _candidate_ips(options: ScanOptions) -> list[str]:
    """Return the list of IPs to probe, honouring the sample size."""
    networks: list[ipaddress.IPv4Network] = []

    raw_ranges = options.ranges or DEFAULT_RANGES

    for raw in raw_ranges:
        raw = raw.strip()

        if not raw:
            continue

        try:
            networks.append(ipaddress.ip_network(raw, strict=False))
        except ValueError as exc:
            raise CleanIpError(f"Invalid IP range '{raw}': {exc}") from exc

    if not networks:
        raise CleanIpError("No IP ranges were provided.")

    ips: list[str] = []
    total = 0
    remaining = max(1, options.sample_size)

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
        raise CleanIpError(
            "The provided IP ranges contain no usable addresses."
        )

    return ips


async def _probe(
    ip: str,
    sni: str,
    port: int,
    timeout: float,
) -> ScanResult | None:
    """Connect to one candidate IP over TLS and measure latency.

    A successful TLS handshake means the Cloudflare edge accepted the
    SNI on that IP, i.e. the IP is not blocked for this host. Probes
    always run directly over the local connection — routing them through
    a proxy would defeat the purpose of finding locally clean IPs.
    """
    loop = asyncio.get_running_loop()
    started = loop.time()

    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE

    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(
                host=ip,
                port=port,
                ssl=context,
                server_hostname=sni,
            ),
            timeout=timeout,
        )
    except (asyncio.TimeoutError, OSError, ssl.SSLError):
        return None

    elapsed_ms = (loop.time() - started) * 1000.0

    try:
        writer.close()
        await writer.wait_closed()
    except Exception:
        pass

    return ScanResult(
        ip=ip,
        latency_ms=round(elapsed_ms, 1),
        sni=sni,
        port=port,
    )


def _resolve_snis(snis: list[str]) -> list[str]:
    """Validate and normalise the SNI host list."""
    clean: list[str] = []

    for raw in snis:
        raw = (raw or "").strip().lower()

        if not raw:
            continue

        clean.append(raw)

    return clean or [CLEAN_IP_SNI]


class CleanIpChecker:
    """Scan IP ranges and return the reachable ("clean") ones."""

    def __init__(
        self,
        options: ScanOptions | None = None,
    ):
        self.options = options or ScanOptions()

    async def scan(self) -> dict[str, Any]:
        """Run the full scan and return a summary + clean IP list."""
        snis = _resolve_snis(self.options.snis)
        ips = _candidate_ips(self.options)

        semaphore = asyncio.Semaphore(self.options.concurrency)
        results: list[ScanResult] = []
        checked = 0

        async def worker(ip: str) -> None:
            nonlocal checked

            async with semaphore:
                for sni in snis:
                    result = await _probe(
                        ip,
                        sni,
                        self.options.port,
                        self.options.timeout,
                    )

                    if result is not None:
                        results.append(result)
                        break

                checked += 1

        await asyncio.gather(*(worker(ip) for ip in ips))

        results.sort(key=lambda item: item.latency_ms)

        return {
            "scanned": checked,
            "reachable": len(results),
            "sni": snis[0],
            "port": self.options.port,
            "results": [
                {
                    "ip": item.ip,
                    "latency_ms": item.latency_ms,
                    "sni": item.sni,
                    "port": item.port,
                }
                for item in results
            ],
        }
