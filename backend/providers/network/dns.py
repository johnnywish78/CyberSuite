"""
CloudPilot — DNS latency tester.

Sends a real DNS query (A record over UDP) to the well-known DNS
providers and reports the response latency. Mirrors the DNS Latency
Test of the mirarr-app/network-checker project.
"""

from __future__ import annotations

import asyncio
import random
import struct
from typing import Any

DNS_SERVERS = [
    {"name": "Cloudflare", "ip": "1.1.1.1", "port": 53},
    {"name": "Google", "ip": "8.8.8.8", "port": 53},
    {"name": "Quad9", "ip": "9.9.9.9", "port": 53},
    {"name": "OpenDNS", "ip": "208.67.222.222", "port": 53},
    {"name": "Shecan", "ip": "178.22.122.100", "port": 53},
    {"name": "403.online", "ip": "10.202.10.202", "port": 53},
    {"name": "Begzar", "ip": "185.55.226.26", "port": 53},
    {"name": "Radar Game", "ip": "10.202.10.10", "port": 53},
]

DNS_QUERY_DOMAIN = "example.com"


class DnsLatencyError(RuntimeError):
    """DNS latency test failed."""


def _encode_dns_query(query_id: int, domain: str) -> bytes:
    """Build a minimal DNS A query packet over UDP."""
    header = struct.pack(">HHHHHH", query_id, 0x0100, 1, 0, 0, 0)

    qname = b"".join(
        bytes([len(label)]) + label.encode()
        for label in domain.split(".")
    ) + b"\x00"

    question = qname + struct.pack(">HH", 1, 1)

    return header + question


def _has_answer(packet: bytes, query_id: int) -> bool:
    """Return True when the response has at least one answer record."""
    if len(packet) < 12:
        return False

    (resp_id, _flags, qd, an, _ns, _ar) = struct.unpack(
        ">HHHHHH", packet[:12]
    )

    if resp_id != query_id:
        return False

    return an > 0


def _parse_a_records(packet: bytes) -> list[str]:
    """Return the IPv4 addresses found in a DNS response."""
    if len(packet) < 12:
        return []

    (resp_id, _flags, qd, an, _ns, _ar) = struct.unpack(
        ">HHHHHH", packet[:12]
    )

    if an == 0:
        return []

    offset = 12

    def skip_name(start: int) -> int:
        pos = start
        while pos < len(packet):
            length = packet[pos]
            if length == 0:
                return pos + 1
            if length & 0xC0 == 0xC0:
                return pos + 2
            pos += 1 + length
        return len(packet)

    for _ in range(qd):
        offset = skip_name(offset) + 4

    ips: list[str] = []

    for _ in range(an):
        if offset + 10 > len(packet):
            break

        offset = skip_name(offset)

        if offset + 10 > len(packet):
            break

        (_atype, _aclass, _ttl, rdlength) = struct.unpack(
            ">HHIH", packet[offset : offset + 10]
        )
        offset += 10

        rdata = packet[offset : offset + rdlength]
        offset += rdlength

        if _atype == 1 and len(rdata) == 4:
            ips.append(".".join(str(b) for b in rdata))

    return ips


class DnsLatencyTester:
    """Measure DNS query latency for the configured providers."""

    def __init__(self, timeout: float = 4.0):
        self.timeout = timeout

    async def test(self, servers: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        targets = servers or list(DNS_SERVERS)

        if not targets:
            raise DnsLatencyError("No DNS servers were provided.")

        results = await asyncio.gather(
            *(self._test_one(server) for server in targets)
        )

        return {
            "tested": len(results),
            "results": sorted(
                results,
                key=lambda item: (
                    item["latency_ms"] is None,
                    item["latency_ms"] or 0,
                ),
            ),
        }

    async def _test_one(self, server: dict[str, Any]) -> dict[str, Any]:
        ip = server["ip"].strip()
        name = (server.get("name") or ip).strip()
        port = int(server.get("port") or 53)

        query_id = random.randint(0, 0xFFFF)
        packet = _encode_dns_query(query_id, DNS_QUERY_DOMAIN)

        loop = asyncio.get_running_loop()
        transport: asyncio.DatagramTransport | None = None
        started = loop.time()
        answer_waiter: asyncio.Future[None] = loop.create_future()

        class Protocol(asyncio.DatagramProtocol):
            def datagram_received(self, data: bytes, addr) -> None:
                if _has_answer(data, query_id) and not answer_waiter.done():
                    answer_waiter.set_result(None)

            def error_received(self, exc) -> None:
                if not answer_waiter.done():
                    answer_waiter.set_exception(exc)

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
            await asyncio.wait_for(answer_waiter, timeout=self.timeout)
        except (asyncio.TimeoutError, OSError):
            return self._failed(name, ip, port, "no answer")
        finally:
            transport.close()

        return {
            "name": name,
            "ip": ip,
            "port": port,
            "latency_ms": round((loop.time() - started) * 1000.0, 1),
            "reachable": True,
            "error": None,
        }

    def _failed(self, name: str, ip: str, port: int, error: str) -> dict[str, Any]:
        return {
            "name": name,
            "ip": ip,
            "port": port,
            "latency_ms": None,
            "reachable": False,
            "error": error,
        }
