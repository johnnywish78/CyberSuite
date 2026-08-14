"""
CloudPilot configuration loader.

This module is the single owner of application configuration for the
backend. Environment variables (loaded from `.env` via python-dotenv)
are the source of truth; every other backend module reads settings
through here instead of touching the environment directly.
"""

import os
from pathlib import Path

from dotenv import load_dotenv, set_key


ROOT_DIR = Path(__file__).resolve().parent.parent

load_dotenv(ROOT_DIR / ".env")


def get_env(name: str, default: str | None = None) -> str | None:
    return os.getenv(name, default)


def service_version() -> str:
    """Application version reported by FastAPI and the health endpoint."""
    return get_env("CLOUDPILOT_VERSION", "0.1.0")


def backend_host() -> str:
    """Local backend bind host.

    The Electron shell reads the same `CLOUDPILOT_BACKEND_HOST`
    environment variable; this default must stay in sync.
    """
    return get_env("CLOUDPILOT_BACKEND_HOST", "127.0.0.1")


def backend_port() -> int:
    """Local backend bind port.

    The Electron shell reads the same `CLOUDPILOT_BACKEND_PORT`
    environment variable; this default must stay in sync.
    """
    raw = get_env("CLOUDPILOT_BACKEND_PORT", "8765")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 8765


def cors_origins() -> list[str]:
    """Allowed CORS origins.

    The desktop renderer is served from `file://` and talks to the local
    backend, so the historical default is the permissive `["*"]`. It can
    be narrowed with `CLOUDPILOT_CORS_ORIGINS` (comma separated).
    """
    raw = get_env("CLOUDPILOT_CORS_ORIGINS", "*")
    if not raw or raw.strip() == "*":
        return ["*"]
    return [item.strip() for item in raw.split(",") if item.strip()]


def cloudflare_account_id() -> str | None:
    return get_env("CLOUDFLARE_ACCOUNT_ID")


def cloudflare_api_token() -> str | None:
    return get_env("CLOUDFLARE_API_TOKEN")


def cloudflare_config_state() -> dict[str, bool | str]:
    """Cloudflare configuration state without ever exposing secrets."""
    account_id = get_env("CLOUDFLARE_ACCOUNT_ID") or get_env("CF_ACCOUNT_ID")
    api_token = get_env("CLOUDFLARE_API_TOKEN") or get_env("CF_API_TOKEN")

    return {
        "provider": "cloudflare",
        "configured": bool(account_id and api_token),
        "account_id_configured": bool(account_id),
        "api_token_configured": bool(api_token),
        "proxy_configured": bool(cloudflare_proxy()),
    }


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


def railway_config_state() -> dict[str, bool | str]:
    """Railway configuration state without ever exposing secrets."""
    return {
        "provider": "railway",
        "configured": bool(railway_api_token()),
        "api_token_configured": bool(railway_api_token()),
    }


def save_railway_credentials(api_token: str) -> None:
    """Persist the Railway account token into the local .env file.

    Also updates the running process environment so the new token
    applies immediately without a backend restart.
    """
    env_path = ROOT_DIR / ".env"

    set_key(str(env_path), "RAILWAY_API_TOKEN", api_token)

    os.environ["RAILWAY_API_TOKEN"] = api_token
