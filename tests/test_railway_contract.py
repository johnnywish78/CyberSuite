from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import app
from backend.api.v1 import railway


class FakeRailwayProvider:
    def __init__(self, client=None):
        pass

    async def whoami(self):
        return {
            "id": "user-123",
            "name": "Test User",
            "email": "demo@example.com",
            "username": "demo",
        }

    async def regions(self):
        return [
            {
                "name": "us-west2",
                "country": "US",
                "location": "California",
            },
            {
                "name": "europe-west4",
                "country": "NL",
                "location": "Amsterdam",
            },
        ]

    async def deploy(self, relay_name, options=None, api_token=""):
        return {
            "deploy_method": "railway-up",
            "source_repo": "avacocloud/avaco-railway",
            "relay_name": relay_name,
            "project_id": "project-123",
            "environment_id": "env-123",
            "service_id": "service-123",
            "deployment_id": "dep-123",
            "domain": "demo.up.railway.app",
            "host": "https://demo.up.railway.app",
            "start_command": "node src/index.js",
            "region": "",
            "config": {
                "TARGET_DOMAIN": "https://1.2.3.4:443",
                "PUBLIC_RELAY_PATH": "/api",
                "RELAY_PATH": "/api",
                "UPSTREAM_TIMEOUT_MS": "0",
                "MAX_INFLIGHT": "512",
            },
            "relay_key_set": True,
            "status": "deploying",
            "account_email": "demo@example.com",
            "deployed_at": "2026-08-13T00:00:00Z",
            "warnings": [],
        }

    async def deployments(self):
        return [await self.deploy("avaco-relay")]

    async def get(self, relay_name):
        if relay_name != "avaco-relay":
            return None
        return await self.deploy(relay_name)

    async def delete(self, relay_name):
        return relay_name == "avaco-relay"

    async def refresh_deployment(self, relay_name):
        if relay_name != "avaco-relay":
            from backend.providers.railway.provider import RailwayRelayError
            raise RailwayRelayError(
                f"Relay '{relay_name}' was not found.",
                step="not_found",
            )
        record = await self.deploy(relay_name)
        record["status"] = "deploying"
        return record

    async def debug_status(self, relay_name):
        return {
            "relay_name": relay_name,
            "url": f"https://demo.up.railway.app/__debug",
            "status_code": 200,
            "debug": {
                "TARGET_BASE": "https://1.2.3.4:443",
                "PUBLIC_RELAY_PATH": "/api",
                "RELAY_PATH": "/api",
                "RELAY_KEY_SET": True,
                "UPSTREAM_TIMEOUT_MS": 0,
                "MAX_INFLIGHT": 512,
                "inFlight": 0,
            },
        }


def fake_provider(api_token=""):
    return FakeRailwayProvider()


railway._provider = fake_provider

client = TestClient(app)


def test_railway_config_contract():
    response = client.get("/api/v1/railway/config")

    assert response.status_code == 200
    assert response.json()["provider"] == "railway"


def test_railway_config_save_contract():
    with patch(
        "backend.api.v1.railway.save_railway_credentials",
    ) as save:
        response = client.post(
            "/api/v1/railway/config",
            json={"api_token": "token-xyz"},
        )

        assert response.status_code == 200
        assert response.json()["configured"] is True

        save.assert_called_once_with("token-xyz")


def test_railway_status_contract():
    response = client.get("/api/v1/railway/status")

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "railway"
    assert body["authenticated"] is True
    assert body["account"]["email"] == "demo@example.com"


def test_railway_regions_contract():
    response = client.get("/api/v1/railway/regions")

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "railway"
    assert body["count"] == 2
    assert body["regions"][0]["name"] == "us-west2"


def test_railway_deploy_contract():
    response = client.post(
        "/api/v1/railway/deploy",
        json={
            "relay_name": "avaco-relay",
            "target_domain": "https://1.2.3.4:443",
        },
    )

    assert response.status_code == 200

    body = response.json()
    deployment = body["deployment"]

    assert body["provider"] == "railway"
    assert deployment["relay_name"] == "avaco-relay"
    assert deployment["host"] == "https://demo.up.railway.app"
    assert deployment["config"]["TARGET_DOMAIN"] == "https://1.2.3.4:443"
    assert deployment["relay_key_set"] is True


def test_railway_deploy_contract_with_api_token():
    with patch(
        "backend.api.v1.railway.save_railway_credentials",
    ) as save:
        response = client.post(
            "/api/v1/railway/deploy",
            json={
                "relay_name": "avaco-relay",
                "api_token": "token-xyz",
                "target_domain": "https://1.2.3.4:443",
            },
        )

        assert response.status_code == 200

        save.assert_called_once_with("token-xyz")


def test_railway_deployments_contract():
    response = client.get("/api/v1/railway/deployments")

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "railway"
    assert body["count"] == 1
    assert body["deployments"][0]["relay_name"] == "avaco-relay"


def test_railway_deployment_contract():
    response = client.get("/api/v1/railway/deployments/avaco-relay")

    assert response.status_code == 200

    deployment = response.json()["deployment"]

    assert deployment["relay_name"] == "avaco-relay"
    assert deployment["host"] == "https://demo.up.railway.app"


def test_railway_unknown_deployment_returns_404():
    response = client.get("/api/v1/railway/deployments/not-found")

    assert response.status_code == 404


def test_railway_redeploy_contract():
    response = client.post(
        "/api/v1/railway/deployments/avaco-relay/redeploy"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "railway"
    assert body["deployment"]["relay_name"] == "avaco-relay"
    assert body["deployment"]["status"] == "deploying"


def test_railway_redeploy_unknown_returns_404():
    response = client.post(
        "/api/v1/railway/deployments/not-found/redeploy"
    )

    assert response.status_code == 404


def test_railway_debug_contract():
    response = client.post(
        "/api/v1/railway/deployments/avaco-relay/debug"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "railway"
    assert body["status_code"] == 200
    assert body["debug"]["RELAY_KEY_SET"] is True
    assert body["debug"]["MAX_INFLIGHT"] == 512


def test_railway_delete_contract():
    response = client.delete("/api/v1/railway/deployments/avaco-relay")

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "railway"
    assert body["deleted"] is True
    assert body["relay_name"] == "avaco-relay"


def test_railway_delete_unknown_returns_404():
    response = client.delete("/api/v1/railway/deployments/not-found")

    assert response.status_code == 404
