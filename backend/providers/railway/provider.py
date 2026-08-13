"""
CloudPilot — Avaco Railway Relay deployment provider.

Business/domain layer that automates the avaco-railway flow:
resolve the Railway account, create a project, create a service,
inject the relay environment variables, upload the bundled relay
source, trigger a deploy and attach a public domain.
"""

from __future__ import annotations

import asyncio
import secrets
from datetime import datetime, timezone
from typing import Any

import requests

from backend.providers.railway.client import (
    RailwayAPIError,
    RailwayClient,
)
from backend.providers.railway.source_builder import (
    RailwaySourceError,
    build_source_tarball,
)
from backend.providers.railway.store import RailwayStore
from backend.settings import railway_api_token


class RailwayRelayError(RuntimeError):
    """Avaco Railway Relay deployment failed."""

    def __init__(
        self,
        message: str,
        *,
        step: str | None = None,
    ):
        super().__init__(message)
        self.step = step


class RelayOptions:
    """Deploy-time configuration mirroring the relay environment variables."""

    def __init__(
        self,
        *,
        target_domain: str,
        public_relay_path: str = "/api",
        relay_path: str = "/api",
        relay_key: str = "",
        upstream_timeout_ms: int = 0,
        max_inflight: int = 512,
        region: str = "",
    ):
        self.target_domain = (target_domain or "").strip()
        self.public_relay_path = self._normalize_path(public_relay_path)
        self.relay_path = self._normalize_path(relay_path)
        self.relay_key = (relay_key or "").strip()
        self.upstream_timeout_ms = upstream_timeout_ms
        self.max_inflight = max_inflight
        self.region = (region or "").strip()

    @staticmethod
    def _normalize_path(path: str) -> str:
        path = (path or "").strip()

        if not path:
            return "/api"

        if not path.startswith("/"):
            path = f"/{path}"

        if len(path) > 1 and path.endswith("/"):
            path = path[:-1]

        return path

    def to_variables(self, *, include_key: bool = True) -> dict[str, str]:
        variables: dict[str, str] = {
            "TARGET_DOMAIN": self.target_domain,
            "PUBLIC_RELAY_PATH": self.public_relay_path,
            "RELAY_PATH": self.relay_path,
            "UPSTREAM_TIMEOUT_MS": str(self.upstream_timeout_ms),
            "MAX_INFLIGHT": str(self.max_inflight),
        }

        if include_key and self.relay_key:
            variables["RELAY_KEY"] = self.relay_key

        return variables

    def validate(self) -> None:
        if not self.target_domain:
            raise RailwayRelayError(
                "TARGET_DOMAIN is required — the address of your Xray server.",
                step="configuration",
            )

        if "://" not in self.target_domain:
            raise RailwayRelayError(
                "TARGET_DOMAIN must include a scheme, e.g. https://1.2.3.4:443.",
                step="configuration",
            )

        if self.public_relay_path == "/":
            raise RailwayRelayError(
                "PUBLIC_RELAY_PATH cannot be '/'.",
                step="configuration",
            )

        if self.relay_path == "/":
            raise RailwayRelayError(
                "RELAY_PATH cannot be '/'.",
                step="configuration",
            )

        if self.relay_key and len(self.relay_key) < 16:
            raise RailwayRelayError(
                "RELAY_KEY must be at least 16 characters.",
                step="configuration",
            )

        if self.upstream_timeout_ms < 0:
            raise RailwayRelayError(
                "UPSTREAM_TIMEOUT_MS cannot be negative.",
                step="configuration",
            )

        if self.max_inflight < 1:
            raise RailwayRelayError(
                "MAX_INFLIGHT must be at least 1.",
                step="configuration",
            )


