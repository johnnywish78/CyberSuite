"""
CloudPilot — Avaco Railway Relay API v1.

Thin HTTP adapters over the Railway service layer: parsing, validation,
provider wiring, error-to-status translation, relay-key generation and
credential persistence side effects live here; orchestration and result
normalization live in `backend.services.railway_service`.
"""

import secrets

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.providers.railway.provider import (
    RailwayProvider,
    RailwayRelayError,
    RelayOptions,
)
from backend.services import railway_service
from backend.settings import (
    railway_api_token,
    save_railway_credentials,
)

router = APIRouter(
    prefix="/api/v1/railway",
    tags=["railway-v1"],
)


class CredentialsRequest(BaseModel):
    api_token: str = Field(min_length=1, max_length=512)


class DeployRequest(BaseModel):
    relay_name: str = Field(
        default="avaco-relay",
        min_length=1,
        max_length=64,
        pattern=r"^[a-zA-Z0-9_-]+$",
    )
    api_token: str = Field(default="", max_length=512)
    target_domain: str = Field(min_length=1, max_length=512)
    public_relay_path: str = Field(default="/api", max_length=128)
    relay_path: str = Field(default="/api", max_length=128)
    relay_key: str = Field(default="", max_length=128)
    upstream_timeout_ms: int = Field(default=0, ge=0, le=3_600_000)
    max_inflight: int = Field(default=512, ge=1, le=100_000)
    region: str = Field(default="", max_length=64)


def _provider(api_token: str = "") -> RailwayProvider:
    token = api_token.strip() or railway_api_token() or ""

    if not token:
        raise HTTPException(
            status_code=503,
            detail="A Railway API token is required.",
        )

    return RailwayProvider.from_token(token)


def _generate_relay_key() -> str:
    return secrets.token_hex(16)


@router.get("/config")
async def railway_config():
    """
    Return Railway configuration state.

    Secrets are never returned.
    """
    return railway_service.get_config()


@router.post("/config")
async def railway_config_save(payload: CredentialsRequest):
    """
    Persist the Railway API token from the desktop UI.
    """
    save_railway_credentials(payload.api_token.strip())

    return {
        "provider": "railway",
        "configured": True,
    }


@router.get("/status")
async def railway_status():
    """
    Verify the Railway API token and return the account identity.
    """
    provider = _provider()

    try:
        return await railway_service.get_status(provider)
    except RailwayRelayError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Railway status check failed: {exc}",
        ) from exc


@router.get("/regions")
async def railway_regions():
    """
    Return the available Railway deployment regions.
    """
    provider = _provider()

    try:
        return await railway_service.get_regions(provider)
    except RailwayRelayError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Railway region lookup failed: {exc}",
        ) from exc


@router.post("/deploy")
async def railway_deploy(payload: DeployRequest):
    """
    Create or update the Avaco Railway Relay and return the record.
    """
    provider = _provider(payload.api_token)

    options = RelayOptions(
        target_domain=payload.target_domain,
        public_relay_path=payload.public_relay_path,
        relay_path=payload.relay_path,
        relay_key=payload.relay_key or _generate_relay_key(),
        upstream_timeout_ms=payload.upstream_timeout_ms,
        max_inflight=payload.max_inflight,
        region=payload.region,
    )

    try:
        result = await railway_service.deploy(
            provider,
            payload.relay_name,
            options,
            api_token=payload.api_token,
        )
    except RailwayRelayError as exc:
        status_code = 503 if exc.step == "configuration" else 502

        raise HTTPException(
            status_code=status_code,
            detail=str(exc),
        ) from exc

    if payload.api_token.strip():
        save_railway_credentials(payload.api_token.strip())

    return result


@router.get("/deployments")
async def railway_deployments():
    """
    Return locally deployed relays.
    """
    provider = _provider()

    try:
        return await railway_service.list_deployments(provider)
    except RailwayRelayError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc


@router.get("/deployments/{relay_name}")
async def railway_deployment(relay_name: str):
    """
    Return one relay deployment.
    """
    provider = _provider()

    try:
        result = await railway_service.get_deployment(provider, relay_name)
    except RailwayRelayError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc

    if not result["deployment"]:
        raise HTTPException(
            status_code=404,
            detail=f"Relay '{relay_name}' was not found.",
        )

    return result


@router.post("/deployments/{relay_name}/redeploy")
async def railway_redeploy(relay_name: str):
    """
    Trigger a redeploy of the latest code for a relay.
    """
    provider = _provider()

    try:
        return await railway_service.redeploy(provider, relay_name)
    except RailwayRelayError as exc:
        status_code = 404 if exc.step == "not_found" else 502

        raise HTTPException(
            status_code=status_code,
            detail=str(exc),
        ) from exc


@router.post("/deployments/{relay_name}/debug")
async def railway_debug(relay_name: str):
    """
    Query the /__debug endpoint of a deployed relay.
    """
    provider = _provider()

    try:
        return await railway_service.debug(provider, relay_name)
    except RailwayRelayError as exc:
        status_code = 404 if exc.step == "not_found" else 502

        raise HTTPException(
            status_code=status_code,
            detail=str(exc),
        ) from exc


@router.delete("/deployments/{relay_name}")
async def railway_delete(relay_name: str):
    """
    Delete a relay's Railway service and its local record.
    """
    provider = _provider()

    try:
        result = await railway_service.delete(provider, relay_name)
    except RailwayRelayError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc

    if not result["removed"]:
        raise HTTPException(
            status_code=404,
            detail=f"Relay '{relay_name}' was not found.",
        )

    return {
        "provider": "railway",
        "deleted": True,
        "relay_name": relay_name,
    }
