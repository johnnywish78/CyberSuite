from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import app
from backend.api.v1 import bpb


class FakeBpbProvider:
    async def deploy(self, worker_name, options=None):
        return {
            "deploy_method": "workers",
            "worker_name": worker_name,
            "host": f"{worker_name}.demo.workers.dev",
            "account_id": "test-account-123",
            "account_email": "demo@example.com",
            "kv_namespace_id": "kv-001",
            "compatibility_date": "2026-08-13",
            "panel_url": (
                f"https://{worker_name}.demo.workers.dev/panel-path/panel"
            ),
            "login_url": (
                f"https://{worker_name}.demo.workers.dev/panel-path/login"
            ),
            "subscriptions": {
                "normal": {
                    "xray": (
                        f"https://{worker_name}.demo.workers.dev"
                        "/panel-path/sub/normal?app=xray"
                    )
                }
            },
            "credentials": {
                "vl_uuid": "00000000-0000-0000-0000-000000000000",
                "trojan_password": "trojan-pass",
                "secure_path": "panel-path",
                "proxy_ip_mode": "proxyip",
                "proxy_ips": [],
            },
            "source_url": "https://example.invalid/worker.js",
            "deployed_at": "2026-08-13T00:00:00Z",
        }

    async def deployments(self):
        return [await self.deploy("bpb-panel")]

    async def get(self, worker_name):
        if worker_name != "bpb-panel":
            return None
        return await self.deploy(worker_name)

    async def tail_logs(self, account_id, worker_name):
        return {
            "worker_name": worker_name,
            "events": 1,
            "exceptions": [
                {
                    "name": "TypeError",
                    "message": "Cannot read properties of undefined",
                    "stack": "at request (worker.js:1:1)",
                }
            ],
            "logs": [],
        }


def fake_provider(api_token=""):
    return FakeBpbProvider()


bpb._provider = fake_provider

client = TestClient(app)


def test_bpb_deploy_contract():
    response = client.post(
        "/api/v1/cloudflare/bpb/deploy",
        json={"worker_name": "bpb-panel"},
    )

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "bpb"

    deployment = body["deployment"]

    assert deployment["deploy_method"] == "workers"
    assert deployment["worker_name"] == "bpb-panel"
    assert deployment["host"] == "bpb-panel.demo.workers.dev"
    assert deployment["panel_url"].endswith("/panel")
    assert deployment["credentials"]["vl_uuid"].startswith("00000000-")


def test_bpb_deploy_contract_with_api_token():
    with patch(
        "backend.api.v1.bpb.save_cloudflare_credentials",
    ) as save:
        response = client.post(
            "/api/v1/cloudflare/bpb/deploy",
            json={
                "worker_name": "bpb-panel",
                "api_token": "token-xyz",
            },
        )

        assert response.status_code == 200

        save.assert_called_once_with("test-account-123", "token-xyz")


def test_bpb_deployments_contract():
    response = client.get("/api/v1/cloudflare/bpb/deployments")

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "bpb"
    assert body["count"] == 1
    assert body["deployments"][0]["worker_name"] == "bpb-panel"


def test_bpb_deployment_contract():
    response = client.get(
        "/api/v1/cloudflare/bpb/deployments/bpb-panel"
    )

    assert response.status_code == 200

    deployment = response.json()["deployment"]

    assert deployment["worker_name"] == "bpb-panel"
    assert deployment["login_url"].endswith("/login")


def test_bpb_logs_contract():
    response = client.get(
        "/api/v1/cloudflare/bpb/deployments/bpb-panel/logs"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["worker_name"] == "bpb-panel"
    assert body["events"] == 1
    assert body["exceptions"][0]["name"] == "TypeError"
    assert body["exceptions"][0]["message"].startswith(
        "Cannot read properties"
    )


def test_bpb_unknown_deployment_returns_404():
    response = client.get(
        "/api/v1/cloudflare/bpb/deployments/not-found"
    )

    assert response.status_code == 404


def test_config_save_contract():
    with patch(
        "backend.api.v1.cloudflare.save_cloudflare_credentials",
    ) as save:
        response = client.post(
            "/api/v1/cloudflare/config",
            json={
                "account_id": "account-abc",
                "api_token": "token-xyz",
            },
        )

        assert response.status_code == 200
        assert response.json()["configured"] is True

        save.assert_called_once_with("account-abc", "token-xyz")