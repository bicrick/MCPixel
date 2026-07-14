from __future__ import annotations

import logging
from functools import lru_cache
from io import BytesIO

import httpx

from mcpixel.config import Settings
from mcpixel.jobs.models import BgProvider
from mcpixel.pipeline.alpha import harden_alpha

logger = logging.getLogger(__name__)


@lru_cache(maxsize=2)
def _rembg_session(model_name: str):
    from rembg import new_session

    return new_session(model_name)


def remove_background(
    image_bytes: bytes,
    settings: Settings,
    provider: BgProvider,
) -> bytes:
    if provider == BgProvider.skip:
        return harden_alpha(image_bytes, settings.alpha_harden_threshold)

    if provider == BgProvider.remove_bg:
        return _remove_bg_api(image_bytes, settings)

    # rembg_birefnet (default)
    from rembg import remove

    model = settings.rembg_model
    try:
        session = _rembg_session(model)
        cutout = remove(image_bytes, session=session)
    except Exception as exc:
        logger.warning("rembg model %s failed (%s); falling back to u2net", model, exc)
        session = _rembg_session("u2net")
        cutout = remove(image_bytes, session=session)

    if isinstance(cutout, bytes):
        raw = cutout
    else:
        buf = BytesIO()
        cutout.save(buf, format="PNG")
        raw = buf.getvalue()

    return harden_alpha(raw, settings.alpha_harden_threshold)


def _remove_bg_api(image_bytes: bytes, settings: Settings) -> bytes:
    if not settings.remove_bg_api_key:
        raise RuntimeError("REMOVE_BG_API_KEY is not configured")

    response = httpx.post(
        "https://api.remove.bg/v1.0/removebg",
        files={"image_file": ("input.png", image_bytes, "image/png")},
        data={"size": "auto"},
        headers={"X-Api-Key": settings.remove_bg_api_key},
        timeout=120.0,
    )
    if response.status_code != 200:
        raise RuntimeError(f"remove.bg failed: {response.status_code} {response.text}")
    return harden_alpha(response.content, settings.alpha_harden_threshold)
