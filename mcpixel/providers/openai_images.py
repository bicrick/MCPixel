from __future__ import annotations

import base64

from openai import OpenAI

from mcpixel.config import Settings
from mcpixel.providers.base import ImageProvider


class OpenAIImageProvider(ImageProvider):
    name = "openai"

    def generate(self, prompt: str, settings: Settings) -> bytes:
        if not settings.openai_api_key:
            raise RuntimeError(
                "OPENAI_API_KEY is not set. Add it to .env to generate images."
            )

        client = OpenAI(api_key=settings.openai_api_key)
        # gpt-image-1 returns b64_json by default on many accounts
        response = client.images.generate(
            model=settings.openai_image_model,
            prompt=prompt,
            size="1024x1024",
            n=1,
        )
        item = response.data[0]
        if getattr(item, "b64_json", None):
            return base64.b64decode(item.b64_json)
        if getattr(item, "url", None):
            import httpx

            r = httpx.get(item.url, timeout=120.0)
            r.raise_for_status()
            return r.content
        raise RuntimeError("OpenAI image response contained neither b64_json nor url")
