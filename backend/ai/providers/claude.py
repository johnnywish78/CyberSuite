"""Anthropic Claude provider — uses the official anthropic SDK."""
from typing import AsyncIterator, Dict, List, Optional

from backend.ai.base import AIProvider, register


@register
class ClaudeProvider(AIProvider):
    id = "claude"
    name = "Anthropic Claude"
    default_model = "claude-sonnet-4-5"
    needs_key = True
    key_env_hint = "console.anthropic.com — set ANTHROPIC_API_KEY"
    supports_stream = True

    async def models(self) -> List[str]:
        # Keep a curated recent family; the UI shows these in the dropdown.
        return ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5",
                "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"]

    async def chat(self, model, messages, api_key, temperature=0.7, system=None):
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=api_key)
        # Anthropic takes system separately from the messages list.
        resp = await client.messages.create(
            model=model, max_tokens=4096, temperature=temperature,
            system=system or "", messages=messages)
        return resp.content[0].text

    async def stream(self, model, messages, api_key, temperature=0.7, system=None) -> AsyncIterator[str]:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=api_key)
        async with client.messages.stream(
            model=model, max_tokens=4096, temperature=temperature,
            system=system or "", messages=messages
        ) as stream:
            async for text in stream.text_stream:
                yield text
