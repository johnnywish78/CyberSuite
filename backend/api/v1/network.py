"""
CloudPilot — Network Checker API v1.

Local network diagnostics for the desktop application: clean-IP scan,
domain checker, DNS latency test, VLESS config modifier and SNI spoof
check.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.providers.network.akamai import AkamaiScanner, AkamaiScanError
from backend.providers.network.checker import (
    CleanIpChecker,
    CleanIpError,
    ScanOptions,
)
from backend.providers.network.diagnostics import Diagnostics, DiagnosticsError
from backend.providers.network.dns import DnsLatencyTester
from backend.providers.network.dns_hunter import DnsHunter, DnsHunterError
from backend.providers.network.domains import (
    DEFAULT_DOMAINS,
    DomainChecker,
    DomainCheckerError,
)
from backend.providers.network.netlify import NetlifyError, generate_netlify_configs
from backend.providers.network.sni import SniSpoofChecker
from backend.providers.network.vless import (
    VlessModifierError,
    modify_vless,
    parse_clean_ips,
)
from backend.providers.network.xray_scan import XrayScanner, XrayScannerError

router = APIRouter(
    prefix="/api/v1/network",
    tags=["network-v1"],
)


class ScanRequest(BaseModel):
    ranges: list[str] = Field(default_factory=list)
    snis: list[str] = Field(default_factory=list)
    sample_size: int = Field(
        default=512,
        ge=8,
        le=8192,
    )
    concurrency: int = Field(
        default=128,
        ge=1,
        le=512,
    )
    timeout: float = Field(
        default=3.0,
        ge=0.5,
        le=15.0,
    )


class DomainCheckRequest(BaseModel):
    domains: list[str] = Field(default_factory=list)
    timeout: float = Field(
        default=4.0,
        ge=1.0,
        le=15.0,
    )


class DnsTestRequest(BaseModel):
    servers: list[dict[str, str]] = Field(default_factory=list)
    timeout: float = Field(
        default=4.0,
        ge=1.0,
        le=15.0,
    )


class VlessModifyRequest(BaseModel):
    configs: list[str] = Field(default_factory=list)
    ips: list[str] = Field(default_factory=list)


class SniCheckRequest(BaseModel):
    host: str = Field(default="", max_length=255)
    decoy: str = Field(default="", max_length=255)


class DnsHuntRequest(BaseModel):
    domains: list[str] = Field(default_factory=list)
    timeout: float = Field(
        default=4.0,
        ge=1.0,
        le=15.0,
    )


class XrayScanRequest(BaseModel):
    config: str = Field(default="", max_length=100000)
    ranges: list[str] = Field(default_factory=list)
    sample_size: int = Field(
        default=512,
        ge=8,
        le=8192,
    )
    concurrency: int = Field(
        default=128,
        ge=1,
        le=512,
    )
    timeout: float = Field(
        default=3.0,
        ge=0.5,
        le=15.0,
    )


class AkamaiScanRequest(BaseModel):
    ranges: list[str] = Field(default_factory=list)
    sample_size: int = Field(
        default=512,
        ge=8,
        le=8192,
    )
    concurrency: int = Field(
        default=128,
        ge=1,
        le=512,
    )
    timeout: float = Field(
        default=3.0,
        ge=0.5,
        le=15.0,
    )


class NetlifyRequest(BaseModel):
    snis: list[str] = Field(default_factory=list)
    ips: list[str] = Field(default_factory=list)


class DiagnosticsRequest(BaseModel):
    targets: list[str] = Field(default_factory=list)
    timeout: float = Field(
        default=5.0,
        ge=1.0,
        le=15.0,
    )


@router.post("/scan")
async def network_scan(payload: ScanRequest):
    """
    Scan Cloudflare IP ranges from the local internet connection and
    return the reachable ("clean") IPs with their latency.
    """
    options = ScanOptions(
        ranges=[item.strip() for item in payload.ranges if item.strip()],
        snis=[item.strip() for item in payload.snis if item.strip()],
        sample_size=payload.sample_size,
        concurrency=payload.concurrency,
        timeout=payload.timeout,
    )

    try:
        result = await CleanIpChecker(options).scan()
    except CleanIpError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    return {
        "provider": "network-checker",
        "tool": "clean-ip",
        **result,
    }


@router.post("/domain-check")
async def network_domain_check(payload: DomainCheckRequest):
    """
    Probe whether the given domains are reachable over TLS from the
    local connection. Uses well-known domains when none are provided.
    """
    try:
        result = await DomainChecker(timeout=payload.timeout).check(
            payload.domains
        )
    except DomainCheckerError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    return {
        "provider": "network-checker",
        "tool": "domain-checker",
        **result,
    }


@router.get("/domain-check/defaults")
async def network_domain_defaults():
    """
    Return the default domain list used by the domain checker.
    """
    return {
        "provider": "network-checker",
        "tool": "domain-checker",
        "domains": list(DEFAULT_DOMAINS),
    }


@router.post("/dns-test")
async def network_dns_test(payload: DnsTestRequest):
    """
    Measure DNS query latency for the well-known DNS providers.
    """
    try:
        result = await DnsLatencyTester(timeout=payload.timeout).test(
            payload.servers or None
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"DNS latency test failed: {exc}",
        ) from exc

    return {
        "provider": "network-checker",
        "tool": "dns-latency",
        **result,
    }


@router.post("/vless-modify")
async def network_vless_modify(payload: VlessModifyRequest):
    """
    Replace the address of each vless:// config with every supplied
    clean IP and return the generated configs.
    """
    ips = parse_clean_ips(payload.ips)

    try:
        outputs = modify_vless(payload.configs, ips)
    except VlessModifierError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    return {
        "provider": "network-checker",
        "tool": "vless-modifier",
        "clean_ips": ips,
        "count": sum(item.get("count", 0) for item in outputs),
        "outputs": outputs,
    }


@router.post("/sni-check")
async def network_sni_check(payload: SniCheckRequest):
    """
    Check whether SNI spoofing is possible on the local connection.
    """
    try:
        result = await SniSpoofChecker().check(
            payload.host,
            payload.decoy,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"SNI spoof check failed: {exc}",
        ) from exc

    return {
        "provider": "network-checker",
        "tool": "sni-spoof",
        **result,
    }


@router.post("/dns-hunt")
async def network_dns_hunt(payload: DnsHuntRequest):
    """
    Ask Iranian DNS providers how they resolve a given domain.
    """
    try:
        result = await DnsHunter(timeout=payload.timeout).hunt(
            payload.domains
        )
    except DnsHunterError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    return {
        "provider": "network-checker",
        "tool": "dns-hunter",
        **result,
    }


@router.post("/xray-scan")
async def network_xray_scan(payload: XrayScanRequest):
    """
    Scan CDN IP ranges against an Xray JSON config and return the
    reachable IPs.
    """
    try:
        result = await XrayScanner(
            ranges=payload.ranges,
            sample_size=payload.sample_size,
            concurrency=payload.concurrency,
            timeout=payload.timeout,
        ).scan(payload.config)
    except XrayScannerError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    return {
        "provider": "network-checker",
        "tool": "cdn-xray-scanner",
        **result,
    }


@router.get("/xray-scan/ranges")
async def network_xray_ranges():
    """
    Return the default CDN IP ranges used by the Xray scanner.
    """
    from backend.providers.network.xray_scan import XRAY_DEFAULT_RANGES

    return {
        "provider": "network-checker",
        "tool": "cdn-xray-scanner",
        "ranges": list(XRAY_DEFAULT_RANGES),
    }


@router.post("/akamai-scan")
async def network_akamai_scan(payload: AkamaiScanRequest):
    """
    Scan Akamai edge IP ranges and return the reachable IPs.
    """
    try:
        result = await AkamaiScanner(
            ranges=payload.ranges,
            sample_size=payload.sample_size,
            concurrency=payload.concurrency,
            timeout=payload.timeout,
        ).scan()
    except AkamaiScanError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    return {
        "provider": "network-checker",
        "tool": "akamai-scanner",
        **result,
    }


@router.get("/akamai-scan/ranges")
async def network_akamai_ranges():
    """
    Return the default Akamai IP ranges.
    """
    from backend.providers.network.akamai import AKAMAI_RANGES

    return {
        "provider": "network-checker",
        "tool": "akamai-scanner",
        "ranges": list(AKAMAI_RANGES),
    }


@router.post("/netlify")
async def network_netlify(payload: NetlifyRequest):
    """
    Generate netlify.toml configs from SNIs and IPs.
    """
    try:
        configs = generate_netlify_configs(payload.snis, payload.ips)
    except NetlifyError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    return {
        "provider": "network-checker",
        "tool": "netlify-config",
        "count": len(configs),
        "configs": configs,
    }


@router.post("/diagnostics")
async def network_diagnostics(payload: DiagnosticsRequest):
    """
    Run a battery of automated network tests.
    """
    try:
        result = await Diagnostics(timeout=payload.timeout).run(
            payload.targets
        )
    except DiagnosticsError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    return {
        "provider": "network-checker",
        "tool": "diagnostics",
        **result,
    }
