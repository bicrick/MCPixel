"""System prompts for AI prompt refinement (sprite vs background).

Canonical defaults live in mcpixel.prompts.defaults; this module is a thin adapter.
"""

from __future__ import annotations

from mcpixel.config import Settings
from mcpixel.prompts.resolve import get_prompt


def refine_system_prompt(kind: str, settings: Settings | None = None) -> str:
    key = (kind or "sprite").strip().lower()
    prompt_key = "background_refine" if key == "background" else "sprite_refine"
    if settings is None:
        from mcpixel.prompts.defaults import FACTORY_DEFAULTS

        return FACTORY_DEFAULTS[prompt_key]
    return get_prompt(settings, prompt_key)
