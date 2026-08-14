"""
Service layer tests.

These exercise the orchestration and result-normalization rules of
`backend.services.*` directly with fake providers, independently of
FastAPI and the HTTP layer.
"""

import asyncio

from backend.services import bpb_service, cloudflare_service, railway_service
from backend.providers.cloudflare.provider import CloudflareProviderError
from backend.providers.railway.provider import RailwayRelayError, RelayOptions


class FakeCloudflareProvider:
    account_id = "account-abc"

    async def status(self):
        return {
            "authenticated": True,
            "token_status": "active",
            "account_id": self.account_id,
        }

    async def list_workers(self):
        return [{"name": "worker-a", "account_id": self.account_id}]

    async def get_worker(self, worker_name):
        if worker_name != "worker-a":
            raise CloudflareProviderError(
                "Worker not found", code="not_found"
            )
        return {"name": "worker-a", "account_id": self.account_id}

    async def list_deployments(self, worker_name):
        return [{"deployment_id": "dep-1", "status": "active"}]


class FakeRailwayProvider:
    async def whoami(self):
        return {"id": "user-1", "name": "Tester"}

    async def regions(self):
        return [{"name": "us-west2", "country": "US"}]

    async def deploy(self, relay_name, options=None, api_token=""):
        return {"relay_name": relay_name, "domain": "demo.up.railway.app"}

    async def deployments(self):
        return [{"relay_name": "relay-1"}]

    async def get(self, relay_name):
        return {"relay_name": relay_name} if relay_name == "relay-1" else None

    async def refresh_deployment(self, relay_name):
        if relay_name != "relay-1":
            raise RailwayRelayError(
                f"Relay '{relay_name}' was not found.", step="not_found"
            )
        return {"relay_name": relay_name, "status": "deploying"}

    async def debug_status(self, relay_name):
        return {"relay_name": relay_name, "status_code": 200}

    async def delete(self, relay_name):
        return relay_name == "relay-1"


class FakeBpbProvider:
    async def deploy(self, worker_name, options=None):
        return {
            "worker_name": worker_name,
            "account_id": "account-abc",
            "workers_dev_url": f"https://{worker_name}.example.workers.dev",
        }

    async def deployments(self):
        return [{"worker_name": "panel-1"}]

    async def get(self, worker_name):
        return (
            {"worker_name": worker_name, "account_id": "account-abc"}
            if worker_name == "panel-1"
            else None
        )

    async def tail_logs(self, account_id, worker_name):
        return {"worker_name": worker_name, "exceptions": [], "console": []}


def test_cloudflare_status_result():
    provider = FakeCloudflareProvider()

    async def run():
        return await cloudflare_service.get_status(provider)

    result = asyncio.run(run())

    assert result["provider"] == "cloudflare"
    assert result["authenticated"] is True
    assert result["account_id"] == "account-abc"


def test_cloudflare_list_workers_counts():
    provider = FakeCloudflareProvider()

    async def run():
        return await cloudflare_service.list_workers(provider)

    result = asyncio.run(run())

    assert result["account_id"] == "account-abc"
    assert result["count"] == 1
    assert result["workers"][0]["name"] == "worker-a"


def test_cloudflare_get_worker_normalizes():
    provider = FakeCloudflareProvider()

    async def run():
        return await cloudflare_service.get_worker(provider, "worker-a")

    result = asyncio.run(run())

    assert result["provider"] == "cloudflare"
    assert result["worker"]["name"] == "worker-a"


def test_cloudflare_get_worker_missing_raises_not_found():
    provider = FakeCloudflareProvider()

    async def run():
        await cloudflare_service.get_worker(provider, "missing")

    try:
        asyncio.run(run())
        raise AssertionError("expected CloudflareProviderError")
    except CloudflareProviderError as exc:
        assert exc.code == "not_found"


