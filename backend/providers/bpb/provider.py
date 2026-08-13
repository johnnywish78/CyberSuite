"""
CloudPilot — BPB Panel deployment provider.

Business/domain layer that mirrors the BPB-Wizard flow:
resolve the account, ensure a workers.dev subdomain, inject
random credentials into the BPB worker script and deploy the
module to Cloudflare Workers with a KV binding.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from backend.settings import (
    cloudflare_account_id,
    cloudflare_api_token,
)

from backend.providers.bpb.links import (
    build_subscriptions,
    login_url,
    panel_url,
)
from backend.providers.bpb.script import (
    WORKER_SOURCE_URL,
    ScriptBuildError,
    build_script,
    fetch_worker_script,
    generate_secure_path,
    generate_subdomain,
    generate_trojan_password,
    generate_uuid,
    validate_worker_module,
)
from backend.providers.bpb.settings import EmbeddedSettings
from backend.providers.bpb.store import DeploymentStore
from backend.providers.bpb.tail import TailError, capture_tail
from backend.providers.cloudflare.client import (
    CloudflareAPIError,
    CloudflareClient,
)


class BpbPanelError(RuntimeError):
    """BPB Panel deployment failed."""

    def __init__(
        self,
        message: str,
        *,
        step: str | None = None,
    ):
        super().__init__(message)
        self.step = step


class DeployOptions:
    def __init__(
        self,
        *,
        proxy_ip_mode: str = "proxyip",
        proxy_ips: list[str] | None = None,
        prefixes: list[str] | None = None,
        fallback: str = "",
        doh_url: str = "",
    ):
        self.proxy_ip_mode = proxy_ip_mode
        self.proxy_ips = proxy_ips or []
        self.prefixes = prefixes or []
        self.fallback = fallback or ""
        self.doh_url = doh_url or ""


class BpbProvider:
    def __init__(
        self,
        client: CloudflareClient,
        *,
        store: DeploymentStore | None = None,
    ):
        self.client = client
        self.store = store or DeploymentStore()

    @classmethod
    def from_environment(cls) -> "BpbProvider":
        token = cloudflare_api_token()

        if not token:
            raise BpbPanelError(
                "CLOUDFLARE_API_TOKEN is not configured.",
                step="configuration",
            )

        return cls(CloudflareClient(token))

    @classmethod
    def from_token(cls, api_token: str) -> "BpbProvider":
        return cls(CloudflareClient(api_token))

    async def deploy(
        self,
        worker_name: str,
        options: DeployOptions | None = None,
    ) -> dict[str, Any]:
        options = options or DeployOptions()

        try:
            account = await self._resolve_account()
        except CloudflareAPIError as exc:
            raise BpbPanelError(
                f"Cloudflare account discovery failed: {exc}",
                step="authentication",
            ) from exc

        try:
            script = await asyncio.to_thread(fetch_worker_script)
            validate_worker_module(script)
        except ScriptBuildError as exc:
            raise BpbPanelError(str(exc), step="script") from exc

        try:
            subdomain = await self._ensure_subdomain(account["id"])
            host = self._build_workers_dev_host(worker_name, subdomain)
        except CloudflareAPIError as exc:
            raise BpbPanelError(
                f"Workers subdomain setup failed: {exc}",
                step="subdomain",
            ) from exc

        vl_uuid = generate_uuid()
        tr_pass = generate_trojan_password()
        secure_path = generate_secure_path()

        settings = EmbeddedSettings(
            accID=account["id"],
            accEmail=account["email"],
            apiToken=account["token"],
            vlUUID=vl_uuid,
            trPass=tr_pass,
            securePath=secure_path,
            proxyIpMode=options.proxy_ip_mode,
            proxyIPs=options.proxy_ips,
            prefixes=options.prefixes,
            fallback=options.fallback,
            dohUrl=options.doh_url,
            mainDomain=host,
        )

        bundled = build_script(script, settings)

        try:
            kv_payload = await asyncio.to_thread(
                self.client.create_kv_namespace,
                account["id"],
                f"{worker_name}-workers-{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
            )
            kv_namespace_id = (kv_payload.get("result") or {}).get("id")

            if not kv_namespace_id:
                raise BpbPanelError(
                    "Cloudflare did not return a KV namespace ID.",
                    step="kv",
                )
        except CloudflareAPIError as exc:
            raise BpbPanelError(
                f"KV namespace creation failed: {exc}",
                step="kv",
            ) from exc

        compatibility_date = datetime.now(timezone.utc).strftime(
            "%Y-%m-%d"
        )

        try:
            await asyncio.to_thread(
                self.client.deploy_module_script,
                account["id"],
                worker_name,
                bundled,
                compatibility_date=compatibility_date,
                compatibility_flags=["nodejs_compat"],
                kv_namespace_id=kv_namespace_id,
            )
        except CloudflareAPIError as exc:
            raise BpbPanelError(
                f"Worker deployment failed: {exc}",
                step="deploy",
            ) from exc

        enable_error: str | None = None

        try:
            await asyncio.to_thread(
                self.client.enable_workers_dev,
                account["id"],
                worker_name,
            )
        except CloudflareAPIError as exc:
            enable_error = (
                "worker is deployed but the workers.dev route "
                f"could not be enabled: {exc}"
            )

        record = self._build_record(
            worker_name=worker_name,
            account=account,
            host=host,
            kv_namespace_id=kv_namespace_id,
            compatibility_date=compatibility_date,
            settings=settings,
            deployed_at=datetime.now(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            ),
        )

        if enable_error:
            record["warnings"] = [enable_error]

        self.store.save(worker_name, record)

        return record

    async def deployments(self) -> list[dict[str, Any]]:
        return [
            self._normalize_record(record)
            for record in self.store.list()
        ]

    async def get(
        self,
        worker_name: str,
    ) -> dict[str, Any] | None:
        record = self.store.get(worker_name)

        if record is None:
            return None

        return self._normalize_record(record)

    def _normalize_record(
        self,
        record: dict[str, Any],
    ) -> dict[str, Any]:
        """Fix records deployed before the workers.dev suffix fix."""
        host = (record.get("host") or "").strip()

        if host.endswith(".workers.dev"):
            return record

        subdomain = host.split(".", 1)[1] if "." in host else host
        host = self._build_workers_dev_host(
            record.get("worker_name") or "",
            subdomain,
        )

        secure_path = (
            (record.get("credentials") or {}).get("secure_path") or ""
        )

        record = dict(record)
        record["host"] = host
        record["panel_url"] = panel_url(host, secure_path)
        record["login_url"] = login_url(host, secure_path)
        record["subscriptions"] = build_subscriptions(
            host, secure_path
        )

        return record

    async def tail_logs(
        self,
        account_id: str,
        worker_name: str,
    ) -> dict[str, Any]:
        try:
            events = await capture_tail(
                self.client,
                account_id,
                worker_name,
            )
        except TailError as exc:
            raise BpbPanelError(str(exc), step="tail") from exc

        exceptions = [
            {
                "name": item["name"],
                "message": item["message"],
                "stack": item["stack"],
            }
            for event in events
            for item in event.get("exceptions") or []
        ]

        logs = [
            {"level": item["level"], "message": item["message"]}
            for event in events
            for item in event.get("logs") or []
        ]

        return {
            "worker_name": worker_name,
            "events": len(events),
            "exceptions": exceptions,
            "logs": logs,
        }

    async def _resolve_account(self) -> dict[str, Any]:
        user = await asyncio.to_thread(self.client.get_user)
        user_result = user.get("result") or {}

        accounts = await asyncio.to_thread(self.client.list_accounts)
        accounts_result = accounts.get("result") or []

        account_id = cloudflare_account_id()

        if not account_id:
            if not accounts_result:
                raise BpbPanelError(
                    "The API token has access to no accounts.",
                    step="authentication",
                )

            account_id = accounts_result[0].get("id")

        if not account_id:
            raise BpbPanelError(
                "Cloudflare account ID could not be determined.",
                step="authentication",
            )

        return {
            "id": account_id,
            "email": user_result.get("email") or "",
            "token": self.client.api_token or "",
        }

    async def _ensure_subdomain(self, account_id: str) -> str:
        try:
            payload = await asyncio.to_thread(
                self.client.get_workers_dev_subdomain,
                account_id,
            )
        except CloudflareAPIError:
            pass
        else:
            subdomain = (payload.get("result") or {}).get("subdomain")

            if subdomain:
                return subdomain

        payload = await asyncio.to_thread(
            self.client.create_workers_dev_subdomain,
            account_id,
            generate_subdomain(),
        )

        return (payload.get("result") or {}).get("subdomain") or ""

    @staticmethod
    def _build_workers_dev_host(
        worker_name: str,
        subdomain: str,
    ) -> str:
        """Compose the full worker host.

        The Cloudflare API returns only the workers.dev prefix
        (e.g. ``markjohnnson78``); the ``.workers.dev`` suffix must be
        appended to build a real, routable hostname.
        """
        subdomain = subdomain.strip()

        if subdomain.endswith(".workers.dev"):
            return f"{worker_name}.{subdomain}"

        return f"{worker_name}.{subdomain}.workers.dev"

    def _build_record(
        self,
        *,
        worker_name: str,
        account: dict[str, Any],
        host: str,
        kv_namespace_id: str,
        compatibility_date: str,
        settings: EmbeddedSettings,
        deployed_at: str,
    ) -> dict[str, Any]:
        return {
            "deploy_method": "workers",
            "worker_name": worker_name,
            "host": host,
            "account_id": account["id"],
            "account_email": settings.accEmail,
            "kv_namespace_id": kv_namespace_id,
            "compatibility_date": compatibility_date,
            "panel_url": panel_url(host, settings.securePath),
            "login_url": login_url(host, settings.securePath),
            "subscriptions": build_subscriptions(
                host, settings.securePath
            ),
            "credentials": {
                "vl_uuid": settings.vlUUID,
                "trojan_password": settings.trPass,
                "secure_path": settings.securePath,
                "proxy_ip_mode": settings.proxyIpMode,
                "proxy_ips": settings.proxyIPs,
                "prefixes": settings.prefixes,
                "fallback": settings.fallback,
                "doh_url": settings.dohUrl,
            },
            "source_url": WORKER_SOURCE_URL,
            "deployed_at": deployed_at,
        }