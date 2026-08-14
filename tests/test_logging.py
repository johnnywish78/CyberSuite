"""
Logging hygiene tests.

The backend must never place secrets (credentials) into log output.
"""

import logging

from fastapi.testclient import TestClient

from backend.app import app
from backend.settings import setup_logging

client = TestClient(app)


def test_backend_logs_never_contain_credentials(monkeypatch, tmp_path, caplog):
    monkeypatch.setenv("CLOUDPILOT_ENV_FILE", str(tmp_path / ".env"))
    setup_logging()

    with caplog.at_level(logging.INFO, logger="cloudpilot.backend"):
        response = client.post(
            "/api/v1/cloudflare/config",
            json={"account_id": "acct-log-1", "api_token": "tok-log-1"},
        )

    assert response.status_code == 200

    for record in caplog.records:
        message = record.getMessage()
        assert "acct-log-1" not in message
        assert "tok-log-1" not in message