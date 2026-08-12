from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class CloudflareCredentials:
    account_id: str
    api_token: str


@dataclass
class CloudflareWorker:
    name: str
    account_id: str
    created_on: str | None = None
    modified_on: str | None = None
    compatibility_date: str | None = None
    etag: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class CloudflareDeployment:
    worker_name: str
    deployment_id: str | None = None
    version_id: str | None = None
    status: str = "unknown"
    created_on: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
