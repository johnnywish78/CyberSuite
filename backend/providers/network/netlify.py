"""
CloudPilot — Netlify Config Generator.

Generates multiple netlify.toml configs from multiple SNIs and IPs.
Each config rewrites a Netlify site so that it serves the target SNI,
tunneling through the IP. Mirrors the Netlify Config Generator feature
of the mirarr-app/network-checker project.
"""

from __future__ import annotations

import ipaddress
from typing import Any

from backend.providers.network._probe import hostname_is_valid


class NetlifyError(RuntimeError):
    """Netlify config generation failed."""


def _validate_sni(sni: str) -> str:
    sni = (sni or "").strip().lower()

    if not sni:
        raise NetlifyError("No SNI hosts were provided.")

    if not hostname_is_valid(sni):
        raise NetlifyError(f"Invalid SNI host '{sni}'.")

    return sni


def _validate_ip(raw: str) -> str:
    raw = (raw or "").strip()

    try:
        addr = ipaddress.ip_address(raw)
    except ValueError as exc:
        raise NetlifyError(f"Invalid IP '{raw}': {exc}") from exc

    if addr.version == 6 and not raw.startswith("["):
        return f"[{raw}]"

    return raw


def _toml_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def generate_netlify_configs(
    snis: list[str],
    ips: list[str],
) -> list[dict[str, Any]]:
    """Generate one netlify.toml per (SNI, IP) pair."""
    clean_snis = [_validate_sni(sni) for sni in snis]
    clean_ips = [_validate_ip(ip) for ip in ips]

    if not clean_snis or not clean_ips:
        raise NetlifyError("Both SNIs and IPs are required.")

    configs: list[dict[str, Any]] = []

    for sni in clean_snis:
        for ip in clean_ips:
            configs.append(
                {
                    "sni": sni,
                    "ip": ip,
                    "content": _render_toml(sni, ip),
                }
            )

    return configs


def _render_toml(sni: str, ip: str) -> str:
    return f"""# Netlify redirect for SNI spoofing
# SNI: {sni} | IP: {ip}

[build]
  command = "exit 0"
  publish = "public"

[[redirects]]
  from = "/*"
  to = "https://{_toml_escape(sni)}"
  status = 200
  force = false

[[headers]]
  for = "/*"
  [headers.values]
    Host = "{_toml_escape(sni)}"
    X-Forwarded-For = "{_toml_escape(ip)}"
    X-Forwarded-Host = "{_toml_escape(sni)}"
    X-Forwarded-Proto = "https"
"""
