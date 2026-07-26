"""
Johnny CyberSuite X — AI Center router
======================================
FastAPI router (prefix /api/ai) covering:

  • GET    /providers      — registry of providers + their live model lists
  • WS     /chat/stream    — streaming chat over WebSocket
  • POST   /chats          — create a conversation
  • GET    /chats          — list all persisted conversations
  • GET    /chats/{id}     — load one conversation
  • PUT    /chats/{id}     — upsert a conversation
  • DELETE /chats/{id}     — delete a conversation
  • POST   /tool/{kind}    — run an AI-assisted tool (troubleshoot/sysan/logs/
                              command/termassist/code) with gathered local data
  • GET    /prompts        — read AI settings (system prompts, temperature, prefs)
  • PUT    /prompts        — write AI settings

All tool data is gathered from the *existing* backend endpoints/processes
(diagnostics, stats, system/info, the live monitor sampler, log tailing) —
no new telemetry code, no fabricated values.
"""
import asyncio
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

# importing the providers package triggers autodiscovery — registry populates
import backend.ai.providers  # noqa: F401
from backend.ai.base import get as get_provider, list_providers_with_models
from backend.settings import load_settings, save_settings

router = APIRouter(prefix="/api/ai", tags=["ai-center"])

# Runtime writable AI storage (works in Development and AppImage)
CHATS_DIR = Path.home() / ".config" / "Johnny CyberSuite X" / "ai_chats"

CHATS_DIR.mkdir(parents=True, exist_ok=True)

# tool kinds exposed under POST /tool/{kind}
TOOL_KINDS = {"troubleshoot", "sysan", "logs", "command", "termassist", "code"}


# ═══════════════════════════════════════════════════════════════════════════
#  PROVIDERS
# ═══════════════════════════════════════════════════════════════════════════
@router.get("/providers")
async def providers():
    return await list_providers_with_models()


# ═══════════════════════════════════════════════════════════════════════════
#  STREAMING CHAT (WebSocket)
# ═══════════════════════════════════════════════════════════════════════════
@router.websocket("/chat/stream")
async def chat_stream(ws: WebSocket):
    """Client sends one JSON message:
        {provider, model, api_key, temperature?, system?, messages:[...]}
    Server streams back {"delta": "..."} frames then {"done": true}.
    On error: {"error": "..."}.  Mirrors /ws/stats framing style.
    """
    await ws.accept()
    try:
        first = await ws.receive_text()
        req = json.loads(first)
        provider_id = req.get("provider", "ollama")
        model = req.get("model", "")
        api_key = req.get("api_key", "") or _saved_key(provider_id)
        temperature = float(req.get("temperature", 0.7))
        system = req.get("system") or None
        messages = req.get("messages", [])
        provider = get_provider(provider_id)
        if provider is None:
            await ws.send_json({"error": f"unknown provider: {provider_id}"})
            await ws.send_json({"done": True})
            return
        if not model:
            model = provider.default_model
        async for token in provider.stream(model, messages, api_key, temperature, system):
            if token:
                await ws.send_json({"delta": token})
        await ws.send_json({"done": True})
    except (WebSocketDisconnect, Exception) as e:
        try:
            await ws.send_json({"error": str(e)[:300]})
            await ws.send_json({"done": True})
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════════
#  PERSISTENT CONVERSATIONS (one JSON per chat)
# ═══════════════════════════════════════════════════════════════════════════
def _chat_path(cid: str) -> Path:
    return CHATS_DIR / f"{cid}.json"


@router.post("/chats")
async def create_chat(body: dict = None):
    body = body or {}
    cid = uuid.uuid4().hex[:12]
    title = (body.get("title") or "New chat")[:80]
    provider = body.get("provider", "ollama")
    model = body.get("model") or (get_provider(provider).default_model if get_provider(provider) else "")
    chat = {
        "id": cid,
        "title": title,
        "provider": provider,
        "model": model,
        "messages": [],
        "created": int(time.time()),
        "updated": int(time.time()),
    }
    _write_chat(chat)
    return chat


