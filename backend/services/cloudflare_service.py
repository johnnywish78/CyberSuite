"""
CloudPilot — Cloudflare service layer.

Owns Cloudflare orchestration and result normalization. Routers parse
and validate HTTP input, translate provider errors to status codes, and
handle credential persistence side effects; the provider is injected by
the router so tests can substitute a fake provider.
"""

from backend.providers.cloudflare.provider import (
    CloudflareProvider,
    CloudflareProviderError,
)
from backend.settings import cloudflare_config_state


def get_config() -> dict:
    """Cloudflare configuration state (secrets are never exposed)."""
    return cloudflare_config_state()


async def get_status(provider: CloudflareProvider) -> dict:
    """Verify credentials and return account status."""
    result = await provider.status()
    return {"provider": "cloudflare", **result}


async def list_workers(provider: CloudflareProvider) -> dict:
    """List Workers belonging to the configured account."""
    workers = await provider.list_workers()
    return {
        "provider": "cloudflare",
        "account_id": provider.account_id,
        "count": len(workers),
        "workers": workers,
    }


async def get_worker(provider: CloudflareProvider, worker_name: str) -> dict:
    """Return one Worker's metadata."""
    worker = await provider.get_worker(worker_name)
    return {"provider": "cloudflare", "worker": worker}


async def list_deployments(
    provider: CloudflareProvider, worker_name: str
) -> dict:
    """Return real Cloudflare deployment history for a Worker."""
    deployments = await provider.list_deployments(worker_name)
    return {
        "provider": "cloudflare",
        "worker_name": worker_name,
        "count": len(deployments),
        "deployments": deployments,
    }