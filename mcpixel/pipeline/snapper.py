from __future__ import annotations

import re
import subprocess
from pathlib import Path

from mcpixel.config import Settings


class SnapperError(RuntimeError):
    pass


_PIXEL_SIZE_RE = re.compile(r"Pixel size:\s*([0-9.]+)px", re.IGNORECASE)
_OUTPUT_SIZE_RE = re.compile(r"Output size:\s*(\d+)x(\d+)", re.IGNORECASE)


def snap_image(
    settings: Settings,
    input_path: Path,
    output_path: Path,
    k_colors: int | None = 16,
    pixel_size: float | None = None,
) -> dict[str, float | int | None]:
    binary = Path(settings.snapper_bin)
    if not binary.exists():
        raise SnapperError(
            f"Snapper binary not found at {binary}. "
            "Build spritefusion-pixel-snapper or set SNAPPER_BIN."
        )

    # Binary requires a k positional; None → default 16 (UI "None" = no user preference).
    k = 16 if k_colors is None else int(k_colors)

    cmd: list[str] = [
        str(binary),
        str(input_path),
        str(output_path),
        str(k),
    ]
    if pixel_size is not None:
        cmd.extend(["--pixel-size", str(pixel_size)])

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise SnapperError(
            f"Snapper failed ({result.returncode}): {result.stderr or result.stdout}"
        )

    combined = f"{result.stdout}\n{result.stderr}"
    detected = None
    width = height = None
    if m := _PIXEL_SIZE_RE.search(combined):
        detected = float(m.group(1))
    if m := _OUTPUT_SIZE_RE.search(combined):
        width = int(m.group(1))
        height = int(m.group(2))

    if not output_path.exists():
        raise SnapperError("Snapper reported success but output file is missing")

    return {
        "detected_pixel_size": detected,
        "output_width": width,
        "output_height": height,
        "stdout": combined.strip(),
    }
