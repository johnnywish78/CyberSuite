"""
CloudPilot — DNS Hunter.

Asks Iranian DNS providers how they resolve a specific domain and
reports the IPs each one returns. Mirrors the DNS Hunter feature of the
mirarr-app/network-checker project.
"""

from __future__ import annotations

import asyncio
import random
from typing import Any

from backend.providers.network.dns import _encode_dns_query, _parse_a_records

IRANIAN_DNS_SERVERS = [
    {"name": "Shecan", "ip": "178.22.122.100", "port": 53},
    {"name": "Shecan 2", "ip": "185.51.200.2", "port": 53},
    {"name": "403.online", "ip": "10.202.10.202", "port": 53},
    {"name": "403.online 2", "ip": "10.202.10.11", "port": 53},
    {"name": "Radar Game", "ip": "10.202.10.10", "port": 53},
    {"name": "Begzar", "ip": "185.55.226.26", "port": 53},
    {"name": "Begzar 2", "ip": "185.55.225.25", "port": 53},
    {"name": "Electro", "ip": "78.157.42.100", "port": 53},
    {"name": "Electro 2", "ip": "78.157.42.101", "port": 53},
    {"name": "Hamrahe Aval", "ip": "172.29.0.100", "port": 53},
]

DEFAULT_HUNT_DOMAIN = "google.com"


class DnsHunterError(RuntimeError):
    """DNS hunt failed."""


class DnsHunter:
    """Query Iranian DNS providers for a domain and report the answers."""

    def __init__(self, timeout: float = 4.0):
        self.timeout = timeout

    async def hunt(
        self,
        domains: list[str] | None = None,
    ) -> dict[str, Any]:
        clean = [d.strip().lower() for d in (domains or []) if d.strip()]

        if not clean:
            clean = [DEFAULT_HUNT_DOMAIN]

        domain = clean[0]

        results = await asyncio.gather(
            *(self._query_one(server, domain) for server in IRANIAN_DNS_SERVERS)
        )

        return {
            "domain": domain,
            "checked": len(results),
            "results": sorted(
                results,
                key=lambda item: (
                    item["latency_ms"] is None,
                    item["latency_ms"] or 0,
                ),
            ),
        }

    async def _query_one(
        self,
        server: dict[str, Any],
        domain: str,
    ) -> dict[str, Any]:
        ip = server["ip"].strip()
        name = (server.get("name") or ip).strip()
        port = int(server.get("port") or 53)

        query_id = random.randint(0, 0xFFFF)
        packet = _encode_dns_query(query_id, domain)

        loop = asyncio.get_running_loop()
        transport: asyncio.DatagramTransport | None = None
        started = loop.time()
        answer: asyncio.Future[bytes | None] = loop.create_future()

        class Protocol(asyncio.DatagramProtocol):
            def datagram_received(self, data: bytes, addr) -> None:
                if not answer.done():
                    answer.set_result(data)

            def error_received(self, exc) -> None:
                if not answer.done():
                    answer.set_exception(exc)

        try:
            transport, _protocol = await asyncio.wait_for(
                loop.create_datagram_endpoint(
                    Protocol,
                    remote_addr=(ip, port),
                ),
                timeout=self.timeout,
            )
        except (asyncio.TimeoutError, OSError) as exc:
            return self._failed(name, ip, port, str(exc))

        try:
            transport.sendto(packet)
            data = await asyncio.wait_for(answer, timeout=self.timeout)
        except (asyncio.TimeoutError, OSError) as exc:
            return self._failed(name, ip, port, "no answer")
        finally:
            transport.close()

        latency_ms = round((loop.time() - started) * 1000.0, 1)

        if data is None:
            return self._failed(name, ip, port, "no answer")

        resolved = _parse_a_records(data)

        if not resolved:
            return self._failed(name, ip, port, "no A records")

        return {
            "name": name,
            "ip": ip,
            "port": port,
            "latency_ms": latency_ms,
            "reachable": True,
            "resolved": resolved,
            "error": None,
        }

    def _failed(
        self,
        name: str,
        ip: str,
        port: int,
        error: str,
    ) -> dict[str, Any]:
        return {
            "name": name,
            "ip": ip,
            "port": port,
            "latency_ms": None,
            "reachable": False,
            "resolved": [],
            "error": error,
        }
