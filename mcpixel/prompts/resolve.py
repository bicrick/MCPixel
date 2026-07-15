"""Resolve effective prompt text: factory default ← optional settings override."""

from __future__ import annotations

from typing import Any

from mcpixel.config import Settings
from mcpixel.prompts.defaults import (
    ASPECT_HINT_LANDSCAPE,
    ASPECT_HINT_PORTRAIT,
    ASPECT_HINT_SQUARE,
    FACTORY_DEFAULTS,
    PROMPT_KEYS,
    PROMPT_META,
)


def _overrides_map(settings: Settings) -> dict[str, str | None]:
    raw = getattr(settings, "prompt_overrides", None) or {}
    if hasattr(raw, "model_dump"):
        raw = raw.model_dump()
    if not isinstance(raw, dict):
        return {}
    return {k: raw.get(k) for k in PROMPT_KEYS}


def get_prompt(settings: Settings, key: str) -> str:
    if key not in FACTORY_DEFAULTS:
        raise KeyError(f"Unknown prompt key: {key}")
    overrides = _overrides_map(settings)
    override = overrides.get(key)
    if isinstance(override, str) and override.strip():
        return override
    return FACTORY_DEFAULTS[key]


def format_prompt(settings: Settings, key: str, **vars: Any) -> str:
    template = get_prompt(settings, key)
    try:
        return template.format(**vars)
    except (KeyError, ValueError):
        # Best-effort: leave unformatted if placeholders mismatch
        return template


def aspect_hint_for_size(image_size: str) -> str:
    size = (image_size or "").strip()
    if size == "1536x1024":
        return ASPECT_HINT_LANDSCAPE
    if size == "1024x1536":
        return ASPECT_HINT_PORTRAIT
    return ASPECT_HINT_SQUARE


def prompt_catalog(settings: Settings) -> dict[str, Any]:
    """Effective values + defaults + modified flags for Settings UI."""
    overrides = _overrides_map(settings)
    items: dict[str, Any] = {}
    for key in PROMPT_KEYS:
        default = FACTORY_DEFAULTS[key]
        override = overrides.get(key)
        has_override = isinstance(override, str) and override.strip() != ""
        effective = override.strip() if has_override else default  # type: ignore[union-attr]
        if has_override:
            # If override equals default, treat as unmodified for badge
            modified = override.strip() != default  # type: ignore[union-attr]
        else:
            modified = False
            effective = default
        meta = PROMPT_META.get(key, {})
        items[key] = {
            "value": effective,
            "default": default,
            "modified": modified,
            "label": meta.get("label", key),
            "hint": meta.get("hint", ""),
            "placeholders": meta.get("placeholders", ""),
        }
    return {
        "keys": list(PROMPT_KEYS),
        "items": items,
    }
