from __future__ import annotations

import base64
import io

from openai import OpenAI

from mcpixel.config import Settings
from mcpixel.providers.base import ImageProvider

_ALLOWED_SIZES = frozenset({"1024x1024", "1536x1024", "1024x1536"})


def _normalize_size(size: str | None) -> str:
    value = (size or "1024x1024").strip()
    if value not in _ALLOWED_SIZES:
        return "1024x1024"
    return value


def _png_from_response(item) -> bytes:
    if getattr(item, "b64_json", None):
        return base64.b64decode(item.b64_json)
    if getattr(item, "url", None):
        import httpx

        r = httpx.get(item.url, timeout=120.0)
        r.raise_for_status()
        return r.content
    raise RuntimeError("OpenAI image response contained neither b64_json nor url")


class OpenAIImageProvider(ImageProvider):
    name = "openai"

    def _client(self, settings: Settings) -> OpenAI:
        if not settings.openai_api_key:
            raise RuntimeError(
                "OPENAI_API_KEY is not set. Add it to .env to generate images."
            )
        return OpenAI(api_key=settings.openai_api_key)

    def generate(
        self, prompt: str, settings: Settings, *, size: str = "1024x1024"
    ) -> bytes:
        client = self._client(settings)
        response = client.images.generate(
            model=settings.openai_image_model,
            prompt=prompt,
            size=_normalize_size(size),
            n=1,
        )
        return _png_from_response(response.data[0])

    def generate_with_reference(
        self,
        prompt: str,
        image_bytes: bytes,
        settings: Settings,
        *,
        size: str = "1024x1024",
    ) -> bytes:
        """Image-to-image via Images Edit — reference guides identity/style."""
        client = self._client(settings)
        buf = io.BytesIO(image_bytes)
        buf.name = "reference.png"
        kwargs: dict = {
            "model": settings.openai_image_model,
            "image": buf,
            "prompt": prompt,
            "size": _normalize_size(size),
        }
        # gpt-image-1.x supports input_fidelity; gpt-image-2 does not.
        model = (settings.openai_image_model or "").lower()
        if model.startswith("gpt-image-1"):
            kwargs["input_fidelity"] = "high"
        response = client.images.edit(**kwargs)
        return _png_from_response(response.data[0])
