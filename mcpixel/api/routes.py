from __future__ import annotations

import base64
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from mcpixel.jobs.models import (
    BgProvider,
    GenerateRequest,
    JobRecord,
    ResnapRequest,
)
from mcpixel.jobs.runner import JobRunner
from mcpixel.jobs.store import JobStore

router = APIRouter(prefix="/v1")


def _runner(request: Request) -> JobRunner:
    return request.app.state.runner


def _store(request: Request) -> JobStore:
    return request.app.state.store


def _settings(request: Request):
    return request.app.state.settings


def enrich(job: JobRecord, base_url: str) -> dict:
    data = job.model_dump()
    urls = {}
    for stage, present in job.stages.items():
        if present:
            urls[stage] = f"{base_url}/v1/jobs/{job.id}/stages/{stage}"
    data["urls"] = urls
    data["ui_url"] = f"{base_url}/?job={job.id}"
    return data


@router.get("/health")
def health(request: Request) -> dict:
    settings = _settings(request)
    return {
        "ok": True,
        "snapper_bin": str(settings.snapper_bin),
        "snapper_exists": settings.snapper_bin.exists(),
        "openai_configured": bool(settings.openai_api_key),
        "providers": _runner(request).providers.available(),
    }


@router.post("/generate")
def generate(
    body: GenerateRequest,
    background_tasks: BackgroundTasks,
    request: Request,
) -> dict:
    runner = _runner(request)
    record = runner.start_generate(body)
    background_tasks.add_task(runner.run_generate, record.id)
    return enrich(record, _settings(request).public_base_url)


@router.get("/jobs")
def list_jobs(request: Request, limit: int = 50) -> dict:
    jobs = _store(request).list_jobs(limit=limit)
    base = _settings(request).public_base_url
    return {"jobs": [enrich(j, base) for j in jobs]}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request) -> dict:
    job = _store(request).get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return enrich(job, _settings(request).public_base_url)


@router.get("/jobs/{job_id}/stages/{stage}")
def get_stage(job_id: str, stage: str, request: Request) -> FileResponse:
    if stage not in {"raw", "cutout", "snapped", "edited"}:
        raise HTTPException(400, "Invalid stage")
    path = _store(request).stage_path(job_id, stage)
    if not path.exists():
        raise HTTPException(404, f"Stage {stage} not found")
    return FileResponse(path, media_type="image/png", filename=f"{job_id}_{stage}.png")


@router.post("/jobs/{job_id}/resnap")
def resnap(job_id: str, body: ResnapRequest, request: Request) -> dict:
    try:
        job = _runner(request).resnap(job_id, body)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
    return enrich(job, _settings(request).public_base_url)


@router.post("/jobs/{job_id}/edit")
async def save_edit(job_id: str, request: Request) -> dict:
    payload = await request.json()
    b64 = payload.get("png_base64")
    if not b64:
        raise HTTPException(400, "png_base64 required")
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    try:
        data = base64.b64decode(b64)
    except Exception as exc:
        raise HTTPException(400, "Invalid base64") from exc
    try:
        job = _runner(request).save_edit(job_id, data)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return enrich(job, _settings(request).public_base_url)


@router.post("/process")
async def process_upload(
    request: Request,
    file: Annotated[UploadFile, File()],
    k_colors: int = 16,
    pixel_size: float | None = None,
    bg_provider: BgProvider = BgProvider.rembg_birefnet,
) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty upload")
    job = _runner(request).process_upload(
        data,
        k_colors=k_colors,
        pixel_size=pixel_size,
        bg_provider=bg_provider,
        prompt=file.filename or "(upload)",
    )
    return enrich(job, _settings(request).public_base_url)
