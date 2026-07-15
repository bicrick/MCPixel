from __future__ import annotations

import os
import time
from typing import Any

import httpx

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:  # pragma: no cover
    from mcp.server.fastmcp import FastMCP  # type: ignore


BASE_URL = os.environ.get("MCPIXEL_URL", "http://127.0.0.1:8787").rstrip("/")

mcp = FastMCP("mcpixel")


def _client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=120.0)


def _check_health() -> dict[str, Any]:
    try:
        with _client() as client:
            r = client.get("/v1/health")
            r.raise_for_status()
            return r.json()
    except Exception as exc:
        raise RuntimeError(
            f"MCPixel API is not reachable at {BASE_URL}. "
            f"Start it with `uv run mcpixel` or `docker compose up`. ({exc})"
        ) from exc


@mcp.tool()
def health() -> dict[str, Any]:
    """Check whether the MCPixel local API is running."""
    return _check_health()


@mcp.tool()
def generate_sprite(
    prompt: str,
    k_colors: int = 16,
    pixel_size: float | None = None,
    bg_provider: str = "rembg_birefnet",
    wrap_prompt: bool = True,
    wait: bool = True,
) -> dict[str, Any]:
    """Generate a sprite end-to-end: image API → background remove → pixel snap.

    Requires MCPixel API running and OPENAI_API_KEY configured on the server.
    If wait=True, polls until the job completes or fails.
    """
    _check_health()
    payload = {
        "prompt": prompt,
        "k_colors": k_colors,
        "pixel_size": pixel_size,
        "bg_provider": bg_provider,
        "wrap_prompt": wrap_prompt,
    }
    with _client() as client:
        r = client.post("/v1/generate", json=payload)
        r.raise_for_status()
        job = r.json()
        if not wait:
            return job
        job_id = job["id"]
        for _ in range(120):
            jr = client.get(f"/v1/jobs/{job_id}")
            jr.raise_for_status()
            job = jr.json()
            if job["status"] in {"completed", "failed"}:
                break
            time.sleep(2)
        # Attach a small thumbnail hint via URL; agents can open ui_url
        return job


@mcp.tool()
def list_jobs(limit: int = 20) -> dict[str, Any]:
    """List recent MCPixel jobs."""
    _check_health()
    with _client() as client:
        r = client.get("/v1/jobs", params={"limit": limit})
        r.raise_for_status()
        return r.json()


@mcp.tool()
def get_job(job_id: str) -> dict[str, Any]:
    """Get one job by id, including stage URLs."""
    _check_health()
    with _client() as client:
        r = client.get(f"/v1/jobs/{job_id}")
        r.raise_for_status()
        return r.json()


@mcp.tool()
def resnap(
    job_id: str,
    k_colors: int = 16,
    pixel_size: float | None = None,
) -> dict[str, Any]:
    """Re-run pixel snapper on an existing cutout (no new image generation)."""
    import time

    _check_health()
    with _client() as client:
        r = client.post(
            f"/v1/jobs/{job_id}/resnap",
            json={"k_colors": k_colors, "pixel_size": pixel_size},
        )
        r.raise_for_status()
        job = r.json()
        for _ in range(60):
            if job.get("status") in {"completed", "failed"}:
                break
            time.sleep(0.25)
            r = client.get(f"/v1/jobs/{job_id}")
            r.raise_for_status()
            job = r.json()
        return job


@mcp.tool()
def delete_job(job_id: str) -> dict[str, Any]:
    """Permanently delete a job and its stage images from local disk."""
    _check_health()
    with _client() as client:
        r = client.delete(f"/v1/jobs/{job_id}")
        r.raise_for_status()
        return r.json()


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
