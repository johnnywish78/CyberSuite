"""
CloudPilot — BPB Panel URL builders.

Panel and subscription link formats mirror what the deployed
BPB worker serves (`/<securePath>/panel`, `/<securePath>/sub/...`).
"""

from __future__ import annotations

from urllib.parse import quote

SUBSCRIPTION_TYPES: dict[str, list[str]] = {
    "normal": ["xray", "sing-box", "clash"],
    "raw": ["xray", "sing-box"],
    "fragment": ["xray", "sing-box"],
    "warp": ["xray", "sing-box", "wireguard", "clash"],
    "warp-pro": ["xray", "xray-knocker", "clash", "amnezia"],
}


def panel_url(host: str, secure_path: str) -> str:
    return f"https://{host}/{quote(secure_path)}/panel"


def login_url(host: str, secure_path: str) -> str:
    return f"https://{host}/{quote(secure_path)}/login"


def subscription_url(
    host: str,
    secure_path: str,
    sub_type: str,
    app: str,
) -> str:
    return (
        f"https://{host}/{quote(secure_path)}/sub/{sub_type}"
        f"?app={quote(app)}"
    )


def build_subscriptions(
    host: str,
    secure_path: str,
) -> dict[str, dict[str, str]]:
    return {
        sub_type: {
            app: subscription_url(host, secure_path, sub_type, app)
            for app in apps
        }
        for sub_type, apps in SUBSCRIPTION_TYPES.items()
    }