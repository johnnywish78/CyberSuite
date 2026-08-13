"""
CloudPilot — Internet Diagnostics.

A battery of automated checks over the local connection: DNS lookup,
TCP connect, TLS handshake and an HTTPS request. Mirrors the
Diagnostics feature of the mirarr-app/network-checker project.
"""

from __future__ import annotations

import asyncio
import socket
import ssl
import time
from typing import Any

from backend.providers.network._probe import hostname_is_valid, tcp_probe, tls_probe
from backend.providers.network.dns import DnsLatencyTester

DEFAULT_TARGET = "google.com"
DEFAULT_TARGETS = [
    "google.com",
    "github.com",
    "cloudflare.com",
    "telegram.org",
]


class DiagnosticsError(RuntimeError):
    """Diagnostics run failed."""


class Diagnostics:
    """Run a set of automated network tests."""

    def __init__(self, timeout: float = 5.0):
        self.timeout = timeout

    async def run(
        self,
        targets: list[str] | None = None,
    ) -> dict[str, Any]:
        clean = [t.strip().lower() for t in (targets or []) if t.strip()]

        if not clean:
            clean = list(DEFAULT_TARGETS)

        invalid = [t for t in clean if not hostname_is_valid(t)]

        if invalid:
            raise DiagnosticsError(f"Invalid hostnames: {', '.join(invalid)}")

        started = time.time()

        dns_test = await DnsLatencyTester(timeout=self.timeout).test()

        site_results = await asyncio.gather(
            *(self._check_site(target) for target in clean)
        )

        return {
            "duration_ms": round((time.time() - started) * 1000.0, 1),
            "targets": clean,
            "dns": dns_test,
            "sites": site_results,
        }

    async def _check_site(self, target: str) -> dict[str, Any]:
        tcp = await tcp_probe(target, 443, timeout=self.timeout)
        tls = await tls_probe(target, 443, timeout=self.timeout)

        try:
            infos = await asyncio.get_running_loop().getaddrinfo(
                target,
                443,
                proto=socket.IPPROTO_TCP,
            )
            resolved = list(
                dict.fromkeys(info[4][0] for info in infos)
            )[:5]
        except OSError:
            resolved = []

        return {
            "domain": target,
            "port": 443,
            "tcp": tcp,
            "tls": tls,
            "resolved": resolved,
            "reachable": tls is not None,
        }
