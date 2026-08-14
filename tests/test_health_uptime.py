"""
Health endpoint uptime contract tests.

The health response shape is fixed; these tests lock in the uptime
fields and the guarantee that uptime never appears negative and never
decreases between consecutive polls.
"""

import datetime as dt

from fastapi.testclient import TestClient

from backend.app import app

client = TestClient(app)


def test_health_uptime_fields_present():
    body = client.get("/api/health").json()

    assert "uptime_seconds" in body
    assert "started_at" in body

    uptime = body["uptime_seconds"]

    assert isinstance(uptime, (int, float))
    assert uptime >= 0


def test_health_started_at_is_valid_utc_timestamp():
    body = client.get("/api/health").json()

    started_at = body["started_at"]

    parsed = dt.datetime.strptime(started_at, "%Y-%m-%dT%H:%M:%SZ")

    assert parsed.tzinfo is None


def test_health_uptime_never_decreases():
    first = client.get("/api/health").json()
    second = client.get("/api/health").json()

    assert second["uptime_seconds"] >= first["uptime_seconds"]
    assert second["started_at"] == first["started_at"]


def test_health_service_identity():
    body = client.get("/api/health").json()

    assert body["status"] == "ok"
    assert body["service"] == "cloudpilot-backend"
    assert body["version"] != ""