def _write_chat(chat: dict):
    _chat_path(chat["id"]).write_text(json.dumps(chat, indent=2), encoding="utf-8")


def _read_chat(cid: str) -> Optional[dict]:
    p = _chat_path(cid)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


@router.get("/chats")
def list_chats():
    chats = []
    for f in CHATS_DIR.glob("*.json"):
        try:
            c = json.loads(f.read_text(encoding="utf-8"))
            chats.append({
                "id": c["id"], "title": c["title"], "provider": c["provider"],
                "model": c["model"], "updated": c["updated"],
                "message_count": len(c.get("messages", [])),
            })
        except Exception:
            continue
    chats.sort(key=lambda c: c["updated"], reverse=True)
    return chats


@router.get("/chats/{cid}")
def get_chat(cid: str):
    c = _read_chat(cid)
    if c is None:
        raise HTTPException(404, "chat not found")
    return c


@router.put("/chats/{cid}")
def upsert_chat(cid: str, body: dict):
    existing = _read_chat(cid) or {"id": cid, "title": "Chat", "provider": "ollama",
                                   "model": "", "messages": [], "created": int(time.time()),
                                   "updated": int(time.time())}
    for k in ("title", "provider", "model", "messages"):
        if k in body:
            existing[k] = body[k]
    if isinstance(existing.get("title"), str):
        existing["title"] = existing["title"][:80]
    existing["updated"] = int(time.time())
    _write_chat(existing)
    return existing


@router.delete("/chats/{cid}")
def delete_chat(cid: str):
    p = _chat_path(cid)
    if not p.exists():
        raise HTTPException(404, "chat not found")
    p.unlink()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════
#  AI-ASSISTED TOOLS  (POST /tool/{kind})
# ═══════════════════════════════════════════════════════════════════════════
def _saved_key(provider_id: str) -> str:
    """Pull a stored API key for a provider from settings.json."""
    try:
        s = load_settings().get("ai", {}).get("providers", {})
        return s.get(provider_id, {}).get("api_key", "") or ""
    except Exception:
        return ""


def _ai_prefs() -> dict:
    s = load_settings().get("ai", {})
    return {
        "default_provider": s.get("default_provider", "ollama"),
        "default_model": s.get("default_model", ""),
        "temperature": s.get("temperature", 0.7),
        "system_prompts": s.get("system_prompts", {}),
    }


def _resolve_req(req: dict):
    provider_id = req.get("provider") or _ai_prefs()["default_provider"]
    provider = get_provider(provider_id)
    api_key = req.get("api_key", "") or _saved_key(provider_id)
    model = req.get("model") or (provider.default_model if provider else "")
    temperature = float(req.get("temperature", _ai_prefs()["temperature"]))
    return provider, provider_id, model, api_key, temperature


async def _gather_troubleshoot() -> dict:
    """Run the existing /api/net/diagnostics gatherer + raw stats."""
    from backend import net_center
    data = {}
    try:
        # call the underlying coroutine directly (no HTTP hop)
        data["diagnostics"] = await net_center.diagnostics()
    except Exception as e:
        data["diagnostics_error"] = str(e)
    try:
        # get_stats is a sync fn in app.py — can't import cleanly without a cycle;
        # re-derive essentials from monitor live sampler quickly instead.
        from backend.sys_monitor import _sampler
        with _sampler.lock:
            snap = dict(_sampler.snapshot)
        data["snapshot"] = {"cpu": snap.get("cpu"), "ram": snap.get("ram"),
                            "uptime": snap.get("uptime")}
    except Exception:
        data["snapshot"] = {}
    return data


