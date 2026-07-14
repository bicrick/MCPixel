from __future__ import annotations

from io import BytesIO

from PIL import Image


def harden_alpha(image_bytes: bytes, threshold: int = 128) -> bytes:
    """Force semi-transparent edge pixels to fully transparent or opaque."""
    img = Image.open(BytesIO(image_bytes)).convert("RGBA")
    pixels = img.load()
    assert pixels is not None
    width, height = img.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a < threshold:
                pixels[x, y] = (r, g, b, 0)
            elif a < 255:
                pixels[x, y] = (r, g, b, 255)
    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()
