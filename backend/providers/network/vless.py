"""
CloudPilot — Vless config modifier.

Takes one or more VLESS config URIs and replaces the target address with
each clean IP from a supplied list, producing all resulting configs.
Mirrors the Vless Config Modifier of the mirarr-app/network-checker
project.
"""

from __future__ import annotations

import ipaddress
import re
from typing import Any

_VLESS_RE = re.compile(r"^vless://([^@]+)@([^:?/]+):(\d+)(\?[^#]*)?(#[^#]*)?$")


class VlessModifierError(RuntimeError):
    """VLESS config modification failed."""


def parse_clean_ips(items: list[str]) -> list[str]:
    """Return only valid IP literals (IPv4/IPv6) from the input lines."""
    clean: list[str] = []

    for raw in items:
        raw = (raw or "").strip()

        if not raw:
            continue

        for part in re.split(r"[\s,;]+", raw):
            part = part.strip()

            try:
                addr = ipaddress.ip_address(part)
            except ValueError:
                continue

            if addr.version == 6 and not part.startswith("["):
                part = f"[{part}]"

            if part not in clean:
                clean.append(part)

    return clean


def _normalize(query: str) -> str:
    if query and not query.startswith("?"):
        return f"?{query}"
    return query or ""


def modify_vless(
    configs: list[str],
    clean_ips: list[str],
) -> list[dict[str, Any]]:
    """Return a modified config for every (config, clean IP) pair."""
    valid_configs = [c.strip() for c in configs if c and c.strip().startswith("vless://")]

    if not valid_configs:
        raise VlessModifierError("No valid vless:// configs were provided.")

    if not clean_ips:
        raise VlessModifierError("No clean IPs were provided.")

    outputs: list[dict[str, Any]] = []

    for config in valid_configs:
        match = _VLESS_RE.match(config)

        if not match:
            outputs.append(
                {
                    "input": config,
                    "valid": False,
                    "error": "Malformed vless:// URI.",
                    "outputs": [],
                }
            )
            continue

        userinfo, _old_host, _port, query, fragment = match.groups()

        query = _normalize(query)
        fragment = fragment or ""

        base = f"vless://{userinfo}@"

        entries: list[str] = []

        for ip in clean_ips:
            entries.append(
                f"{base}{ip}:{_port}{query}{fragment}"
            )

        outputs.append(
            {
                "input": config,
                "valid": True,
                "error": None,
                "count": len(entries),
                "outputs": entries,
            }
        )

    return outputs
