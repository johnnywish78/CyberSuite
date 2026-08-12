"""
CloudPilot — Cloudflare API v1.

Read-only control-plane endpoints for the desktop application.
"""

from fastapi import APIRouter, HTTPException

from backend.providers.cloudflare.provider import (
    CloudflareProvider,
    CloudflareProviderError,
)

router = APIRouter(
    prefix="/api/v1/cloudflare",
    tags=["cloudflare-v1"],
)


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
    import os

    account_id = (
        os.getenv("CLOUDFLARE_ACCOUNT_ID")
        or os.getenv("CF_ACCOUNT_ID")
    )

    api_token = (
        os.getenv("CLOUDFLARE_API_TOKEN")
        or os.getenv("CF_API_TOKEN")
    )

    return {
        "provider": "cloudflare",
        "configured": bool(account_id and api_token),
        "account_id_configured": bool(account_id),
        "api_token_configured": bool(api_token),
    }


@router.get("/status")
async def cloudflare_status():
    """
    Verify Cloudflare credentials and return account status.
    """
    provider = _provider()

    try:
        return {
            "provider": "cloudflare",
            **await provider.status(),
        }
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
        workers = await provider.list_workers()
    except CloudflareProviderError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Cloudflare Worker discovery failed: {exc}",
        ) from exc

    return {
        "provider": "cloudflare",
        "account_id": provider.account_id,
        "count": len(workers),
        "workers": workers,
    }


@router.get("/workers/{worker_name}")
async def cloudflare_worker(worker_name: str):
    """
    Return one Worker.
    """
    provider = _provider()

    try:
        worker = await provider.get_worker(worker_name)
    except CloudflareProviderError as exc:
        status_code = 404 if exc.code == "not_found" else 502

        raise HTTPException(
            status_code=status_code,
            detail=f"Cloudflare Worker lookup failed: {exc}",
        ) from exc

    try:
        deployments = await provider.list_deployments(worker_name)
    except CloudflareProviderError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Cloudflare deployment discovery failed: {exc}",
        ) from exc

    return {
        "provider": "cloudflare",
        "worker": worker,
        "deployments": deployments,
    }


@router.get("/workers/{worker_name}/deployments")
async def cloudflare_worker_deployments(worker_name: str):
    """
    Return real Cloudflare deployment history.
    """
    provider = _provider()

    try:
        deployments = await provider.list_deployments(worker_name)
    except CloudflareProviderError as exc:
        status_code = 404 if exc.code == "not_found" else 502

        raise HTTPException(
            status_code=status_code,
            detail=f"Cloudflare deployment discovery failed: {exc}",
        ) from exc

    return {
        "provider": "cloudflare",
        "worker_name": worker_name,
        "count": len(deployments),
        "deployments": deployments,
    }
