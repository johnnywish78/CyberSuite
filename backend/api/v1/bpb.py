"""
CloudPilot — BPB Panel API v1.

Deploy and manage a personal BPB Worker Panel on Cloudflare.
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.providers.bpb.provider import (
    BpbPanelError,
    BpbProvider,
    DeployOptions,
)
from backend.providers.cloudflare.client import CloudflareClient
from backend.providers.cloudflare.provider import (
    CloudflareProviderError,
)
from backend.settings import (
    cloudflare_api_token,
    save_cloudflare_credentials,
)

router = APIRouter(
    prefix="/api/v1/cloudflare/bpb",
    tags=["cloudflare-bpb-v1"],
)


class DeployRequest(BaseModel):
    worker_name: str = Field(
        default="cyber-panel",
        min_length=1,
        max_length=64,
        pattern=r"^[a-zA-Z0-9-]+$",
    )
    api_token: str = Field(default="", max_length=256)
    proxy_ip_mode: str = Field(default="proxyip", max_length=32)
    proxy_ips: list[str] = Field(default_factory=list)
    prefixes: list[str] = Field(default_factory=list)
    fallback: str = Field(default="", max_length=255)
    doh_url: str = Field(default="", max_length=255)


def _provider(api_token: str = "") -> BpbProvider:
    token = api_token.strip() or cloudflare_api_token() or ""

    if not token:
        raise HTTPException(
            status_code=503,
            detail="A Cloudflare API token is required.",
        )

    return BpbProvider(CloudflareClient(token))


@router.post("/deploy")
async def bpb_deploy(payload: DeployRequest):
    """
    Deploy the BPB Panel worker and return the personal config.

    The API token may be supplied per request (auto-install from the
    desktop UI) or read from the backend environment.
    """
    provider = _provider(payload.api_token)

    options = DeployOptions(
        proxy_ip_mode=payload.proxy_ip_mode,
        proxy_ips=payload.proxy_ips,
        prefixes=payload.prefixes,
        fallback=payload.fallback,
        doh_url=payload.doh_url,
    )

    try:
        record = await provider.deploy(
            payload.worker_name,
            options=options,
        )
    except BpbPanelError as exc:
        status_code = 503 if exc.step == "configuration" else 502

        raise HTTPException(
            status_code=status_code,
            detail=str(exc),
        ) from exc
    except CloudflareProviderError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc

    if payload.api_token.strip():
        save_cloudflare_credentials(
            record.get("account_id") or "",
            payload.api_token.strip(),
        )

    return {
        "provider": "bpb",
        "deployment": record,
    }


@router.get("/deployments")
async def bpb_deployments():
    """
    Return locally deployed BPB panels.
    """
    provider = _provider()

    try:
        records = await provider.deployments()
    except BpbPanelError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc

    return {
        "provider": "bpb",
        "count": len(records),
        "deployments": records,
    }


@router.get("/deployments/{worker_name}")
async def bpb_deployment(worker_name: str):
    """
    Return one local BPB panel deployment.
    """
    provider = _provider()

    try:
        record = await provider.get(worker_name)
    except BpbPanelError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc

    if not record:
        raise HTTPException(
            status_code=404,
            detail=f"Deployment '{worker_name}' was not found.",
        )

    return {
        "provider": "bpb",
        "deployment": record,
    }


@router.get("/deployments/{worker_name}/logs")
async def bpb_deployment_logs(worker_name: str):
    """
    Capture a short Workers Tail window for a deployed panel and return
    the runtime exceptions and console logs.
    """
    provider = _provider()

    try:
        record = await provider.get(worker_name)
    except BpbPanelError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc

    if not record:
        raise HTTPException(
            status_code=404,
            detail=f"Deployment '{worker_name}' was not found.",
        )

    account_id = record.get("account_id")

    if not account_id:
        raise HTTPException(
            status_code=502,
            detail="Deployment record has no account ID.",
        )

    try:
        result = await provider.tail_logs(account_id, worker_name)
    except BpbPanelError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc

    return {
        "provider": "bpb",
        **result,
    }