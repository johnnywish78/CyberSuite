"""
CloudPilot — BPB Panel worker script builder.

Replicates the injection logic the BPB-Wizard applies:
random VLESS UUID, Trojan password and secure path are
embedded into the worker module as `EMBEDED_SETTINGS`.
"""

from __future__ import annotations

import base64
import gzip
import json
import random
import re
import secrets
import string
import uuid
from datetime import datetime, timezone

import requests

from backend.providers.bpb.settings import EmbeddedSettings
from backend.settings import cloudflare_proxies

PANEL_NAME = "Wish K E"
PANEL_TITLE = "Wish K E panel"

WORKER_SOURCE_URL = (
    "https://github.com/bia-pain-bache/BPB-Worker-Panel"
    "/releases/latest/download/worker.js"
)

_PASSWORD_CHARSET = string.ascii_letters + string.digits + "!@$&*_-+;:,."
_PATH_CHARSET = string.ascii_letters + string.digits + "0-_"
_SUBDOMAIN_CHARSET = string.ascii_lowercase + string.digits + "-"
_CODE_CHARSET = string.ascii_lowercase + string.digits


class ScriptBuildError(RuntimeError):
    """Failed to obtain or assemble the BPB worker script."""


def fetch_worker_script(
    *,
    timeout: float = 60.0,
    attempts: int = 3,
) -> bytes:
    """Download the latest BPB worker module."""
    last_error: requests.RequestException | None = None

    for attempt in range(attempts):
        try:
            response = requests.get(
                WORKER_SOURCE_URL,
                timeout=timeout,
                proxies=cloudflare_proxies() or None,
            )
            response.raise_for_status()

            if not response.content:
                raise ScriptBuildError(
                    "BPB worker script download returned empty content."
                )

            return response.content
        except requests.RequestException as exc:
            last_error = exc

    raise ScriptBuildError(
        f"Failed to fetch BPB worker script: {last_error}"
    )

    if not response.content:
        raise ScriptBuildError(
            "BPB worker script download returned empty content."
        )

    return response.content


def validate_worker_module(script: bytes) -> None:
    """Reject payloads that do not look like the BPB worker module."""
    sample = script[:4096].decode("utf-8", errors="replace")

    if "Object.assign(globalThis" not in sample:
        raise ScriptBuildError(
            "Downloaded worker does not look like the BPB Panel module."
        )


_HTML_KEYS = (
    "LOGIN_HTML_CONTENT",
    "PANEL_HTML_CONTENT",
    "ERROR_HTML_CONTENT",
    "PROXY_IP_HTML_CONTENT",
)


def _patch_embedded_html(script_text: str) -> str:
    """Rename every visible panel brand inside the compressed HTML payloads.

    The worker ships its UI templates gzip+base64 encoded. Each one is
    decompressed, its user-facing ``BPB`` strings replaced with the
    CloudPilot panel name, then re-compressed and swapped back in.
    """
    keys = "|".join(_HTML_KEYS)
    pattern = re.compile(rf'"({keys})\\?"\s*:\s*"([A-Za-z0-9+/=]+)"')

    def replace_content(match: re.Match) -> str:
        key, raw = match.group(1), match.group(2)

        try:
            html = gzip.decompress(base64.b64decode(raw)).decode(
                "utf-8", errors="replace"
            )
        except (OSError, ValueError):
            return match.group(0)

        html = (
            html
            .replace("BPB Panel", PANEL_TITLE)
            .replace("BPB Logo", f"{PANEL_NAME} Logo")
            .replace("BPB", PANEL_NAME)
            .replace(PANEL_NAME + PANEL_TITLE, PANEL_TITLE)
            .replace(PANEL_NAME + f" {PANEL_NAME}", PANEL_NAME)
        )

        encoded = base64.b64encode(
            gzip.compress(html.encode("utf-8"))
        ).decode("ascii")

        return f'"{key}":"{encoded}"'

    return pattern.sub(replace_content, script_text)


def _patch_worker_module(script: bytes) -> bytes:
    """Apply the CloudPilot branding to a freshly downloaded worker.

    Replaces the internal ``BPB`` / ``bpb`` project constants (which
    drive the panel title, subscription names and downloaded file names)
    with the Wish K E branding.
    """
    text = script.decode("utf-8", errors="replace")

    project_name = base64.b64encode(PANEL_NAME.encode()).decode()
    project_small = base64.b64encode("wish-ke".encode()).decode()

    text = text.replace(
        '_project_:atob("QlBC")',
        f'_project_:atob("{project_name}")',
    )
    text = text.replace(
        '_project_SM_:atob("YnBi")',
        f'_project_SM_:atob("{project_small}")',
    )

    text = _patch_embedded_html(text)

    return text.encode("utf-8")


def generate_uuid() -> str:
    return str(uuid.uuid4())


def random_string(
    charset: str,
    min_length: int,
    max_length: int,
) -> str:
    length = random.randint(min_length, max_length)
    return "".join(secrets.choice(charset) for _ in range(length))


def generate_trojan_password() -> str:
    return random_string(_PASSWORD_CHARSET, 16, 32)


def generate_secure_path() -> str:
    return random_string(_PATH_CHARSET, 16, 32)


def generate_subdomain() -> str:
    while True:
        candidate = random_string(_SUBDOMAIN_CHARSET, 16, 32)
        if not candidate.startswith("-") and not candidate.endswith("-"):
            return candidate


def generate_junk_code() -> str:
    """Random decoy code injected before the settings, like the wizard."""
    var_count = random.randint(50, 500)
    func_count = random.randint(50, 500)

    parts: list[str] = []

    for index in range(var_count):
        name = f"__var_{random_string(_CODE_CHARSET, 8, 16)}_{index}"
        parts.append(f"let {name} = {random.randint(0, 99999)};")

    for index in range(func_count):
        name = f"__func_{random_string(_CODE_CHARSET, 8, 16)}_{index}"
        parts.append(f"function {name}() {{ return {random.randint(0, 999)}; }}")

    return "\n".join(parts) + "\n"


def build_script(
    worker_module: bytes,
    settings: EmbeddedSettings,
) -> bytes:
    """Prepend the header comment + decoy code + EMBEDED_SETTINGS."""
    build_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    header = (
        f"// {settings.accEmail}\n"
        f"// {build_time}\n"
        "// @ts-nocheck\n"
    )

    prefix = (
        header
        + generate_junk_code()
        + f"const EMBEDED_SETTINGS = {json.dumps(settings.to_dict())};\n"
    )

    return prefix.encode("utf-8") + _patch_worker_module(worker_module)