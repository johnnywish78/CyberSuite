"""
CloudPilot — Domain accessibility checker.

Probes whether a set of domains is reachable over TLS (443) from the
local internet connection. Mirrors the Domain Checker feature of the
mirarr-app/network-checker project.
"""

from __future__ import annotations

import asyncio
from typing import Any

from backend.providers.network._probe import hostname_is_valid, tls_probe

DEFAULT_DOMAINS = [
    "google.com",
    "youtube.com",
    "instagram.com",
    "x.com",
    "telegram.org",
    "chatgpt.com",
    "github.com",
    "cloudflare.com",
    "discord.com",
    "reddit.com",
    "netflix.com",
    "spotify.com",
]


class DomainCheckerError(RuntimeError):
    """Domain check failed."""


class DomainChecker:
    """Check reachability of a list of domains from the local network."""

    def __init__(self, timeout: float = 4.0):
        self.timeout = timeout

    async def check(self, domains: list[str]) -> dict[str, Any]:
        clean = [d.strip().lower() for d in domains if d.strip()]

        if not clean:
            clean = list(DEFAULT_DOMAINS)

        invalid = [d for d in clean if not hostname_is_valid(d)]

        if invalid:
            raise DomainCheckerError(
                f"Invalid hostnames: {', '.join(invalid)}"
            )

        results = await asyncio.gather(
            *(self._check_one(domain) for domain in clean)
        )

        reachable = [r for r in results if r["reachable"]]

        return {
            "checked": len(results),
            "reachable": len(reachable),
            "blocked": len(results) - len(reachable),
            "results": sorted(
                results,
                key=lambda item: (not item["reachable"], item["latency_ms"]),
            ),
        }

    async def _check_one(self, domain: str) -> dict[str, Any]:
        latency = await tls_probe(domain, 443, timeout=self.timeout)

        return {
            "domain": domain,
            "reachable": latency is not None,
            "latency_ms": latency if latency is not None else None,
            "port": 443,
        }
