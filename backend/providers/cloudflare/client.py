"""
CloudPilot — low-level Cloudflare HTTP client.

Transport only.
No application/business logic belongs here.
"""

from __future__ import annotations

from typing import Any

import requests


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
    ):
        if not api_token:
            raise ValueError("Cloudflare API token is required.")

        self.timeout = timeout
        self.session = session or requests.Session()

        if session is None:
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
