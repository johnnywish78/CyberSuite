"""
Johnny CyberSuite X — AI provider registry
==========================================
Pluggable multi-provider AI layer. Each LLM vendor (Anthropic, OpenAI,
Google, local Ollama, any OpenAI-compatible endpoint) ships as its own
file under backend/ai/providers/ decorated with @register. The package
__init__ walks that directory at import time, so adding a new provider
is "drop one file in" — no edits anywhere else.

To add a provider, e.g. Groq:
    # backend/ai/providers/groq.py
    from backend.ai.base import register
    from backend.ai.providers.openai_compat import OpenAICompatProvider
    @register
    class GroqProvider(OpenAICompatProvider):
        id = "groq"; name = "Groq"; default_model = "llama-3.3-70b-versatile"
        def __init__(self): super().__init__(base_url="https://api.groq.com/openai/v1")
Restart → it appears in /api/ai/providers and the UI dropdown.
"""
from __future__ import annotations

import importlib
import pkgutil
from typing import AsyncIterator, Dict, List, Optional


class AIProvider:
    """Abstract base — subclasses set the class attrs and implement chat/stream."""
    id: str = ""
    name: str = ""
    default_model: str = ""
    needs_key: bool = True
    key_env_hint: str = ""          # human hint surfaced in the UI
    supports_stream: bool = True

    # ── contract ───────────────────────────────────────────────────────────
    async def models(self) -> List[str]:
        """Return model list. Static for cloud providers; live for Ollama."""
        return [self.default_model] if self.default_model else []

    async def chat(self, model: str, messages: List[Dict], api_key: str,
                   temperature: float = 0.7, system: Optional[str] = None) -> str:
        raise NotImplementedError

    async def stream(self, model: str, messages: List[Dict], api_key: str,
                     temperature: float = 0.7,
                     system: Optional[str] = None) -> AsyncIterator[str]:
        # default: a single chunk = the whole reply (non-streaming fallback)
        yield await self.chat(model, messages, api_key, temperature, system)

    # ── helpers shared by subclasses ───────────────────────────────────────
    @staticmethod
    def _normalize(messages: List[Dict], system: Optional[str]) -> List[Dict]:
        """Prepend a system message if not already present."""
        out = []
        if system:
            out.append({"role": "system", "content": system})
        return out + list(messages)


# ═══════════════════════════════════════════════════════════════════════════
#  Registry
# ═══════════════════════════════════════════════════════════════════════════
_REGISTRY: Dict[str, "AIProvider"] = {}


def register(cls):
    """Class decorator: instantiate + index by id. Returns the class."""
    inst = cls()
    if not inst.id:
        raise ValueError(f"Provider {cls} must define a non-empty id")
    _REGISTRY[inst.id] = inst
    return cls


def get(provider_id: str) -> Optional["AIProvider"]:
    """Look up a provider; fall back to ollama (no key) when unknown."""
    p = _REGISTRY.get(provider_id)
    if p is None:
        p = _REGISTRY.get("ollama")
    return p


def list_providers() -> List[Dict]:
    """Shape the registry for the UI / GET /api/ai/providers (models fetched sync)."""
    out = []
    for p in _REGISTRY.values():
        out.append({
            "id": p.id,
            "name": p.name,
            "default_model": p.default_model,
            "needs_key": p.needs_key,
            "key_env_hint": p.key_env_hint,
            "supports_stream": p.supports_stream,
            # models() is async; the router resolves them concurrently there
            # and merges, so this field is left empty here.
            "models": [],
        })
    return out


async def list_providers_with_models() -> List[Dict]:
    """Same as list_providers but with each provider's model list populated.
    Each provider's models() is awaited in parallel; failures degrade to a
    single-item list so a broken vendor never hides the others."""
    import asyncio
    ids = list(_REGISTRY.keys())
    results = await asyncio.gather(
        *[_REGISTRY[i].models() for i in ids], return_exceptions=True
    )
    out = []
    for i, models in zip(ids, results):
        p = _REGISTRY[i]
        if isinstance(models, Exception) or not models:
            models = [p.default_model] if p.default_model else []
        out.append({
            "id": p.id, "name": p.name, "default_model": p.default_model,
            "needs_key": p.needs_key, "key_env_hint": p.key_env_hint,
            "supports_stream": p.supports_stream, "models": list(models),
        })
    # stable, friendly order: claude, openai, gemini, ollama, then others
    priority = {"claude": 0, "openai": 1, "gemini": 2, "ollama": 3}
    out.sort(key=lambda p: priority.get(p["id"], 9))
    return out


def _autodiscover():
    """Import every submodule so their @register decorators fire."""
    from backend.ai import providers as pkg  # noqa: import here to load the pkg
    for mod_info in pkgutil.iter_modules(pkg.__path__):
        importlib.import_module(f"backend.ai.providers.{mod_info.name}")
