"""
CloudPilot — low-level Railway GraphQL client.

Transport only.
No application/business logic belongs here.
"""

from __future__ import annotations

import time
from typing import Any

import requests

from backend.settings import cloudflare_proxies


def _is_retryable(exc: "RailwayAPIError") -> bool:
    """True for transient network/TLS errors and HTTP 5xx."""
    if exc.status_code is None:
        return True

    return exc.status_code >= 500


class RailwayAPIError(RuntimeError):
    """Railway API request failed."""

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


class RailwayClient:

    GRAPHQL_URL = "https://backboard.railway.com/graphql/v2"
    UPLOAD_URL = "https://backboard.railway.com/project/{project}/environment/{environment}/up"

    def __init__(
        self,
        api_token: str,
        *,
        timeout: float = 30.0,
        session: requests.Session | None = None,
        proxies: dict[str, str] | None = None,
    ):
        if not api_token:
            raise ValueError("Railway API token is required.")

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
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        )

    # ── GraphQL ───────────────────────────────────────────────────────────────

    def _graphql(
        self,
        query: str,
        variables: dict[str, Any] | None = None,
        *,
        attempts: int = 4,
    ) -> dict[str, Any]:
        """Execute a GraphQL mutation/query, retrying transient failures."""
        last_error: RailwayAPIError | None = None

        for attempt in range(attempts):
            try:
                return self._single_graphql(query, variables)
            except RailwayAPIError as exc:
                last_error = exc
                if not _is_retryable(exc):
                    raise
                time.sleep(0.5 * (attempt + 1))

        assert last_error is not None
        raise last_error

    def _single_graphql(
        self,
        query: str,
        variables: dict[str, Any] | None = None,
    ) -> dict[str, Any]:

        try:
            response = self.session.post(
                self.GRAPHQL_URL,
                json={
                    "query": query,
                    "variables": variables or {},
                },
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise RailwayAPIError(
                f"Railway request failed: {exc}"
            ) from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise RailwayAPIError(
                "Railway returned invalid JSON.",
                status_code=response.status_code,
            ) from exc

        errors = payload.get("errors")

        if errors:
            messages = [
                str(item.get("message", ""))
                for item in errors
                if isinstance(item, dict)
            ]
            messages = [x for x in messages if x]

            raise RailwayAPIError(
                "; ".join(messages) or "Railway request failed.",
                status_code=response.status_code,
                errors=errors,
            )

        return payload.get("data") or {}

    # ── Auth / account ────────────────────────────────────────────────────────

    def whoami(self) -> dict[str, Any]:
        data = self._graphql(
            """
            query WhoAmI {
              me {
                id
                name
                email
                username
              }
            }
            """
        )
        return (data.get("me") or {})

    def list_regions(self) -> list[dict[str, Any]]:
        data = self._graphql(
            """
            query Regions {
              regions {
                name
                country
                location
              }
            }
            """
        )
        return data.get("regions") or []

    # ── Projects ──────────────────────────────────────────────────────────────

    def create_project(self, name: str) -> dict[str, Any]:
        data = self._graphql(
            """
            mutation CreateProject($input: ProjectCreateInput!) {
              projectCreate(input: $input) {
                id
                name
              }
            }
            """,
            {"input": {"name": name}},
        )
        return data.get("projectCreate") or {}

    def get_project(
        self,
        project_id: str,
    ) -> dict[str, Any]:
        data = self._graphql(
            """
            query GetProject($id: String!) {
              project(id: $id) {
                id
                name
                services {
                  edges {
                    node { id name }
                  }
                }
                environments {
                  edges {
                    node { id name }
                  }
                }
              }
            }
            """,
            {"id": project_id},
        )
        return data.get("project") or {}

    def list_projects(self) -> list[dict[str, Any]]:
        data = self._graphql(
            """
            query Projects {
              projects {
                edges {
                  node { id name }
                }
              }
            }
            """
        )
        return [
            item.get("node") or {}
            for item in (data.get("projects") or {}).get("edges") or []
            if isinstance(item, dict)
        ]

    # ── Services ──────────────────────────────────────────────────────────────

    def create_service(
        self,
        project_id: str,
        name: str,
        *,
        repo: str = "avacocloud/avaco-railway",
    ) -> dict[str, Any]:
        data = self._graphql(
            """
            mutation CreateService($input: ServiceCreateInput!) {
              serviceCreate(input: $input) {
                id
                name
              }
            }
            """,
            {
                "input": {
                    "projectId": project_id,
                    "name": name,
                    "source": {"repo": repo},
                }
            },
        )
        return data.get("serviceCreate") or {}

    def update_service_instance(
        self,
        service_id: str,
        environment_id: str,
        *,
        start_command: str | None = None,
        region: str | None = None,
    ) -> None:
        fields: dict[str, Any] = {}

        if start_command is not None:
            fields["startCommand"] = start_command

        if region:
            fields["region"] = region

        if not fields:
            return

        self._graphql(
            """
            mutation UpdateServiceInstance(
              $serviceId: String!
              $environmentId: String!
              $input: ServiceInstanceUpdateInput!
            ) {
              serviceInstanceUpdate(
                serviceId: $serviceId
                environmentId: $environmentId
                input: $input
              )
            }
            """,
            {
                "serviceId": service_id,
                "environmentId": environment_id,
                "input": fields,
            },
        )

    def get_service_instance(
        self,
        service_id: str,
        environment_id: str,
    ) -> dict[str, Any]:
        data = self._graphql(
            """
            query ServiceInstance($serviceId: String!, $environmentId: String!) {
              serviceInstance(
                serviceId: $serviceId
                environmentId: $environmentId
              ) {
                id
                serviceName
                startCommand
                region
                numReplicas
                latestDeployment {
                  id
                  status
                  createdAt
                  staticUrl
                }
              }
            }
            """,
            {
                "serviceId": service_id,
                "environmentId": environment_id,
            },
        )
        return data.get("serviceInstance") or {}

    def delete_service(self, service_id: str) -> None:
        self._graphql(
            """
            mutation DeleteService($id: String!) {
              serviceDelete(id: $id)
            }
            """,
            {"id": service_id},
        )

    # ── Deployments ───────────────────────────────────────────────────────────

    def redeploy(
        self,
        service_id: str,
        environment_id: str,
    ) -> str:
        data = self._graphql(
            """
            mutation Redeploy($serviceId: String!, $environmentId: String!) {
              serviceInstanceRedeploy(
                serviceId: $serviceId
                environmentId: $environmentId
              )
            }
            """,
            {
                "serviceId": service_id,
                "environmentId": environment_id,
            },
        )
        return data.get("serviceInstanceRedeploy") or ""

    # ── Variables ─────────────────────────────────────────────────────────────

    def get_variables(
        self,
        project_id: str,
        environment_id: str,
        service_id: str | None = None,
    ) -> dict[str, Any]:
        data = self._graphql(
            """
            query GetVariables(
              $projectId: String!
              $environmentId: String!
              $serviceId: String
            ) {
              variables(
                projectId: $projectId
                environmentId: $environmentId
                serviceId: $serviceId
              )
            }
            """,
            {
                "projectId": project_id,
                "environmentId": environment_id,
                "serviceId": service_id,
            },
        )
        return data.get("variables") or {}

    def set_variables(
        self,
        project_id: str,
        environment_id: str,
        service_id: str,
        variables: dict[str, str],
        *,
        replace: bool = True,
    ) -> None:
        self._graphql(
            """
            mutation SetVariables($input: VariableCollectionUpsertInput!) {
              variableCollectionUpsert(input: $input)
            }
            """,
            {
                "input": {
                    "projectId": project_id,
                    "environmentId": environment_id,
                    "serviceId": service_id,
                    "variables": variables,
                    "replace": replace,
                }
            },
        )

    # ── Domains ───────────────────────────────────────────────────────────────

    def create_domain(
        self,
        service_id: str,
        environment_id: str,
    ) -> dict[str, Any]:
        data = self._graphql(
            """
            mutation CreateDomain($input: ServiceDomainCreateInput!) {
              serviceDomainCreate(input: $input) {
                id
                domain
                status
              }
            }
            """,
            {
                "input": {
                    "serviceId": service_id,
                    "environmentId": environment_id,
                }
            },
        )
        return data.get("serviceDomainCreate") or {}

    # ── Source upload (railway up equivalent) ─────────────────────────────────

    def upload_source(
        self,
        project_id: str,
        environment_id: str,
        service_id: str,
        tarball: bytes,
        *,
        attempts: int = 3,
    ) -> dict[str, Any]:
        """Upload a gzipped tarball as a new deployment.

        Mirrors the `railway up` endpoint on the backboard API.
        """
        url = self.UPLOAD_URL.format(
            project=project_id,
            environment=environment_id,
        )

        params: dict[str, str] = {"serviceId": service_id}

        last_error: RailwayAPIError | None = None

        for attempt in range(attempts):
            try:
                response = self.session.post(
                    url,
                    params=params,
                    data=tarball,
                    headers={"Content-Type": "application/gzip"},
                    timeout=120.0,
                )
            except requests.RequestException as exc:
                last_error = RailwayAPIError(
                    f"Railway source upload failed: {exc}"
                )
                time.sleep(1.0 * (attempt + 1))
                continue

            if response.status_code == 200:
                try:
                    payload = response.json()
                except ValueError as exc:
                    raise RailwayAPIError(
                        "Railway returned invalid upload response."
                    ) from exc

                return payload

            last_error = RailwayAPIError(
                (
                    "Railway source upload failed "
                    f"with status code {response.status_code}: "
                    f"{response.text[:500]}"
                ),
                status_code=response.status_code,
            )

            if response.status_code < 500:
                raise last_error

            time.sleep(1.0 * (attempt + 1))

        assert last_error is not None
        raise last_error