def test_cloudflare_list_deployments_counts():
    provider = FakeCloudflareProvider()

    async def run():
        return await cloudflare_service.list_deployments(provider, "worker-a")

    result = asyncio.run(run())

    assert result["provider"] == "cloudflare"
    assert result["worker_name"] == "worker-a"
    assert result["count"] == 1
    assert result["deployments"][0]["deployment_id"] == "dep-1"


def test_cloudflare_config_state_has_no_secrets():
    result = cloudflare_service.get_config()

    assert result["provider"] == "cloudflare"
    assert result["configured"] in (True, False)
    assert result["account_id_configured"] in (True, False)
    assert result["api_token_configured"] in (True, False)
    assert "api_token" not in result
    assert "account_id" not in result


def test_railway_status_result():
    provider = FakeRailwayProvider()

    async def run():
        return await railway_service.get_status(provider)

    result = asyncio.run(run())

    assert result["provider"] == "railway"
    assert result["authenticated"] is True
    assert result["account"]["name"] == "Tester"


def test_railway_regions_counts():
    provider = FakeRailwayProvider()

    async def run():
        return await railway_service.get_regions(provider)

    result = asyncio.run(run())

    assert result["provider"] == "railway"
    assert result["count"] == 1
    assert result["regions"][0]["name"] == "us-west2"


def test_railway_deploy_passes_options():
    provider = FakeRailwayProvider()
    options = RelayOptions(
        target_domain="https://1.2.3.4:443",
        relay_key="my-key",
    )

    async def run():
        return await railway_service.deploy(
            provider, "relay-1", options, api_token="tok"
        )

    result = asyncio.run(run())

    assert result["provider"] == "railway"
    assert result["deployment"]["domain"] == "demo.up.railway.app"


def test_railway_get_deployment_returns_none_when_missing():
    provider = FakeRailwayProvider()

    async def run():
        return await railway_service.get_deployment(provider, "missing")

    result = asyncio.run(run())

    assert result["deployment"] is None


def test_railway_delete_flags_missing():
    provider = FakeRailwayProvider()

    async def run():
        return await railway_service.delete(provider, "missing")

    result = asyncio.run(run())

    assert result["deleted"] is True
    assert result["removed"] is False


def test_railway_debug_spreads_result():
    provider = FakeRailwayProvider()

    async def run():
        return await railway_service.debug(provider, "relay-1")

    result = asyncio.run(run())

    assert result["provider"] == "railway"
    assert result["status_code"] == 200


def test_railway_redeploy_raises_not_found():
    provider = FakeRailwayProvider()

    async def run():
        await railway_service.redeploy(provider, "missing")

    try:
        asyncio.run(run())
        raise AssertionError("expected RailwayRelayError")
    except RailwayRelayError as exc:
        assert exc.step == "not_found"


def test_railway_config_state_has_no_secrets():
    result = railway_service.get_config()

    assert result["provider"] == "railway"
    assert result["configured"] in (True, False)
    assert "api_token" not in result


def test_bpb_deploy_normalizes():
    provider = FakeBpbProvider()

    async def run():
        return await bpb_service.deploy(provider, "panel-1", None)

    result = asyncio.run(run())

    assert result["provider"] == "bpb"
    assert result["deployment"]["account_id"] == "account-abc"


def test_bpb_list_deployments_counts():
    provider = FakeBpbProvider()

    async def run():
        return await bpb_service.list_deployments(provider)

    result = asyncio.run(run())

    assert result["provider"] == "bpb"
    assert result["count"] == 1
    assert result["deployments"][0]["worker_name"] == "panel-1"


def test_bpb_get_deployment_returns_none_when_missing():
    provider = FakeBpbProvider()

    async def run():
        return await bpb_service.get_deployment(provider, "missing")

    result = asyncio.run(run())

    assert result["deployment"] is None


def test_bpb_tail_logs_spreads_result():
    provider = FakeBpbProvider()

    async def run():
        return await bpb_service.tail_logs(provider, "acc-1", "panel-1")

    result = asyncio.run(run())

    assert result["provider"] == "bpb"
    assert result["worker_name"] == "panel-1"