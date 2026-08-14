"""
CloudPilot — BPB Panel service layer.

Owns BPB orchestration and result normalization. Routers parse and
validate HTTP input, translate provider errors to status codes, and
handle credential persistence side effects; the provider is injected by
the router so tests can substitute a fake provider.
"""

from backend.providers.bpb.provider import (
    BpbProvider,
    DeployOptions,
)


async def deploy(
    provider: BpbProvider,
    worker_name: str,
    options: DeployOptions,
) -> dict:
    """Deploy the BPB Panel worker and return its record."""
    record = await provider.deploy(
        worker_name,
        options=options,
    )
    return {"provider": "bpb", "deployment": record}


async def list_deployments(provider: BpbProvider) -> dict:
    """Return locally deployed BPB panels."""
    records = await provider.deployments()
    return {"provider": "bpb", "count": len(records), "deployments": records}


async def get_deployment(provider: BpbProvider, worker_name: str) -> dict:
    """Return one local BPB panel deployment record (or None)."""
    record = await provider.get(worker_name)
    return {"provider": "bpb", "deployment": record}


async def get_record(provider: BpbProvider, worker_name: str) -> dict | None:
    """Return a deployment record (or None) for log capture."""
    return await provider.get(worker_name)


async def tail_logs(
    provider: BpbProvider, account_id: str, worker_name: str
) -> dict:
    """Capture a short Workers Tail window for a deployed panel."""
    result = await provider.tail_logs(account_id, worker_name)
    return {"provider": "bpb", **result}