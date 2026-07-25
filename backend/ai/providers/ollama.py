"""Ollama (local) provider — httpx against http://localhost:11434.

Discovers installed models live via /api/tags, so the dropdown always
reflects what's actually pulled. No API key required.
"""
from typing import AsyncIterator, Dict, List, Optional

from backend.ai.base import AIProvider, register

OLLAMA_BASE = "http://localhost:11434"


@register
class OllamaProvider(AIProvider):
    id = "ollama"
    name = "Ollama (local)"
    default_model = "llama3"
    needs_key = False
    key_env_hint = "No key needed — run `ollama serve` (localhost:11434)"
    supports_stream = True

    async def models(self) -> List[str]:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=4) as c:
                r = await c.get(f"{OLLAMA_BASE}/api/tags")
                r.raise_for_status()
                data = r.json()
                names = [m.get("name") for m in data.get("models", [])]
                return [n for n in names if n] or [self.default_model]
        except Exception:
            # Ollama not running → return a sensible default so the UI still works
            return [self.default_model, "llama3.1", "mistral", "codellama", "qwen2.5",
                    "deepseek-r1", "phi3"]

    async def chat(self, model, messages, api_key, temperature=0.7, system=None):
        import httpx
        async with httpx.AsyncClient(timeout=300) as c:
            r = await c.post(f"{OLLAMA_BASE}/api/chat", json={
                "model": model, "stream": False, "options": {"temperature": temperature},
                "messages": self._normalize(messages, system),
            })
            r.raise_for_status()
            return r.json()["message"]["content"]

    async def stream(self, model, messages, api_key, temperature=0.7, system=None) -> AsyncIterator[str]:
        import httpx
        async with httpx.AsyncClient(timeout=600) as c:
            async with c.stream("POST", f"{OLLAMA_BASE}/api/chat", json={
                "model": model, "stream": True, "options": {"temperature": temperature},
                "messages": self._normalize(messages, system),
            }) as resp:
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = __import__("json").loads(line)
                        token = chunk.get("message", {}).get("content", "")
                    except Exception:
                        continue
                    if token:
                        yield token
