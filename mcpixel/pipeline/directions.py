"""Top-down 8-direction pose helpers."""

from __future__ import annotations

from io import BytesIO

from PIL import Image

# Longest edge of a user-supplied reference for Pose = 8 directions.
MAX_DIRECTIONS_REF_SIDE = 1024

DIRECTION_CODES = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")

# Compass code → short facing clause (used inside pose-locked prompts).
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

# Legacy default when caller does not specify.
MASTER_DIRECTION = "S"


def normalize_facing(code: str | None) -> str:
    raw = (code or MASTER_DIRECTION).strip().upper()
    if raw not in FACING_BY_CODE:
        raise ValueError(
            f"Invalid reference_facing {code!r}. Use one of: {', '.join(DIRECTION_CODES)}"
        )
    return raw


def facing_clause(code: str) -> str:
    return FACING_BY_CODE[normalize_facing(code)]


def master_and_children(reference_facing: str) -> tuple[str, list[tuple[str, str]]]:
    """Return (master_code, [(child_code, clause), ...]) for the other seven."""
    master = normalize_facing(reference_facing)
    children = [(code, clause) for code, clause in TOPDOWN8_DIRECTIONS if code != master]
    return master, children


def direction_prompt(base_prompt: str, facing_clause_text: str) -> str:
    """Legacy helper — prefer pose_locked_direction_prompt for 8-dir children."""
    base = base_prompt.strip()
    return pose_locked_direction_prompt(facing_clause_text, label=base or None)


def pose_locked_direction_prompt(facing_clause_text: str, label: str | None = None) -> str:
    """
    Child prompt: same pose as reference, only rotate compass facing.
    Optional label is ignored for identity (reference carries that); kept out of the lock text.
    """
    _ = label  # reserved for future naming hints; do not inject into pose lock
    return (
        "Redraw this exact sprite from a different compass facing.\n"
        "Keep the IDENTICAL pose as the reference "
        "(same stance, limbs, prop grip, body angle relative to itself).\n"
        f"Only rotate the character in place so they are now {facing_clause_text}, "
        "top-down orthographic game sprite.\n"
        "Do not change the action or invent a new pose. "
        "Do not move arms, legs, or props into a different gesture.\n"
        "Same character, proportions, colors, and silhouette as the reference. "
        "Single centered subject, pixel art, clear outline, no background clutter."
    )


def image_dimensions(png_bytes: bytes) -> tuple[int, int]:
    with Image.open(BytesIO(png_bytes)) as im:
        return im.size  # (w, h)


def validate_directions_reference(png_bytes: bytes) -> tuple[int, int]:
    """Raise ValueError if reference is unusable for 8-direction batch."""
    if not png_bytes:
        raise ValueError("Reference image is required for 8 directions")
    try:
        w, h = image_dimensions(png_bytes)
    except Exception as exc:
        raise ValueError(f"Could not read reference image: {exc}") from exc
    longest = max(w, h)
    if longest > MAX_DIRECTIONS_REF_SIDE:
        raise ValueError(
            f"Reference image is too large ({w}×{h}). "
            f"Longest side must be ≤ {MAX_DIRECTIONS_REF_SIDE}px for 8 directions. "
            "Use a snapped library sprite or a smaller source image."
        )
    if min(w, h) < 16:
        raise ValueError(
            f"Reference image is too small ({w}×{h}). Use at least 16px on the short side."
        )
    return w, h
