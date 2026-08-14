"""
API contract tests.

Lock in the stable v1 contract: the health envelope (including `pid`),
truthful "unconfigured" states and the guarantee that credential writes
never echo secrets back to the client.
"""

from fastapi.testclient import TestClient

from backend.app import app
from backend.settings import env_file

client = TestClient(app)


def test_health_envelope_includes_pid():
    body = client.get("/api/health").json()

    assert body["status"] == "ok"
    assert body["service"] == "cloudpilot-backend"
    assert isinstance(body["pid"], int)
    assert body["pid"] > 0


def test_cloudflare_config_unconfigured_is_truthful(monkeypatch):
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("CF_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("CLOUDFLARE_API_TOKEN", raising=False)
    monkeypatch.delenv("CF_API_TOKEN", raising=False)
    monkeypatch.delenv("CLOUDFLARE_PROXY", raising=False)

    body = client.get("/api/v1/cloudflare/config").json()

    assert body["configured"] is False


def test_railway_config_unconfigured_is_truthful(monkeypatch):
    monkeypatch.delenv("RAILWAY_API_TOKEN", raising=False)

    body = client.get("/api/v1/railway/config").json()

    assert body["configured"] is False


def test_cloudflare_config_save_never_echoes_secrets(monkeypatch, tmp_path):
    monkeypatch.setenv("CLOUDPILOT_ENV_FILE", str(tmp_path / ".env"))
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("CLOUDFLARE_API_TOKEN", raising=False)

    response = client.post(
        "/api/v1/cloudflare/config",
        json={"account_id": "acct-contract-1", "api_token": "tok-contract-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert "acct-contract-1" not in response.text
    assert "tok-contract-1" not in response.text
    assert "acct-contract-1" in env_file().read_text(encoding="utf-8")


def test_railway_config_save_never_echoes_secrets(monkeypatch, tmp_path):
    monkeypatch.setenv("CLOUDPILOT_ENV_FILE", str(tmp_path / ".env"))
    monkeypatch.delenv("RAILWAY_API_TOKEN", raising=False)

    response = client.post(
        "/api/v1/railway/config",
        json={"api_token": "railway-contract-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert "railway-contract-1" not in response.text
    assert "railway-contract-1" in env_file().read_text(encoding="utf-8")