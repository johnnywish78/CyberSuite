"""
CloudPilot — Cloudflare API v1.

Thin HTTP adapters over the Cloudflare service layer: parsing,
validation, provider wiring, error-to-status translation and credential
persistence side effects live here; orchestration and result
normalization live in `backend.services.cloudflare_service`.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.providers.cloudflare.provider import (
    CloudflareProvider,
    CloudflareProviderError,
)
from backend.services import cloudflare_service
from backend.settings import (
    save_cloudflare_credentials,
    save_cloudflare_proxy,
)

router = APIRouter(
    prefix="/api/v1/cloudflare",
    tags=["cloudflare-v1"],
)


class CredentialsRequest(BaseModel):
    account_id: str = Field(min_length=1, max_length=64)
    api_token: str = Field(min_length=1, max_length=256)


class ProxyRequest(BaseModel):
    proxy: str = Field(default="", max_length=512)


def _provider() -> CloudflareProvider:
    try:
        return CloudflareProvider.from_environment()
    except CloudflareProviderError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc


@router.get("/config")
async def cloudflare_config():
    """
    Return Cloudflare configuration state.

    Secrets are never returned.
    """
    return cloudflare_service.get_config()


@router.post("/config")
async def cloudflare_config_save(payload: CredentialsRequest):
    """
    Persist Cloudflare credentials from the desktop UI.

    Credentials are written to the local .env and never echoed back.
    """
    save_cloudflare_credentials(
        payload.account_id.strip(),
        payload.api_token.strip(),
    )

    return {
        "provider": "cloudflare",
        "configured": True,
    }


@router.post("/config/proxy")
async def cloudflare_proxy_save(payload: ProxyRequest):
    """
    Persist the outbound proxy used for Cloudflare API requests.

    Empty string clears the explicit proxy and falls back to the
    process environment HTTP(S)_PROXY variables.
    """
    save_cloudflare_proxy(payload.proxy.strip())

    return {
        "provider": "cloudflare",
        "proxy_configured": bool(cloudflare_service.get_config()["proxy_configured"]),
    }


@router.get("/status")
async def cloudflare_status():
    """
    Verify Cloudflare credentials and return account status.
    """
    provider = _provider()

    try:
        return await cloudflare_service.get_status(provider)
    except CloudflareProviderError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Cloudflare status check failed: {exc}",
        ) from exc


@router.get("/workers")
async def cloudflare_workers():
    """
    Return Workers belonging to the configured account.
    """
    provider = _provider()

    try:
        return await cloudflare_service.list_workers(provider)
    except CloudflareProviderError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Cloudflare Worker discovery failed: {exc}",
        ) from exc


@router.get("/workers/{worker_name}")
async def cloudflare_worker(worker_name: str):
    """
    Return one Worker together with its deployment history.
    """
    provider = _provider()

    try:
        worker = await cloudflare_service.get_worker(provider, worker_name)
    except CloudflareProviderError as exc:
        status_code = 404 if exc.code == "not_found" else 502

        raise HTTPException(
            status_code=status_code,
            detail=f"Cloudflare Worker lookup failed: {exc}",
        ) from exc

    try:
        deployments = await cloudflare_service.list_deployments(
            provider, worker_name
        )
    except CloudflareProviderError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Cloudflare deployment discovery failed: {exc}",
        ) from exc

    return {
        "provider": "cloudflare",
        "worker": worker["worker"],
        "deployments": deployments["deployments"],
    }


@router.get("/workers/{worker_name}/deployments")
async def cloudflare_worker_deployments(worker_name: str):
    """
    Return real Cloudflare deployment history.
    """
    provider = _provider()

    try:
        return await cloudflare_service.list_deployments(provider, worker_name)
    except CloudflareProviderError as exc:
        status_code = 404 if exc.code == "not_found" else 502

        raise HTTPException(
            status_code=status_code,
            detail=f"Cloudflare deployment discovery failed: {exc}",
        ) from exc
