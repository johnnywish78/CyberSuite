"""OpenAI provider — official openai SDK with streaming."""
from typing import AsyncIterator, Dict, List, Optional

from backend.ai.base import AIProvider, register


@register
class OpenAIProvider(AIProvider):
    id = "openai"
    name = "OpenAI GPT"
    default_model = "gpt-4o"
    needs_key = True
    key_env_hint = "platform.openai.com — set OPENAI_API_KEY"
    supports_stream = True

    async def models(self) -> List[str]:
        return ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-mini", "o3-mini"]

    def _client(self, api_key):
        from openai import AsyncOpenAI
        return AsyncOpenAI(api_key=api_key)

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