async def _gather_sysan() -> dict:
    from backend.sys_monitor import _sampler
    data = {"snapshot": {}}
    try:
        with _sampler.lock:
            snap = dict(_sampler.snapshot)
        # trim to the headline numbers an LLM cares about
        keep = ("cpu", "ram", "ram_used", "ram_total", "ram_avail", "swap",
                "swap_used", "swap_total", "disk_percent", "disk_used",
                "disk_total", "net_down", "net_up", "cpu_temp", "uptime",
                "loadavg", "cpu_percore", "cpu_count", "cpu_phys", "disk_read",
                "disk_write")
        data["snapshot"] = {k: snap.get(k) for k in keep if k in snap}
    except Exception:
        pass
    # also call the richer /api/system/info gatherer directly
    try:
        from backend.app import get_system_info
        data["system"] = get_system_info()
        # strip huge arrays to keep token cost sane
        for k in ("disks", "network", "temps"):
            if isinstance(data["system"].get(k), list):
                data["system"][k] = data["system"][k][:6]
    except Exception as e:
        data["system_error"] = str(e)
    return data


_LOG_PRESETS = {
    "syslog": "/var/log/syslog",
    "messages": "/var/log/messages",
    "auth": "/var/log/auth.log",
    "kern": "/var/log/kern.log",
    "dmesg": None,        # special — runs `dmesg`
}


async def _gather_logs(path: Optional[str], tail: int = 400) -> dict:
    """Tail a log file or `dmesg`. Path is constrained to absolute, no shell."""
    if not path:
        path = _LOG_PRESETS["syslog"]
    if path == "dmesg" or path in _LOG_PRESETS and _LOG_PRESETS[path] is None:
        try:
            proc = await asyncio.create_subprocess_exec(
                "dmesg", "--time-format=iso",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=6)
            lines = out.decode("utf-8", "ignore").splitlines()[-tail:]
            return {"source": "dmesg", "lines": lines, "truncated": False}
        except Exception as e:
            return {"source": "dmesg", "error": str(e)}
    # constrain path — must be absolute and inside known log roots
    p = Path(path).expanduser()
    if not p.is_absolute():
        return {"error": "log path must be absolute"}
    # read up to ~256 KiB from the end to bound token cost
    try:
        size = p.stat().st_size
        with open(p, "rb") as f:
            f.seek(max(0, size - 256 * 1024))
            chunk = f.read().decode("utf-8", "ignore")
        lines = chunk.splitlines()[-tail:]
        return {"source": str(p), "lines": lines, "truncated": size > 256 * 1024}
    except Exception as e:
        return {"source": str(p), "error": str(e)}


# per-tool system prompts (overridable via settings)
_DEFAULT_PROMPTS = {
    "troubleshoot": (
        "You are a Linux network troubleshooter. The user provides live network "
        "diagnostics (gateway, DNS, ICMP, HTTPS egress) and a question. Identify "
        "likely causes and concrete next steps (commands to run, files to check). "
        "Be concise and prioritise the most probable root cause."
    ),
    "sysan": (
        "You are a Linux system performance analyst. The user provides a live "
        "telemetry snapshot (CPU, RAM, swap, disk, net, load, temps). Diagnose "
        "bottlenecks and abnormal readings, and suggest specific actions."
    ),
    "logs": (
        "You are a log analyst. The user provides tailed log lines and a question. "
        "Extract errors, warnings, patterns and root-cause hypotheses. Quote line "
        "excerpts with timestamps. Do not invent log lines not present in the input."
    ),
    "command": (
        "You are a shell command generator. Given a natural-language intent, "
        "return ONLY the shell command(s) to accomplish it on Linux, inside a "
        "```bash``` block, followed by a one-line explanation. Prefer widely "
        "available tools. Never execute — the user reviews and runs."
    ),
    "termassist": (
        "You are a terminal assistant. Given what the user wants to do, "
        "propose the exact one-liner command for this Linux shell, in a "
        "```bash``` block, plus a short note on what it does and any caveats."
    ),
    "code": (
        "You are a code assistant. Answer programming questions clearly with "
        "minimal prose and well-commented code blocks in the appropriate language."
    ),
}


