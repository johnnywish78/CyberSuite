"""
Configuration ownership tests.

`backend.settings` is the single owner of backend configuration; these
tests lock in defaults, environment overrides and the guarantee that
secrets never leak through config-state helpers.
"""

from backend import settings
from backend.settings import (
    backend_host,
    backend_port,
    cloudflare_config_state,
    cors_origins,
    railway_config_state,
    service_version,
)


def test_service_version_default():
    assert service_version() == "0.1.0"


def test_service_version_env_override(monkeypatch):
    monkeypatch.setenv("CLOUDPILOT_VERSION", "9.9.9")
    assert service_version() == "9.9.9"


def test_backend_host_default():
    assert backend_host() == "127.0.0.1"


def test_backend_host_env_override(monkeypatch):
    monkeypatch.setenv("CLOUDPILOT_BACKEND_HOST", "0.0.0.0")
    assert backend_host() == "0.0.0.0"


def test_backend_port_default():
    assert backend_port() == 8765


def test_backend_port_env_override(monkeypatch):
    monkeypatch.setenv("CLOUDPILOT_BACKEND_PORT", "9999")
    assert backend_port() == 9999


def test_backend_port_invalid_falls_back(monkeypatch):
    monkeypatch.setenv("CLOUDPILOT_BACKEND_PORT", "not-a-number")
    assert backend_port() == 8765


def test_cors_defaults_to_wildcard():
    assert cors_origins() == ["*"]


def test_cors_parses_csv(monkeypatch):
    monkeypatch.setenv(
        "CLOUDPILOT_CORS_ORIGINS", "https://a.example.com, https://b.example.com"
    )
    assert cors_origins() == ["https://a.example.com", "https://b.example.com"]


def test_cors_empty_list(monkeypatch):
    monkeypatch.setenv("CLOUDPILOT_CORS_ORIGINS", "")
    assert cors_origins() == ["*"]


def test_cloudflare_config_state_never_exposes_secrets(monkeypatch):
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "account-123")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "super-secret-token")

    state = cloudflare_config_state()

    assert state["configured"] is True
    assert state["account_id_configured"] is True
    assert state["api_token_configured"] is True

    values = {str(v) for v in state.values()}

    assert "account-123" not in values
    assert "super-secret-token" not in values


def test_cloudflare_config_state_unconfigured(monkeypatch):
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("CF_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("CLOUDFLARE_API_TOKEN", raising=False)
    monkeypatch.delenv("CF_API_TOKEN", raising=False)
    monkeypatch.delenv("CLOUDFLARE_PROXY", raising=False)

    state = cloudflare_config_state()

    assert state["configured"] is False
    assert state["account_id_configured"] is False
    assert state["api_token_configured"] is False


def test_railway_config_state_never_exposes_secrets(monkeypatch):
    monkeypatch.setenv("RAILWAY_API_TOKEN", "railway-secret-token")

    state = railway_config_state()

    assert state["configured"] is True
    assert "railway-secret-token" not in {str(v) for v in state.values()}


def test_settings_helpers_are_importable_as_owner():
    assert settings.get_env is not None
    assert settings.save_cloudflare_credentials is not None
    assert settings.save_railway_credentials is not None
    assert settings.cloudflare_proxies is not None