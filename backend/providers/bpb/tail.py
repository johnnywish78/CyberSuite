"""
CloudPilot — Workers Tail log capture.

Connects to the Cloudflare Workers Tail WebSocket for the deployed
worker and collects the events (requests, exceptions, console logs)
so runtime errors can be surfaced in the desktop UI.

The connection mirrors what `wrangler tail` does: the WebSocket must
negotiate the `trace-v1` subprotocol and then send a filter message
`{"debug": false}` once the socket is open.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from websockets.asyncio.client import connect

from backend.providers.cloudflare.client import CloudflareAPIError
from backend.settings import cloudflare_proxy

TRACE_VERSION = "trace-v1"


class TailError(RuntimeError):
    """Failed to capture a Workers Tail."""


def _flatten_event(data: dict[str, Any]) -> dict[str, Any] | None:
    """Turn one TailEventMessage into a small human-readable record."""
    event = data.get("event") or {}

    if not isinstance(event, dict):
        return None

    request = event.get("request") or {}

    logs = []
    for item in data.get("logs") or []:
        logs.append(
            {
                "level": item.get("level") or "log",
                "message": " ".join(
                    str(part) for part in (item.get("message") or [])
                ),
            }
        )

    exceptions = []
    for item in data.get("exceptions") or []:
        message = item.get("message")

        if not isinstance(message, str):
            message = json.dumps(message, ensure_ascii=False)

        exceptions.append(
            {
                "name": item.get("name") or "Error",
                "message": message,
                "stack": item.get("stack") or "",
            }
        )

    return {
        "outcome": data.get("outcome"),
        "request_url": request.get("url"),
        "request_method": request.get("method"),
        "timestamp": data.get("eventTimestamp"),
        "logs": logs,
        "exceptions": exceptions,
    }


async def capture_tail(
    client: Any,
    account_id: str,
    worker_name: str,
    *,
    duration: float = 8.0,
    max_events: int = 80,
) -> list[dict[str, Any]]:
    """Create a Tail, listen for a short window and return the events."""
    try:
        payload = await asyncio.to_thread(
            client.create_tail,
            account_id,
            worker_name,
        )
    except CloudflareAPIError as exc:
        raise TailError(f"Failed to create a Workers Tail: {exc}") from exc

    result = payload.get("result") or {}
    ws_url = result.get("url")

    if not ws_url:
        raise TailError(
            "Cloudflare did not return a Tail WebSocket URL. "
            "The API token may lack Workers Logs permission."
        )

    proxy = cloudflare_proxy()
    events: list[dict[str, Any]] = []

    # The filtered network intermittently MITMs the TLS handshake to the
    # tail host, so retry the WebSocket connection a few times.
    last_error: Exception | None = None

    for attempt in range(4):
        try:
            await _stream_tail(
                ws_url,
                proxy,
                events,
                duration=duration,
                max_events=max_events,
            )
            return events
        except Exception as exc:
            last_error = exc
            events.clear()
            await asyncio.sleep(0.6 * (attempt + 1))

    assert last_error is not None
    raise TailError(f"Tail connection failed: {last_error}") from last_error


async def _stream_tail(
    ws_url: str,
    proxy: str | None,
    events: list[dict[str, Any]],
    *,
    duration: float,
    max_events: int,
) -> None:
    async with connect(
        ws_url,
        subprotocols=[TRACE_VERSION],
        proxy=proxy,
        open_timeout=10,
        max_size=2**20,
    ) as ws:
        await ws.send(json.dumps({"debug": False}))

        deadline = time.monotonic() + duration

        while time.monotonic() < deadline and len(events) < max_events:
            remaining = deadline - time.monotonic()

            if remaining <= 0:
                break

            try:
                raw = await asyncio.wait_for(
                    ws.recv(),
                    timeout=remaining,
                )
            except asyncio.TimeoutError:
                break

            if not isinstance(raw, str):
                continue

            try:
                data = json.loads(raw)
            except ValueError:
                continue

            if not isinstance(data, dict):
                continue

            flattened = _flatten_event(data)

            if flattened is not None:
                events.append(flattened)
