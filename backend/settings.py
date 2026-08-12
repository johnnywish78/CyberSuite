import os


def get_env(name: str, default: str | None = None) -> str | None:
    return os.getenv(name, default)


def cloudflare_account_id() -> str | None:
    return get_env("CLOUDFLARE_ACCOUNT_ID")


def cloudflare_api_token() -> str | None:
    return get_env("CLOUDFLARE_API_TOKEN")
