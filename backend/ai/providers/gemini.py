"""Google Gemini provider — google-generativeai SDK."""
from typing import AsyncIterator, Dict, List, Optional

from backend.ai.base import AIProvider, register


@register
class GeminiProvider(AIProvider):
    id = "gemini"
    name = "Google Gemini"
    default_model = "gemini-1.5-pro"
    needs_key = True
    key_env_hint = "aistudio.google.com — set GOOGLE_API_KEY / GEMINI_API_KEY"
    supports_stream = True

    async def models(self) -> List[str]:
        return ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash",
                "gemini-2.5-pro", "gemini-2.5-flash"]

    def _client(self, api_key, model):
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        return genai.GenerativeModel(model)

    @staticmethod
    def _to_gemini_messages(messages, system):
        """gemini takes a flat contents list; system prompt folded in as a
        leading user/model pair."""
        contents = []
        if system:
            contents.append({"role": "user", "parts": [f"SYSTEM: {system}"]})
            contents.append({"role": "model", "parts": ["Understood."]})
        for m in messages:
            role = "user" if m["role"] == "user" else "model"
            contents.append({"role": role, "parts": [m["content"]]})
        return contents

    async def chat(self, model, messages, api_key, temperature=0.7, system=None):
        # run the sync SDK in a worker to stay async-friendly
        import asyncio
        loop = asyncio.get_event_loop()

        def _do():
            client = self._client(api_key, model)
            resp = client.generate_content(
                self._to_gemini_messages(messages, system))
            return resp.text

        return await loop.run_in_executor(None, _do)

    async def stream(self, model, messages, api_key, temperature=0.7, system=None) -> AsyncIterator[str]:
        # fall back to single chunk — sync SDK streaming is awkward; chat() is enough
        yield await self.chat(model, messages, api_key, temperature, system)
