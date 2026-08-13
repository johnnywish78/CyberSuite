"""
CloudPilot — shared helpers for the network tools.
"""

from __future__ import annotations

import asyncio
import socket
import ssl


async def tcp_probe(
    host: str,
    port: int,
    *,
    timeout: float = 4.0,
) -> float | None:
    """Return the TCP connect latency in ms, or None on failure."""
    loop = asyncio.get_running_loop()
    started = loop.time()

    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host=host, port=port),
            timeout=timeout,
        )
    except (asyncio.TimeoutError, OSError):
        return None

    elapsed_ms = (loop.time() - started) * 1000.0

    try:
        writer.close()
        await writer.wait_closed()
    except Exception:
        pass

    return round(elapsed_ms, 1)


async def tls_probe(
    host: str,
    port: int,
    *,
    sni: str | None = None,
    timeout: float = 4.0,
) -> float | None:
    """Return the TLS handshake latency in ms, or None on failure.

    Uses the provided SNI. This is what determines whether a domain is
    reachable from the local network.
    """
    loop = asyncio.get_running_loop()
    started = loop.time()

    context = ssl.create_default_context()

    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(
                host=host,
                port=port,
                ssl=context,
                server_hostname=sni or host,
            ),
            timeout=timeout,
        )
    except (asyncio.TimeoutError, OSError, ssl.SSLError, UnicodeError):
        return None

    elapsed_ms = (loop.time() - started) * 1000.0

    try:
        writer.close()
        await writer.wait_closed()
    except Exception:
        pass

    return round(elapsed_ms, 1)


def hostname_is_valid(host: str) -> bool:
    """Light sanity check for a hostname."""
    if not host or len(host) > 253 or "." not in host:
        return False

    labels = host.split(".")

    return all(
        label and len(label) <= 63 and label[0] != "-" and label[-1] != "-"
        for label in labels
    )
