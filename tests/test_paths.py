"""
Data and config directory tests.

Frozen builds must write state and credentials to platform user
directories (configurable via env overrides) instead of the project
tree. Development keeps the historical project-local behaviour.
"""

from backend import settings
from backend.settings import (
    config_dir,
    data_dir,
    env_file,
    running_from_source,
    save_cloudflare_credentials,
)


def test_running_from_source_in_tests():
    assert running_from_source() is True


def test_development_data_dir_is_project_local():
    assert data_dir() == settings.ROOT_DIR / "backend" / "data"


def test_development_config_dir_is_project_root():
    assert config_dir() == settings.ROOT_DIR


def test_development_env_file_is_project_env():
    assert env_file() == settings.ROOT_DIR / ".env"


def test_data_dir_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("CLOUDPILOT_DATA_DIR", str(tmp_path / "data"))
    assert data_dir() == tmp_path / "data"


def test_config_dir_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("CLOUDPILOT_CONFIG_DIR", str(tmp_path / "config"))
    assert config_dir() == tmp_path / "config"


def test_env_file_env_override(monkeypatch, tmp_path):
    custom = tmp_path / "custom" / ".env"
    monkeypatch.setenv("CLOUDPILOT_ENV_FILE", str(custom))
    assert env_file() == custom


def test_save_credentials_creates_parent_dir(monkeypatch, tmp_path):
    custom = tmp_path / "nested" / "config" / ".env"
    monkeypatch.setenv("CLOUDPILOT_ENV_FILE", str(custom))
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("CLOUDFLARE_API_TOKEN", raising=False)

    save_cloudflare_credentials("acct-1", "tok-1")

    assert custom.exists()
    content = custom.read_text(encoding="utf-8")
    assert "acct-1" in content
    assert "tok-1" in content


def test_stores_live_under_data_dir():
    from backend.providers.bpb.store import _DEFAULT_STORE_PATH
    from backend.providers.railway.store import _DEFAULT_STORE_PATH as rail_path

    assert _DEFAULT_STORE_PATH.parent == data_dir()
    assert rail_path.parent == data_dir()