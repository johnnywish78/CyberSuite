"""Generic OpenAI-compatible provider.

One provider covers every vendor that speaks the OpenAI Chat Completions
schema on a custom base_url (Groq, OpenRouter, Together, Fireworks, LM
Studio, vLLM, Ollama's OpenAI shim, etc.). Concrete vendors usually don't
even need their own file — drop a small subclass that pins a base_url and a
default model:

    # backend/ai/providers/groq.py
    from backend.ai.base import register
    from backend.ai.providers.openai_compat import OpenAICompatProvider
    @register
    class GroqProvider(OpenAICompatProvider):
        id = "groq"; name = "Groq"; default_model = "llama-3.3-70b-versatile"
        def __init__(self): super().__init__(base_url="https://api.groq.com/openai/v1")

But for ad-hoc / self-hosted endpoints you can just select the built-in
"openai-compat" provider in the UI and type the base_url there — no code at
all. The base_url can also be stored in settings.json["ai"]["providers"].
"""
from typing import AsyncIterator, Dict, List, Optional

from backend.ai.base import AIProvider, register


class OpenAICompatProvider(AIProvider):
    id = "openai-compat"
    name = "OpenAI-compatible (custom base URL)"
    default_model = "gpt-4o"
    needs_key = True
    key_env_hint = "Set the base URL below; provider uses Bearer <key>"
    supports_stream = True

    def __init__(self, base_url: str = ""):
        self.base_url = base_url

    def _resolve_base(self) -> str:
        if self.base_url:
            return self.base_url
        # fall back to a settings-supplied URL, else OpenAI's real endpoint
        try:
            from backend.settings import load_settings
            s = load_settings().get("ai", {}).get("providers", {})
            return s.get(self.id, {}).get("base_url") or "https://api.openai.com/v1"
        except Exception:
            return "https://api.openai.com/v1"

    async def models(self) -> List[str]:
        import httpx
        base = self._resolve_base()
        try:
            async with httpx.AsyncClient(timeout=6) as c:
                r = await c.get(f"{base}/models")
                r.raise_for_status()
                ids = [m.get("id") for m in r.json().get("data", [])]
                return sorted([i for i in ids if i]) or [self.default_model]
        except Exception:
            return [self.default_model]

    def _client(self, api_key):
        from openai import AsyncOpenAI
        return AsyncOpenAI(api_key=api_key, base_url=self._resolve_base())

    async def chat(self, model, messages, api_key, temperature=0.7, system=None):
        client = self._client(api_key)
        resp = await client.chat.completions.create(
            model=model, temperature=temperature,
            messages=self._normalize(messages, system))
        return resp.choices[0].message.content or ""

    async def stream(self, model, messages, api_key, temperature=0.7, system=None) -> AsyncIterator[str]:
        client = self._client(api_key)
        stream = await client.chat.completions.create(
            model=model, temperature=temperature, stream=True,
            messages=self._normalize(messages, system))
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta


# Register the base "bring your own base_url" instance too
register(OpenAICompatProvider)
