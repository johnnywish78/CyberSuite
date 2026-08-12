"""
CloudPilot — Cloudflare provider.

Business/domain layer between the API and low-level HTTP client.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from backend.providers.cloudflare.client import (
    CloudflareAPIError,
    CloudflareClient,
)


class CloudflareProviderError(RuntimeError):
    """Provider-level Cloudflare error."""

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
    ):
        super().__init__(message)
        self.code = code


class CloudflareProvider:
    def __init__(
        self,
        client: CloudflareClient,
        account_id: str,
    ):
        if not account_id:
            raise CloudflareProviderError(
                "Cloudflare account ID is required.",
                code="configuration",
            )

        self.client = client
        self.account_id = account_id

    @classmethod
    def from_environment(cls) -> "CloudflareProvider":
        token = (
            os.getenv("CLOUDFLARE_API_TOKEN")
            or os.getenv("CF_API_TOKEN")
        )

        account_id = (
            os.getenv("CLOUDFLARE_ACCOUNT_ID")
            or os.getenv("CF_ACCOUNT_ID")
        )

        if not token:
            raise CloudflareProviderError(
                "CLOUDFLARE_API_TOKEN is not configured.",
                code="configuration",
            )

        if not account_id:
            raise CloudflareProviderError(
                "CLOUDFLARE_ACCOUNT_ID is not configured.",
                code="configuration",
            )

        return cls(
            CloudflareClient(token),
            account_id,
        )

    async def status(self) -> dict[str, Any]:
        try:
            payload = await asyncio.to_thread(
                self.client.verify_token
            )
        except CloudflareAPIError as exc:
            raise CloudflareProviderError(
                str(exc),
                code="authentication",
            ) from exc

        result = payload.get("result") or {}

        return {
            "authenticated": bool(result.get("status") == "active"),
            "token_status": result.get("status"),
            "account_id": self.account_id,
        }

    async def list_workers(self) -> list[dict[str, Any]]:
        try:
            payload = await asyncio.to_thread(
                self.client.list_workers,
                self.account_id,
            )
        except CloudflareAPIError as exc:
            raise CloudflareProviderError(
                str(exc),
                code="workers",
            ) from exc

        result = payload.get("result") or []

        return [
            self._normalize_worker(item)
            for item in result
            if isinstance(item, dict)
        ]

    async def get_worker(
        self,
        worker_name: str,
    ) -> dict[str, Any]:

        try:
            payload = await asyncio.to_thread(
                self.client.get_worker,
                self.account_id,
                worker_name,
            )
        except CloudflareAPIError as exc:
            if exc.status_code == 404:
                raise CloudflareProviderError(
                    f"Worker '{worker_name}' was not found.",
                    code="not_found",
                ) from exc

            raise CloudflareProviderError(
                str(exc),
                code="worker",
            ) from exc

        result = payload.get("result") or {}

        if not isinstance(result, dict):
            raise CloudflareProviderError(
                "Cloudflare returned an invalid Worker object.",
                code="invalid_response",
            )

        return self._normalize_worker(result)

    async def list_deployments(
        self,
        worker_name: str,
    ) -> list[dict[str, Any]]:

        try:
            payload = await asyncio.to_thread(
                self.client.list_deployments,
                self.account_id,
                worker_name,
            )
        except CloudflareAPIError as exc:
            if exc.status_code == 404:
                raise CloudflareProviderError(
                    f"Worker '{worker_name}' was not found.",
                    code="not_found",
                ) from exc

            raise CloudflareProviderError(
                str(exc),
                code="deployments",
            ) from exc

        result = payload.get("result") or []

        return [
            self._normalize_deployment(item)
            for item in result
            if isinstance(item, dict)
        ]

    def _normalize_worker(
        self,
        item: dict[str, Any],
    ) -> dict[str, Any]:

        metadata = item.get("metadata") or {}

        return {
            "name": item.get("id") or item.get("name"),
            "account_id": self.account_id,
            "created_on": item.get("created_on"),
            "modified_on": item.get("modified_on"),
            "compatibility_date": metadata.get(
                "compatibility_date"
            ) or item.get("compatibility_date"),
            "etag": item.get("etag"),
            "workers_dev_enabled": item.get(
                "workers_dev_enabled"
            ),
            "workers_dev_url": item.get(
                "workers_dev_url"
            ),
            "metadata": metadata,
        }

    def _normalize_deployment(
        self,
        item: dict[str, Any],
    ) -> dict[str, Any]:

        return {
            "deployment_id": item.get("id")
            or item.get("deployment_id"),
            "version_id": item.get("version_id"),
            "status": item.get("status"),
            "created_on": item.get("created_on"),
            "metadata": item.get("metadata") or {},
        }