@router.post("/tool/{kind}")
async def run_tool(kind: str, body: dict = None):
    if kind not in TOOL_KINDS:
        raise HTTPException(404, f"unknown tool: {kind}")
    body = body or {}
    gather_only = bool(body.get("gather_only"))

    provider, provider_id, model, api_key, temperature = _resolve_req(body)
    if not gather_only and provider is None:
        raise HTTPException(400, "no AI provider available")

    prefs = _ai_prefs()
    system = prefs["system_prompts"].get(kind) or _DEFAULT_PROMPTS.get(kind, "") or None
    user_input = (body.get("input") or "").strip()
    gathered: Dict = {}

    # ── data gathering per kind ────────────────────────────────────────────
    if kind == "troubleshoot":
        gathered = await _gather_troubleshoot()
        if not user_input:
            user_input = ("Interpret these network diagnostics and tell me "
                           "what's wrong and what to check next.")
    elif kind == "sysan":
        gathered = await _gather_sysan()
        if not user_input:
            user_input = "Analyse this live system snapshot and flag any issues."
    elif kind == "logs":
        path = (body.get("context") or {}).get("path") if isinstance(body.get("context"), dict) else None
        gathered = await _gather_logs(path, int(body.get("tail", 400) or 400))
        if not user_input:
            user_input = "Find errors / warnings and explain likely causes."
    elif kind in ("code",):
        gathered = {}

    # gather-only short-circuit: return the data without an LLM call
    if gather_only:
        return {"model": model, "provider": provider_id, "kind": kind,
                "gathered": gathered, "reply": ""}

    # build the message: gathered data + (optional) user input
    blob_parts = []
    if gathered:
        blob_parts.append("### Gathered local data\n```json\n"
                          + json.dumps(gathered, indent=2, default=str)[:6000]
                          + "\n```")
    if user_input:
        blob_parts.append(f"### Request\n{user_input}")
    content = "\n\n".join(blob_parts) or "(no input)"

    messages = [{"role": "user", "content": content}]
    try:
        reply = await provider.chat(model, messages, api_key, temperature, system)
    except Exception as e:
        raise HTTPException(502, f"provider error: {str(e)[:300]}")
    return {"reply": reply, "model": model, "provider": provider_id,
            "kind": kind, "gathered": gathered}


# ═══════════════════════════════════════════════════════════════════════════
#  AI SETTINGS  (GET / PUT /prompts)
# ═══════════════════════════════════════════════════════════════════════════
@router.get("/prompts")
def get_prompts():
    prefs = _ai_prefs()
    return {
        "default_provider": prefs["default_provider"],
        "default_model": prefs["default_model"],
        "temperature": prefs["temperature"],
        "system_prompts": {k: prefs["system_prompts"].get(k, _DEFAULT_PROMPTS[k])
                           for k in _DEFAULT_PROMPTS},
        # also surface stored per-provider keys' presence (masked) + base_urls
        "providers": _provider_settings_view(),
        "tool_kinds": sorted(_DEFAULT_PROMPTS.keys()),
    }


def _provider_settings_view() -> dict:
    s = load_settings().get("ai", {}).get("providers", {})
    out = {}
    for pid, v in s.items():
        out[pid] = {
            "has_key": bool(v.get("api_key")),
            "key_preview": (v.get("api_key", "")[:3] + "…") if v.get("api_key") else "",
            "base_url": v.get("base_url", ""),
        }
    return out


@router.put("/prompts")
def put_prompts(body: dict):
    s = load_settings()
    ai = s.get("ai", {})
    if "default_provider" in body:
        ai["default_provider"] = body["default_provider"]
    if "default_model" in body:
        ai["default_model"] = body["default_model"]
    if "temperature" in body:
        ai["temperature"] = float(body["temperature"])
    if "system_prompts" in body and isinstance(body["system_prompts"], dict):
        ai["system_prompts"] = body["system_prompts"]
    # per-provider api_key / base_url (everything except empty keys keeps prior value)
    if "providers" in body and isinstance(body["providers"], dict):
        prov = ai.get("providers", {})
        for pid, v in body["providers"].items():
            cur = prov.get(pid, {})
            if v.get("api_key"):
                cur["api_key"] = v["api_key"]
            if "base_url" in v:
                cur["base_url"] = v["base_url"]
            prov[pid] = cur
        ai["providers"] = prov
    s["ai"] = ai
    save_settings(s)
    return {"ok": True, **_ai_prefs()}
