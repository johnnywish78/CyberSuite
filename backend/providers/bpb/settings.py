"""
CloudPilot — BPB Panel embedded settings model.

Mirrors the `EMBEDED_SETTINGS` object that the BPB worker
expects to be injected at the top of the deployed script.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class EmbeddedSettings:
    accID: str
    accEmail: str
    apiToken: str
    vlUUID: str
    trPass: str
    securePath: str
    proxyIpMode: str = "proxyip"
    proxyIPs: list[str] = field(default_factory=list)
    prefixes: list[str] = field(default_factory=list)
    fallback: str = ""
    dohUrl: str = ""
    mainDomain: str = ""

    def to_dict(self) -> dict:
        return asdict(self)