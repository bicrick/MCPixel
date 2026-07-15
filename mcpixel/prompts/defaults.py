"""Factory-default prompt conditioning strings.

Overrides may be stored in data/settings.json under `prompts`.
Runtime always resolves: default ← optional override.
"""

from __future__ import annotations

# --- Keys exposed in Settings → Edit prompts ---

PROMPT_KEYS = (
    "sprite_refine",
    "background_refine",
    "wrap_suffix",
    "sprite_framing",
    "background_framing",
    "pose_lock",
)

PROMPT_META: dict[str, dict[str, str]] = {
    "sprite_refine": {
        "label": "Sprite refine (system)",
        "hint": "System prompt for ✦ refine in Create sprite mode.",
        "placeholders": "",
    },
    "background_refine": {
        "label": "Background refine (system)",
        "hint": "System prompt for ✦ refine in Create background mode.",
        "placeholders": "",
    },
    "wrap_suffix": {
        "label": "Wrap style suffix",
        "hint": "Appended when “Wrap with pixel-art style suffix” is on.",
        "placeholders": "",
    },
    "sprite_framing": {
        "label": "Sprite framing",
        "hint": "Appended when a target size is set. Placeholders: {width}, {height}",
        "placeholders": "{width} {height}",
    },
    "background_framing": {
        "label": "Background framing",
        "hint": "Appended for background jobs. Placeholder: {aspect_hint}",
        "placeholders": "{aspect_hint}",
    },
    "pose_lock": {
        "label": "8-direction pose lock",
        "hint": "Child facing regeneration. Placeholder: {facing}",
        "placeholders": "{facing}",
    },
}

SPRITE_REFINE_SYSTEM = """You refine prompts for pixel-art game sprite generation.
Rewrite the user's prompt into a clear, specific pixel-art sprite prompt.
Preserve their subject and intent. Prefer: view/angle, silhouette, limited palette cues,
flat colors, crisp pixels, no anti-aliasing, centered game asset.
Do not invent unrelated characters or scenes. Return only the refined prompt text,
with no quotes, labels, or explanation."""

BACKGROUND_REFINE_SYSTEM = """You refine prompts for pixel-art game background / environment generation.
Rewrite the user's prompt into a clear, specific full-bleed pixel-art scene prompt.
Preserve their setting and mood. Prefer: environment layout, depth layers for parallax,
horizon/sky, lighting and time of day, atmosphere, readable silhouettes, limited palette,
flat colors, crisp pixels, no anti-aliasing, game backdrop (not a centered character sprite).
Do not invent unrelated plots or characters unless the user asked for them.
Return only the refined prompt text, with no quotes, labels, or explanation."""

WRAP_STYLE_SUFFIX = (
    "True pixel art sprite, limited color palette, flat colors, "
    "crisp pixels, no anti-aliasing, no blur, solid simple background, "
    "game asset, centered subject."
)

SPRITE_FRAMING = (
    "Target sprite roughly {width}x{height} pixels, "
    "single centered subject, clear silhouette, game asset framing."
)

BACKGROUND_FRAMING = (
    "Full-bleed pixel-art environment / background scene. "
    "{aspect_hint} No single character focus; fill the frame with scenery "
    "suitable for a game backdrop."
)

ASPECT_HINT_SQUARE = "Square framing (1:1)."
ASPECT_HINT_LANDSCAPE = "Wide landscape framing (16:9)."
ASPECT_HINT_PORTRAIT = "Tall portrait framing (9:16)."

POSE_LOCK_TEMPLATE = (
    "Redraw this exact sprite from a different compass facing.\n"
    "Keep the IDENTICAL pose as the reference "
    "(same stance, limbs, prop grip, body angle relative to itself).\n"
    "Only rotate the character in place so they are now {facing}, "
    "top-down orthographic game sprite.\n"
    "Do not change the action or invent a new pose. "
    "Do not move arms, legs, or props into a different gesture.\n"
    "Same character, proportions, colors, and silhouette as the reference. "
    "Single centered subject, pixel art, clear outline, no background clutter."
)

# Facing clauses are centralized here but not exposed in the Prompts UI.
TOPDOWN8_DIRECTIONS: list[tuple[str, str]] = [
    ("N", "facing north (away from camera)"),
    ("NE", "facing north-east"),
    ("E", "facing east (right)"),
    ("SE", "facing south-east"),
    ("S", "facing south (toward camera)"),
    ("SW", "facing south-west"),
    ("W", "facing west (left)"),
    ("NW", "facing north-west"),
]

FACING_BY_CODE: dict[str, str] = dict(TOPDOWN8_DIRECTIONS)

FACTORY_DEFAULTS: dict[str, str] = {
    "sprite_refine": SPRITE_REFINE_SYSTEM,
    "background_refine": BACKGROUND_REFINE_SYSTEM,
    "wrap_suffix": WRAP_STYLE_SUFFIX,
    "sprite_framing": SPRITE_FRAMING,
    "background_framing": BACKGROUND_FRAMING,
    "pose_lock": POSE_LOCK_TEMPLATE,
}
