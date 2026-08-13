from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import app


class FakeCleanIpChecker:
    def __init__(self, options=None):
        self.options = options

    async def scan(self):
        return {
            "scanned": 100,
            "reachable": 2,
            "sni": "speed.cloudflare.com",
            "port": 443,
            "results": [
                {
                    "ip": "104.16.0.1",
                    "latency_ms": 42.5,
                    "sni": "speed.cloudflare.com",
                    "port": 443,
                },
                {
                    "ip": "104.16.0.2",
                    "latency_ms": 88.1,
                    "sni": "speed.cloudflare.com",
                    "port": 443,
                },
            ],
        }


client = TestClient(app)


def test_network_scan_contract():
    with patch(
        "backend.api.v1.network.CleanIpChecker",
        FakeCleanIpChecker,
    ):
        response = client.post(
            "/api/v1/network/scan",
            json={"sample_size": 128},
        )

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "network-checker"
    assert body["scanned"] == 100
    assert body["reachable"] == 2
    assert body["results"][0]["ip"] == "104.16.0.1"
    assert body["results"][0]["latency_ms"] == 42.5


def test_network_scan_invalid_range():
    response = client.post(
        "/api/v1/network/scan",
        json={"ranges": ["not-a-cidr"]},
    )

    assert response.status_code == 400
    assert "Invalid IP range" in response.json()["detail"]


def test_network_scan_rejects_oversized_sample():
    response = client.post(
        "/api/v1/network/scan",
        json={"sample_size": 999999},
    )

    assert response.status_code == 422


class FakeDomainChecker:
    def __init__(self, timeout=4.0):
        self.timeout = timeout

    async def check(self, domains):
        return {
            "checked": 2,
            "reachable": 1,
            "blocked": 1,
            "results": [
                {
                    "domain": "google.com",
                    "reachable": True,
                    "latency_ms": 120.0,
                    "port": 443,
                },
                {
                    "domain": "chatgpt.com",
                    "reachable": False,
                    "latency_ms": None,
                    "port": 443,
                },
            ],
        }


def test_network_domain_check_contract():
    with patch(
        "backend.api.v1.network.DomainChecker",
        FakeDomainChecker,
    ):
        response = client.post(
            "/api/v1/network/domain-check",
            json={"domains": ["google.com", "chatgpt.com"]},
        )

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "network-checker"
    assert body["checked"] == 2
    assert body["reachable"] == 1
    assert body["blocked"] == 1
    assert body["results"][0]["reachable"] is True


def test_network_domain_check_invalid_hostname():
    response = client.post(
        "/api/v1/network/domain-check",
        json={"domains": ["invalid.."]},
    )

    assert response.status_code == 400
    assert "Invalid hostnames" in response.json()["detail"]


def test_network_domain_defaults():
    response = client.get("/api/v1/network/domain-check/defaults")

    assert response.status_code == 200
    assert response.json()["tool"] == "domain-checker"
    assert response.json()["domains"]


class FakeDnsTester:
    def __init__(self, timeout=4.0):
        self.timeout = timeout

    async def test(self, servers=None):
        return {
            "tested": 1,
            "results": [
                {
                    "name": "Google",
                    "ip": "8.8.8.8",
                    "port": 53,
                    "latency_ms": 55.0,
                    "reachable": True,
                    "error": None,
                },
            ],
        }


def test_network_dns_test_contract():
    with patch(
        "backend.api.v1.network.DnsLatencyTester",
        FakeDnsTester,
    ):
        response = client.post(
            "/api/v1/network/dns-test",
            json={},
        )

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "network-checker"
    assert body["tested"] == 1
    assert body["results"][0]["name"] == "Google"