class RailwayProvider:
    def __init__(
        self,
        client: RailwayClient,
        *,
        store: RailwayStore | None = None,
    ):
        self.client = client
        self.store = store or RailwayStore()

    @classmethod
    def from_environment(cls) -> "RailwayProvider":
        token = railway_api_token()

        if not token:
            raise RailwayRelayError(
                "RAILWAY_API_TOKEN is not configured.",
                step="configuration",
            )

        return cls(RailwayClient(token))

    @classmethod
    def from_token(cls, api_token: str) -> "RailwayProvider":
        return cls(RailwayClient(api_token))

    async def whoami(self) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(self.client.whoami)
        except RailwayAPIError as exc:
            raise RailwayRelayError(
                f"Railway authentication failed: {exc}",
                step="authentication",
            ) from exc

    async def regions(self) -> list[dict[str, Any]]:
        try:
            return await asyncio.to_thread(self.client.list_regions)
        except RailwayAPIError as exc:
            raise RailwayRelayError(
                f"Failed to list Railway regions: {exc}",
                step="authentication",
            ) from exc

    async def deploy(
        self,
        relay_name: str,
        options: RelayOptions,
        *,
        api_token: str = "",
    ) -> dict[str, Any]:
        """Create (or update) the relay on Railway and store the record.

        When a local record exists for the same name the existing
        project/service is reused: variables are updated and the service
        is redeployed. Otherwise a fresh project is created, the bundled
        relay source is uploaded and a public domain is attached.
        """
        if api_token.strip():
            self.client = RailwayClient(api_token.strip())

        options.validate()

        if not relay_name:
            raise RailwayRelayError(
                "A relay name is required.",
                step="configuration",
            )

        existing = self.store.get(relay_name)

        try:
            me = await asyncio.to_thread(self.client.whoami)
        except RailwayAPIError as exc:
            raise RailwayRelayError(
                f"Railway authentication failed: {exc}",
                step="authentication",
            ) from exc

        try:
            if existing and existing.get("project_id"):
                record = await self._update_existing(
                    relay_name,
                    existing,
                    options,
                )
            else:
                record = await self._create_new(
                    relay_name,
                    options,
                )
        except RailwayAPIError as exc:
            raise RailwayRelayError(str(exc), step="deploy") from exc

        record["relay_name"] = relay_name
        record["account_email"] = me.get("email") or ""
        record["deployed_at"] = datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )

        self.store.save(relay_name, record)

        return record

    async def _create_new(
        self,
        relay_name: str,
        options: RelayOptions,
    ) -> dict[str, Any]:
        project = await asyncio.to_thread(
            self.client.create_project,
            relay_name,
        )
        project_id = project.get("id")

        if not project_id:
            raise RailwayRelayError(
                "Railway did not return a project ID.",
                step="project",
            )

        environment_id = await self._resolve_environment_id(project_id)

        service = await asyncio.to_thread(
            self.client.create_service,
            project_id,
            relay_name,
        )
        service_id = service.get("id")

        if not service_id:
            raise RailwayRelayError(
                "Railway did not return a service ID.",
                step="service",
            )

        start_command = "node src/index.js"

        await asyncio.to_thread(
            self.client.update_service_instance,
            service_id,
            environment_id,
            start_command=start_command,
            region=options.region or None,
        )

        variables = options.to_variables()

        await asyncio.to_thread(
            self.client.set_variables,
            project_id,
            environment_id,
            service_id,
            variables,
        )

        tarball = await asyncio.to_thread(build_source_tarball)

        upload = await asyncio.to_thread(
            self.client.upload_source,
            project_id,
            environment_id,
            service_id,
            tarball,
        )

        domain = ""
        domain_payload: dict[str, Any] = {}

        try:
            domain_payload = await asyncio.to_thread(
                self.client.create_domain,
                service_id,
                environment_id,
            )
            domain = domain_payload.get("domain") or ""
        except RailwayAPIError:
            domain = ""

        return {
            "deploy_method": "railway-up",
            "source_repo": "avacocloud/avaco-railway",
            "project_id": project_id,
            "environment_id": environment_id,
            "service_id": service_id,
            "deployment_id": upload.get("deployment_id") or "",
            "domain": domain,
            "domain_status": domain_payload.get("status") or "",
            "host": f"https://{domain}" if domain else "",
            "start_command": start_command,
            "region": options.region or "",
            "config": options.to_variables(include_key=False),
            "relay_key_set": bool(options.relay_key),
            "status": "deploying",
            "warnings": [],
        }

    async def _update_existing(
        self,
        relay_name: str,
        existing: dict[str, Any],
        options: RelayOptions,
    ) -> dict[str, Any]:
        project_id = existing["project_id"]
        environment_id = existing["environment_id"]
        service_id = existing["service_id"]

        if options.region and options.region != existing.get("region", ""):
            await asyncio.to_thread(
                self.client.update_service_instance,
                service_id,
                environment_id,
                region=options.region,
            )

        variables = options.to_variables()

        await asyncio.to_thread(
            self.client.set_variables,
            project_id,
            environment_id,
            service_id,
            variables,
        )

        deployment_id = await asyncio.to_thread(
            self.client.redeploy,
            service_id,
            environment_id,
        )

        record = dict(existing)

        record.update(
            {
                "deployment_id": deployment_id or existing.get("deployment_id", ""),
                "start_command": existing.get("start_command", "node src/index.js"),
                "region": options.region or existing.get("region", ""),
                "config": options.to_variables(include_key=False),
                "relay_key_set": bool(options.relay_key),
                "status": "deploying",
            }
        )

        return record

    async def _resolve_environment_id(self, project_id: str) -> str:
        project = await asyncio.to_thread(
            self.client.get_project,
            project_id,
        )

        environments = [
            item.get("node") or {}
            for item in (project.get("environments") or {}).get("edges") or []
            if isinstance(item, dict)
        ]

        for env in environments:
            if env.get("name") == "production":
                return env.get("id") or ""

        if environments:
            return environments[0].get("id") or ""

        raise RailwayRelayError(
            "The Railway project has no environment to deploy into.",
            step="environment",
        )

    async def deployments(self) -> list[dict[str, Any]]:
        records = []

        for record in self.store.list():
            relay_name = record.get("relay_name") or ""
            if not relay_name:
                continue
            records.append(await self.get(relay_name))

        return records

    async def get(
        self,
        relay_name: str,
    ) -> dict[str, Any] | None:
        record = self.store.get(relay_name)

        if record is None:
            return None

        record = dict(record)

        service_id = record.get("service_id") or ""
        environment_id = record.get("environment_id") or ""

        if service_id and environment_id:
            try:
                instance = await asyncio.to_thread(
                    self.client.get_service_instance,
                    service_id,
                    environment_id,
                )

                latest = instance.get("latestDeployment") or {}

                record["status"] = latest.get("status") or record.get(
                    "status", "unknown"
                )
                record["deployment_id"] = (
                    latest.get("id")
                    or record.get("deployment_id")
                    or ""
                )
                record["static_url"] = latest.get("staticUrl") or ""
                record["instance_region"] = instance.get("region") or ""
            except RailwayAPIError:
                # Keep the stored record when live status is unavailable.
                pass

        return record

    async def delete(self, relay_name: str) -> bool:
        record = self.store.get(relay_name)

        if record is None:
            return False

        service_id = record.get("service_id") or ""

        if service_id:
            try:
                await asyncio.to_thread(
                    self.client.delete_service,
                    service_id,
                )
            except RailwayAPIError:
                # The service may already be gone; remove the local record.
                pass

        self.store.delete(relay_name)

        return True

    async def refresh_deployment(
        self,
        relay_name: str,
    ) -> dict[str, Any]:
        record = self.store.get(relay_name)

        if record is None:
            raise RailwayRelayError(
                f"Relay '{relay_name}' was not found.",
                step="not_found",
            )

        service_id = record.get("service_id") or ""
        environment_id = record.get("environment_id") or ""

        if not service_id or not environment_id:
            raise RailwayRelayError(
                "This deployment record has no service/environment IDs.",
                step="deploy",
            )

        try:
            deployment_id = await asyncio.to_thread(
                self.client.redeploy,
                service_id,
                environment_id,
            )
        except RailwayAPIError as exc:
            raise RailwayRelayError(
                f"Redeploy failed: {exc}",
                step="deploy",
            ) from exc

        record["deployment_id"] = deployment_id or record.get(
            "deployment_id", ""
        )
        record["status"] = "deploying"

        self.store.save(relay_name, record)

        return record

    async def debug_status(
        self,
        relay_name: str,
    ) -> dict[str, Any]:
        record = self.store.get(relay_name)

        if record is None:
            raise RailwayRelayError(
                f"Relay '{relay_name}' was not found.",
                step="not_found",
            )

        host = record.get("host") or ""

        if not host:
            raise RailwayRelayError(
                "This deployment has no public domain yet.",
                step="deploy",
            )

        url = f"{host}/__debug"

        try:
            response = await asyncio.to_thread(
                requests.get,
                url,
                timeout=15.0,
            )
        except requests.RequestException as exc:
            raise RailwayRelayError(
                f"Debug endpoint unreachable: {exc}",
                step="debug",
            ) from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise RailwayRelayError(
                "Debug endpoint returned invalid JSON.",
                step="debug",
            ) from exc

        return {
            "relay_name": relay_name,
            "url": url,
            "status_code": response.status_code,
            "debug": payload,
        }
