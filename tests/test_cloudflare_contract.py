from fastapi.testclient import TestClient

from backend.app import app
from backend.api.v1 import cloudflare


class FakeProvider:
    account_id = "test-account-123"

    async def status(self):
        return {
            "authenticated": True,
            "token_status": "active",
            "account_id": self.account_id,
        }

    async def list_workers(self):
        return [
            {
                "name": "demo-worker",
                "account_id": self.account_id,
                "created_on": "2026-01-01T00:00:00Z",
                "modified_on": "2026-01-02T00:00:00Z",
                "compatibility_date": "2026-01-01",
                "etag": "etag-demo",
                "workers_dev_enabled": False,
                "workers_dev_url": None,
                "metadata": {
                    "handlers": ["fetch"],
                    "has_assets": False,
                    "has_modules": True,
                    "usage_model": "standard",
                },
            }
        ]

    async def get_worker(self, worker_name):
        if worker_name != "demo-worker":
            from backend.providers.cloudflare.provider import (
                CloudflareProviderError,
            )

            raise CloudflareProviderError(
                "Worker not found",
                code="not_found",
            )

        return {
            "name": "demo-worker",
            "account_id": self.account_id,
            "created_on": "2026-01-01T00:00:00Z",
            "modified_on": "2026-01-02T00:00:00Z",
            "compatibility_date": "2026-01-01",
            "etag": "etag-demo",
            "workers_dev_enabled": False,
            "workers_dev_url": None,
            "metadata": {
                "handlers": ["fetch"],
                "has_assets": False,
                "has_modules": True,
                "usage_model": "standard",
            },
        }

    async def list_deployments(self, worker_name):
        if worker_name != "demo-worker":
            from backend.providers.cloudflare.provider import (
                CloudflareProviderError,
            )

            raise CloudflareProviderError(
                "Worker not found",
                code="not_found",
            )

        return [
            {
                "deployment_id": "deployment-001",
                "version_id": "version-001",
                "status": "active",
                "created_on": "2026-01-02T00:00:00Z",
                "metadata": {
                    "source": "api",
                    "strategy": "percentage",
                    "percentage": 100,
                },
            }
        ]


def fake_provider():
    return FakeProvider()


cloudflare._provider = fake_provider

client = TestClient(app)


def test_health_contract():
    response = client.get("/api/health")

    assert response.status_code == 200

    body = response.json()

    assert body["status"] == "ok"
    assert body["service"] == "cloudpilot-backend"
    assert body["version"] == "0.1.0"


def test_cloudflare_status_contract():
    response = client.get("/api/v1/cloudflare/status")

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "cloudflare"
    assert body["authenticated"] is True
    assert body["token_status"] == "active"
    assert body["account_id"] == "test-account-123"


def test_cloudflare_workers_contract():
    response = client.get("/api/v1/cloudflare/workers")

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "cloudflare"
    assert body["account_id"] == "test-account-123"
    assert body["count"] == 1
    assert len(body["workers"]) == 1

    worker = body["workers"][0]

    assert worker["name"] == "demo-worker"
    assert worker["account_id"] == "test-account-123"
    assert worker["metadata"]["has_modules"] is True


def test_cloudflare_worker_contract():
    response = client.get(
        "/api/v1/cloudflare/workers/demo-worker"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "cloudflare"
    assert body["worker"]["name"] == "demo-worker"
    assert body["worker"]["account_id"] == "test-account-123"


def test_cloudflare_worker_deployments_contract():
    response = client.get(
        "/api/v1/cloudflare/workers/demo-worker/deployments"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "cloudflare"
    assert body["worker_name"] == "demo-worker"
    assert body["count"] == 1

    deployment = body["deployments"][0]

    assert deployment["deployment_id"] == "deployment-001"
    assert deployment["version_id"] == "version-001"
    assert deployment["status"] == "active"
    assert deployment["metadata"]["percentage"] == 100


def test_unknown_worker_returns_404():
    response = client.get(
        "/api/v1/cloudflare/workers/not-found"
    )

    assert response.status_code == 404

    body = response.json()

    assert "not found" in body["detail"].lower()


def test_unknown_worker_deployments_returns_404():
    response = client.get(
        "/api/v1/cloudflare/workers/not-found/deployments"
    )

    assert response.status_code == 404

    body = response.json()

    assert "not found" in body["detail"].lower()
