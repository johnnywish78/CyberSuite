"""
CloudPilot configuration loader.
"""

import os
from pathlib import Path

from dotenv import load_dotenv, set_key


ROOT_DIR = Path(__file__).resolve().parent.parent

load_dotenv(ROOT_DIR / ".env")


def get_env(name: str, default: str | None = None) -> str | None:
    return os.getenv(name, default)


def cloudflare_account_id() -> str | None:
    return get_env("CLOUDFLARE_ACCOUNT_ID")


def cloudflare_api_token() -> str | None:
    return get_env("CLOUDFLARE_API_TOKEN")


def save_cloudflare_credentials(
    account_id: str,
    api_token: str,
) -> None:
    """Persist Cloudflare credentials into the local .env file.

    Also updates the running process environment so new credentials
    apply immediately without a backend restart.
    """
    env_path = ROOT_DIR / ".env"

    set_key(str(env_path), "CLOUDFLARE_ACCOUNT_ID", account_id)
    set_key(str(env_path), "CLOUDFLARE_API_TOKEN", api_token)

    os.environ["CLOUDFLARE_ACCOUNT_ID"] = account_id
    os.environ["CLOUDFLARE_API_TOKEN"] = api_token


def cloudflare_proxy() -> str | None:
    """Return the configured outbound proxy.

    `CLOUDFLARE_PROXY` (persisted in .env / settings) wins, then the
    process environment HTTP(S)_PROXY variables are used as fallback.
    This keeps the desktop app working even when it is launched from a
    GUI where shell proxy variables are not exported.
    """
    return (
        get_env("CLOUDFLARE_PROXY")
        or get_env("HTTPS_PROXY")
        or get_env("https_proxy")
        or get_env("HTTP_PROXY")
        or get_env("http_proxy")
    )


def cloudflare_proxies() -> dict[str, str]:
    """Return a requests-compatible proxies dict, or {} when none."""
    proxy = cloudflare_proxy()

    if not proxy:
        return {}

    return {"http": proxy, "https": proxy}


def save_cloudflare_proxy(proxy: str) -> None:
    """Persist the outbound proxy into the local .env file."""
    env_path = ROOT_DIR / ".env"

    set_key(str(env_path), "CLOUDFLARE_PROXY", proxy)

    os.environ["CLOUDFLARE_PROXY"] = proxy


def railway_api_token() -> str | None:
    """Return the Railway account token, if configured."""
    return get_env("RAILWAY_API_TOKEN")


def save_railway_credentials(api_token: str) -> None:
    """Persist the Railway account token into the local .env file.

    Also updates the running process environment so the new token
    applies immediately without a backend restart.
    """
    env_path = ROOT_DIR / ".env"

    set_key(str(env_path), "RAILWAY_API_TOKEN", api_token)

    os.environ["RAILWAY_API_TOKEN"] = api_token
