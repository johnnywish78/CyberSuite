"""
CloudPilot — Avaco Railway Relay service layer.

Owns Railway orchestration and result normalization. Routers parse and
validate HTTP input, translate provider errors to status codes, and
handle credential persistence side effects; the provider is injected by
the router so tests can substitute a fake provider.
"""

from backend.providers.railway.provider import (
    RailwayProvider,
    RelayOptions,
)
from backend.settings import railway_config_state


def get_config() -> dict:
    """Railway configuration state (secrets are never exposed)."""
    return railway_config_state()


async def get_status(provider: RailwayProvider) -> dict:
    """Verify the Railway API token and return the account identity."""
    me = await provider.whoami()
    return {"provider": "railway", "authenticated": True, "account": me}


async def get_regions(provider: RailwayProvider) -> dict:
    """Return the available Railway deployment regions."""
    regions = await provider.regions()
    return {"provider": "railway", "count": len(regions), "regions": regions}


async def deploy(
    provider: RailwayProvider,
    relay_name: str,
    options: RelayOptions,
    api_token: str = "",
) -> dict:
    """Create or update a relay and return its record."""
    record = await provider.deploy(relay_name, options, api_token=api_token)
    return {"provider": "railway", "deployment": record}


async def list_deployments(provider: RailwayProvider) -> dict:
    """Return locally deployed relays."""
    records = await provider.deployments()
    return {"provider": "railway", "count": len(records), "deployments": records}


async def get_deployment(provider: RailwayProvider, relay_name: str) -> dict:
    """Return one relay deployment record (or None)."""
    record = await provider.get(relay_name)
    return {"provider": "railway", "deployment": record}


async def redeploy(provider: RailwayProvider, relay_name: str) -> dict:
    """Trigger a redeploy of the latest code for a relay."""
    record = await provider.refresh_deployment(relay_name)
    return {"provider": "railway", "deployment": record}


async def debug(provider: RailwayProvider, relay_name: str) -> dict:
    """Query the /__debug endpoint of a deployed relay."""
    result = await provider.debug_status(relay_name)
    return {"provider": "railway", **result}


async def delete(provider: RailwayProvider, relay_name: str) -> dict:
    """Delete a relay's Railway service and its local record."""
    removed = await provider.delete(relay_name)
    return {
        "provider": "railway",
        "deleted": True,
        "relay_name": relay_name,
        "removed": removed,
    }