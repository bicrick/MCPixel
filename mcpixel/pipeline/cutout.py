from __future__ import annotations

import logging
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx

from mcpixel.config import Settings
from mcpixel.jobs.models import BgProvider
from mcpixel.pipeline.alpha import harden_alpha

logger = logging.getLogger(__name__)

# Python reports signal deaths as negative; shells often use 128+signal (137 = SIGKILL).
_SIGKILL_CODES = frozenset({-9, 137})


def remove_background(
    image_bytes: bytes,
    settings: Settings,
    provider: BgProvider,
) -> bytes:
    if provider == BgProvider.skip:
        return harden_alpha(image_bytes, settings.alpha_harden_threshold)

    if provider == BgProvider.remove_bg:
        return _remove_bg_api(image_bytes, settings)

    # rembg in a short-lived subprocess so ONNX segfaults do not kill the job worker.
    raw = _rembg_subprocess(image_bytes, settings.rembg_model)
    return harden_alpha(raw, settings.alpha_harden_threshold)


def _rembg_failure_message(returncode: int, model_name: str, err: str) -> str:
    detail = err.strip() or "no output"
    base = f"rembg worker failed (exit {returncode}, model={model_name}): {detail}"
    if returncode in _SIGKILL_CODES:
        return (
            f"{base}. Worker was SIGKILLed — usually out-of-memory loading the ONNX model. "
            "Use a lighter REMBG_MODEL (u2net or isnet-general-use), give Docker more memory "
            "(BiRefNet needs ~12GB+), and keep the rembg-models volume mounted so models are cached."
        )
    return base


def _rembg_subprocess(image_bytes: bytes, model_name: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="mcpixel-rembg-") as tmp:
        tmp_path = Path(tmp)
        inp = tmp_path / "in.png"
        out = tmp_path / "out.png"
        inp.write_bytes(image_bytes)
        cmd = [
            sys.executable,
            "-m",
            "mcpixel.pipeline.rembg_worker",
            str(inp),
            str(out),
            model_name,
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=300,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("rembg timed out after 300s") from exc

        if result.returncode != 0 or not out.exists():
            err = (result.stderr or result.stdout or b"").decode("utf-8", errors="replace")
            raise RuntimeError(
                _rembg_failure_message(result.returncode, model_name, err)
            )
        return out.read_bytes()


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