def test_network_vless_modify_contract():
    response = client.post(
        "/api/v1/network/vless-modify",
        json={
            "configs": [
                "vless://uuid@104.26.10.90:443?encryption=none"
                "&security=tls&sni=chatgpt.com&type=ws&path=%2F#My",
            ],
            "ips": ["104.16.0.1", "1.1.1.1"],
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["count"] == 2
    assert body["clean_ips"] == ["104.16.0.1", "1.1.1.1"]
    assert body["outputs"][0]["valid"] is True
    assert body["outputs"][0]["outputs"][0].startswith(
        "vless://uuid@104.16.0.1:443"
    )


def test_network_vless_modify_invalid_config():
    response = client.post(
        "/api/v1/network/vless-modify",
        json={
            "configs": ["vless://uuid@104.26.10.90"],
            "ips": ["104.16.0.1"],
        },
    )

    assert response.status_code == 200
    assert response.json()["outputs"][0]["valid"] is False


class FakeSniChecker:
    def __init__(self, timeout=5.0):
        self.timeout = timeout

    async def check(self, host, decoy):
        return {
            "host": host,
            "decoy": decoy,
            "real_sni": 120.0,
            "spoofed_sni": 130.0,
            "spoof_supported": True,
        }


def test_network_sni_check_contract():
    with patch(
        "backend.api.v1.network.SniSpoofChecker",
        FakeSniChecker,
    ):
        response = client.post(
            "/api/v1/network/sni-check",
            json={"host": "chatgpt.com", "decoy": "icloud.com"},
        )

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "network-checker"
    assert body["tool"] == "sni-spoof"
    assert body["spoof_supported"] is True


class FakeDnsHunter:
    def __init__(self, timeout=4.0):
        self.timeout = timeout

    async def hunt(self, domains):
        return {
            "domain": "google.com",
            "checked": 2,
            "results": [
                {
                    "name": "Shecan",
                    "ip": "178.22.122.100",
                    "port": 53,
                    "latency_ms": 40.0,
                    "reachable": True,
                    "resolved": ["142.250.154.139"],
                    "error": None,
                },
                {
                    "name": "Hamrahe Aval",
                    "ip": "172.29.0.100",
                    "port": 53,
                    "latency_ms": None,
                    "reachable": False,
                    "resolved": [],
                    "error": "no answer",
                },
            ],
        }


def test_network_dns_hunt_contract():
    with patch(
        "backend.api.v1.network.DnsHunter",
        FakeDnsHunter,
    ):
        response = client.post(
            "/api/v1/network/dns-hunt",
            json={"domains": ["google.com"]},
        )

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "network-checker"
    assert body["tool"] == "dns-hunter"
    assert body["domain"] == "google.com"
    assert body["results"][0]["resolved"] == ["142.250.154.139"]


class FakeXrayScanner:
    def __init__(self, ranges=None, sample_size=512, concurrency=128, timeout=3.0):
        self.ranges = ranges
        self.sample_size = sample_size
        self.concurrency = concurrency
        self.timeout = timeout

    async def scan(self, config):
        return {
            "address": "chatgpt.com",
            "port": 443,
            "sni": "chatgpt.com",
            "network": "ws",
            "security": "tls",
            "scanned": 64,
            "reachable": 2,
            "results": [
                {"ip": "104.16.0.1", "latency_ms": 42.5},
                {"ip": "104.16.0.2", "latency_ms": 88.1},
            ],
        }


def test_network_xray_scan_contract():
    config = '{"outbounds":[{"protocol":"vless","settings":{"vnext":[{"address":"chatgpt.com","port":443}]}}]}'

    with patch(
        "backend.api.v1.network.XrayScanner",
        FakeXrayScanner,
    ):
        response = client.post(
            "/api/v1/network/xray-scan",
            json={"config": config, "sample_size": 64},
        )

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "network-checker"
    assert body["tool"] == "cdn-xray-scanner"
    assert body["sni"] == "chatgpt.com"
    assert body["reachable"] == 2
    assert body["results"][0]["ip"] == "104.16.0.1"


def test_network_xray_scan_invalid_json():
    response = client.post(
        "/api/v1/network/xray-scan",
        json={"config": "not-json"},
    )

    assert response.status_code == 400
    assert "Invalid Xray JSON" in response.json()["detail"]


def test_network_xray_ranges_defaults():
    response = client.get("/api/v1/network/xray-scan/ranges")

    assert response.status_code == 200
    assert response.json()["ranges"]


class FakeAkamaiScanner:
    def __init__(self, ranges=None, sample_size=512, concurrency=128, timeout=3.0):
        self.ranges = ranges
        self.sample_size = sample_size
        self.concurrency = concurrency
        self.timeout = timeout

    async def scan(self, sni="www.akamai.com"):
        return {
            "sni": sni,
            "port": 443,
            "scanned": 64,
            "reachable": 1,
            "results": [{"ip": "23.32.0.1", "latency_ms": 55.0}],
        }


def test_network_akamai_scan_contract():
    with patch(
        "backend.api.v1.network.AkamaiScanner",
        FakeAkamaiScanner,
    ):
        response = client.post(
            "/api/v1/network/akamai-scan",
            json={"sample_size": 64},
        )

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "network-checker"
    assert body["tool"] == "akamai-scanner"
    assert body["results"][0]["ip"] == "23.32.0.1"


def test_network_akamai_ranges_defaults():
    response = client.get("/api/v1/network/akamai-scan/ranges")

    assert response.status_code == 200
    assert response.json()["ranges"]


def test_network_netlify_contract():
    response = client.post(
        "/api/v1/network/netlify",
        json={
            "snis": ["chatgpt.com"],
            "ips": ["104.16.0.1", "1.1.1.1"],
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["count"] == 2
    assert body["configs"][0]["sni"] == "chatgpt.com"
    assert "Netlify" in body["configs"][0]["content"]


def test_network_netlify_invalid_ip():
    response = client.post(
        "/api/v1/network/netlify",
        json={"snis": ["chatgpt.com"], "ips": ["not-an-ip"]},
    )

    assert response.status_code == 400
    assert "Invalid IP" in response.json()["detail"]


class FakeDiagnostics:
    def __init__(self, timeout=5.0):
        self.timeout = timeout

    async def run(self, targets):
        return {
            "duration_ms": 500.0,
            "targets": ["google.com"],
            "dns": {
                "tested": 1,
                "results": [
                    {
                        "name": "Google",
                        "ip": "8.8.8.8",
                        "port": 53,
                        "latency_ms": 55.0,
                        "reachable": True,
                        "error": None,
                    }
                ],
            },
            "sites": [
                {
                    "domain": "google.com",
                    "port": 443,
                    "tcp": 40.0,
                    "tls": 90.0,
                    "resolved": ["142.250.154.139"],
                    "reachable": True,
                }
            ],
        }


def test_network_diagnostics_contract():
    with patch(
        "backend.api.v1.network.Diagnostics",
        FakeDiagnostics,
    ):
        response = client.post(
            "/api/v1/network/diagnostics",
            json={"targets": ["google.com"]},
        )

    assert response.status_code == 200

    body = response.json()

    assert body["provider"] == "network-checker"
    assert body["tool"] == "diagnostics"
    assert body["sites"][0]["tls"] == 90.0


def test_network_diagnostics_invalid_target():
    response = client.post(
        "/api/v1/network/diagnostics",
        json={"targets": ["invalid.."]},
    )

    assert response.status_code == 400
    assert "Invalid hostnames" in response.json()["detail"]
