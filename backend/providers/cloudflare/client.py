"""
CloudPilot — low-level Cloudflare HTTP client.

Transport only.
No application/business logic belongs here.
"""

from __future__ import annotations

import json
import time
from typing import Any

import requests

from backend.settings import cloudflare_proxies


def _is_retryable(exc: "CloudflareAPIError") -> bool:
    """True for transient network/TLS errors and Cloudflare 5xx."""
    if exc.status_code is None:
        return True

    return exc.status_code >= 500


class CloudflareAPIError(RuntimeError):
    """Cloudflare API request failed."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        errors: list | None = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.errors = errors or []


class CloudflareClient:

    BASE_URL = "https://api.cloudflare.com/client/v4"

    def __init__(
        self,
        api_token: str,
        *,
        timeout: float = 20.0,
        session: requests.Session | None = None,
        proxies: dict[str, str] | None = None,
    ):
        if not api_token:
            raise ValueError("Cloudflare API token is required.")

        self.api_token = api_token
        self.timeout = timeout
        self.session = session or requests.Session()

        if session is None:
            if proxies is None:
                proxies = cloudflare_proxies()

            if proxies:
                self.session.proxies.update(proxies)
                self.session.trust_env = False
            else:
                self.session.trust_env = True

        self.session.headers.update(
            {
                "Authorization": f"Bearer {api_token}",
                "Accept": "application/json",
            }
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        attempts: int = 4,
    ) -> dict[str, Any]:
        """Perform a request, retrying transient network/SSL failures.

        Intermittent TLS interception (common on filtered networks) and
        Cloudflare 5xx errors are retried with a short backoff.
        """
        last_error: CloudflareAPIError | None = None

        for attempt in range(attempts):
            try:
                return self._single_request(method, path, json=json)
            except CloudflareAPIError as exc:
                last_error = exc
                if not _is_retryable(exc):
                    raise
                time.sleep(0.5 * (attempt + 1))

        assert last_error is not None
        raise last_error

    def _single_request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
    ) -> dict[str, Any]:

        url = f"{self.BASE_URL}{path}"

        try:
            response = self.session.request(
                method,
                url,
                json=json,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise CloudflareAPIError(
                f"Cloudflare request failed: {exc}"
            ) from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise CloudflareAPIError(
                "Cloudflare returned invalid JSON.",
                status_code=response.status_code,
            ) from exc

        if not response.ok or not payload.get("success", False):
            errors = payload.get("errors") or []

            detail = "Cloudflare API request was unsuccessful."

            if errors:
                messages = [
                    str(item.get("message", ""))
                    for item in errors
                    if isinstance(item, dict)
                ]
                messages = [x for x in messages if x]

                if messages:
                    detail = "; ".join(messages)

            raise CloudflareAPIError(
                detail,
                status_code=response.status_code,
                errors=errors,
            )

        return payload

    def verify_token(self) -> dict[str, Any]:
        return self._request(
            "GET",
            "/user/tokens/verify",
        )

    def list_workers(self, account_id: str) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/accounts/{account_id}/workers/scripts",
        )

    def get_worker(
        self,
        account_id: str,
        worker_name: str,
    ) -> dict[str, Any]:

        return self._request(
            "GET",
            f"/accounts/{account_id}/workers/scripts/{worker_name}",
        )

    def list_deployments(
        self,
        account_id: str,
        worker_name: str,
    ) -> dict[str, Any]:

        return self._request(
            "GET",
            (
                f"/accounts/{account_id}"
                f"/workers/scripts/{worker_name}"
                "/deployments"
            ),
        )

    def get_user(self) -> dict[str, Any]:
        """Return the API token owner (email, username, ...)."""
        return self._request("GET", "/user")

    def list_accounts(self) -> dict[str, Any]:
        """Return accounts the API token has access to."""
        return self._request("GET", "/accounts")

    def get_workers_dev_subdomain(
        self,
        account_id: str,
    ) -> dict[str, Any]:
        """Return the account-level workers.dev subdomain."""
        return self._request(
            "GET",
            f"/accounts/{account_id}/workers/subdomain",
        )

    def create_workers_dev_subdomain(
        self,
        account_id: str,
        subdomain: str,
    ) -> dict[str, Any]:
        """Create the account-level workers.dev subdomain."""
        return self._request(
            "PUT",
            f"/accounts/{account_id}/workers/subdomain",
            json={"subdomain": subdomain},
        )

    def create_kv_namespace(
        self,
        account_id: str,
        title: str,
    ) -> dict[str, Any]:
        """Create a KV namespace and return its ID."""
        return self._request(
            "POST",
            f"/accounts/{account_id}/storage/kv/namespaces",
            json={"title": title},
        )

    def deploy_module_script(
        self,
        account_id: str,
        script_name: str,
        script: bytes,
        *,
        main_module: str = "worker.js",
        compatibility_date: str,
        compatibility_flags: list[str] | None = None,
        kv_namespace_id: str | None = None,
        kv_binding_name: str = "kv",
    ) -> dict[str, Any]:
        """Upload an ES-module Worker script (multipart)."""
        metadata: dict[str, Any] = {
            "main_module": main_module,
            "compatibility_date": compatibility_date,
        }

        if compatibility_flags:
            metadata["compatibility_flags"] = compatibility_flags

        bindings: list[dict[str, str]] = []

        if kv_namespace_id:
            bindings.append(
                {
                    "name": kv_binding_name,
                    "namespace_id": kv_namespace_id,
                    "type": "kv_namespace",
                }
            )

        if bindings:
            metadata["bindings"] = bindings

        url = (
            f"{self.BASE_URL}/accounts/{account_id}"
            f"/workers/scripts/{script_name}"
        )

        files = [
            (
                "metadata",
                (
                    None,
                    json.dumps(metadata),
                    "application/json",
                ),
            ),
            (
                main_module,
                (
                    main_module,
                    script,
                    "application/javascript+module",
                ),
            ),
        ]

        last_error: CloudflareAPIError | None = None

        for attempt in range(4):
            try:
                return self._single_module_request(url, files)
            except CloudflareAPIError as exc:
                last_error = exc
                if not _is_retryable(exc):
                    raise
                time.sleep(0.5 * (attempt + 1))

        assert last_error is not None
        raise last_error

    def _single_module_request(
        self,
        url: str,
        files: list[tuple[str, tuple[str | None, Any, str]]],
    ) -> dict[str, Any]:

        try:
            response = self.session.request(
                "PUT",
                url,
                files=files,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise CloudflareAPIError(
                f"Cloudflare request failed: {exc}"
            ) from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise CloudflareAPIError(
                "Cloudflare returned invalid JSON.",
                status_code=response.status_code,
            ) from exc

        if not response.ok or not payload.get("success", False):
            errors = payload.get("errors") or []

            detail = "Cloudflare API request was unsuccessful."

            if errors:
                messages = [
                    str(item.get("message", ""))
                    for item in errors
                    if isinstance(item, dict)
                ]
                messages = [x for x in messages if x]

                if messages:
                    detail = "; ".join(messages)

            raise CloudflareAPIError(
                detail,
                status_code=response.status_code,
                errors=errors,
            )

        return payload

    def enable_workers_dev(
        self,
        account_id: str,
        worker_name: str,
    ) -> dict[str, Any]:
        """Enable the workers.dev subdomain route for a Worker."""
        return self._request(
            "POST",
            (
                f"/accounts/{account_id}"
                f"/workers/scripts/{worker_name}"
                "/subdomain"
            ),
            json={"enabled": True},
        )

    def create_tail(
        self,
        account_id: str,
        worker_name: str,
    ) -> dict[str, Any]:
        """Create a Workers Tail and return its WebSocket endpoint."""
        return self._request(
            "POST",
            (
                f"/accounts/{account_id}"
                f"/workers/scripts/{worker_name}"
                "/tails"
            ),
            json={},
        )
