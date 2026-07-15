from __future__ import annotations

import base64
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from mcpixel.jobs.models import (
    BgProvider,
    GenerateRequest,
    JobRecord,
    ResnapRequest,
)
from mcpixel.jobs.runner import JobRunner
from mcpixel.jobs.store import JobStore
from mcpixel.projects import ProjectStore
from mcpixel.providers.openai_text import refine_pixel_prompt
from mcpixel.settings_store import (
    AppSettingsFile,
    SettingsUpdate,
    apply_settings_file,
    load_settings_file,
    public_settings_view,
    save_settings_file,
)

router = APIRouter(prefix="/v1")


def _runner(request: Request) -> JobRunner:
    return request.app.state.runner


def _store(request: Request) -> JobStore:
    return request.app.state.store


def _projects(request: Request) -> ProjectStore:
    return request.app.state.projects


def _settings(request: Request):
    return request.app.state.settings


def enrich(job: JobRecord, base_url: str, projects: ProjectStore | None = None) -> dict:
    data = job.model_dump()
    urls = {}
    for stage, present in job.stages.items():
        if present:
            urls[stage] = f"{base_url}/v1/jobs/{job.id}/stages/{stage}"
    data["urls"] = urls
    data["ui_url"] = f"{base_url}/?job={job.id}"
    if projects is not None:
        data["project_ids"] = [p.id for p in projects.projects_for_job(job.id)]
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


@router.get("/settings")
def get_settings_view(request: Request) -> dict:
    return public_settings_view(_settings(request))


@router.put("/settings")
def update_settings(body: SettingsUpdate, request: Request) -> dict:
    settings = _settings(request)
    current = load_settings_file(settings)
    data = current.model_dump()
    if body.clear_openai_api_key:
        data["openai_api_key"] = ""
    elif body.openai_api_key is not None and body.openai_api_key.strip():
        data["openai_api_key"] = body.openai_api_key.strip()
    if body.clear_remove_bg_api_key:
        data["remove_bg_api_key"] = ""
    elif body.remove_bg_api_key is not None and body.remove_bg_api_key.strip():
        data["remove_bg_api_key"] = body.remove_bg_api_key.strip()
    saved = save_settings_file(settings, AppSettingsFile.model_validate(data))
    apply_settings_file(settings, saved, overwrite=True)
    return public_settings_view(settings)


class PromptRefineRequest(BaseModel):
    prompt: str = Field(min_length=1)


@router.post("/prompt/refine")
def refine_prompt(body: PromptRefineRequest, request: Request) -> dict:
    settings = _settings(request)
    if not settings.openai_api_key:
        raise HTTPException(503, "OpenAI API key not configured")
    try:
        refined = refine_pixel_prompt(body.prompt, settings)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"refined": refined}


@router.post("/generate")
def generate(
    body: GenerateRequest,
    background_tasks: BackgroundTasks,
    request: Request,
) -> dict:
    runner = _runner(request)
    try:
        record = runner.start_generate(body)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    background_tasks.add_task(runner.run_generate, record.id)
    return enrich(record, _settings(request).public_base_url, _projects(request))


@router.post("/generate/with-reference")
async def generate_with_reference(
    background_tasks: BackgroundTasks,
    request: Request,
) -> dict:
    """Multipart generate: form fields + reference image file."""
    form = await request.form()
    prompt_text = str(form.get("prompt") or "").strip()
    if not prompt_text:
        raise HTTPException(400, "prompt required")
    ref_file = form.get("reference")
    if not hasattr(ref_file, "read"):
        raise HTTPException(400, "reference file required")
    ref_bytes = await ref_file.read()  # type: ignore[union-attr]
    if not ref_bytes:
        raise HTTPException(400, "Empty reference image")

    k_raw = form.get("k_colors")
    if k_raw is None or k_raw == "" or str(k_raw).lower() == "none":
        k_val: int | None = None
    else:
        k_val = int(str(k_raw))

    px_raw = form.get("pixel_size")
    px_val = float(str(px_raw)) if px_raw not in (None, "") else None
    wrap = str(form.get("wrap_prompt", "true")).lower() in {"1", "true", "yes"}
    bg = BgProvider(str(form.get("bg_provider") or BgProvider.rembg_birefnet.value))
    tw = form.get("target_width")
    th = form.get("target_height")
    try:
        body = GenerateRequest(
            prompt=prompt_text,
            k_colors=k_val,
            pixel_size=px_val,
            bg_provider=bg,
            wrap_prompt=wrap,
            target_width=int(str(tw)) if tw not in (None, "") else None,
            target_height=int(str(th)) if th not in (None, "") else None,
        )
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc

    runner = _runner(request)
    record = runner.start_generate(body, reference_bytes=ref_bytes)
    background_tasks.add_task(runner.run_generate, record.id)
    return enrich(record, _settings(request).public_base_url, _projects(request))


@router.get("/jobs")
def list_jobs(request: Request, limit: int = 50) -> dict:
    jobs = _store(request).list_jobs(limit=limit)
    base = _settings(request).public_base_url
    projects = _projects(request)
    return {"jobs": [enrich(j, base, projects) for j in jobs]}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request) -> dict:
    job = _store(request).get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return enrich(job, _settings(request).public_base_url, _projects(request))


@router.delete("/jobs/{job_id}")
def delete_job(job_id: str, request: Request) -> dict:
    deleted = _store(request).delete(job_id)
    if not deleted:
        raise HTTPException(404, "Job not found")
    _projects(request).remove_job_from_all(job_id)
    return {"ok": True, "id": job_id}


@router.post("/jobs/clear-failed")
def clear_failed_jobs(request: Request) -> dict:
    store = _store(request)
    projects = _projects(request)
    failed_ids = [j.id for j in store.list_jobs(limit=10_000) if j.status.value == "failed"]
    removed = store.clear_failed()
    for job_id in failed_ids:
        projects.remove_job_from_all(job_id)
    return {"ok": True, "removed": removed}


@router.get("/jobs/{job_id}/stages/{stage}")
def get_stage(job_id: str, stage: str, request: Request) -> FileResponse:
    if stage not in {"raw", "cutout", "snapped", "edited"}:
        raise HTTPException(400, "Invalid stage")
    path = _store(request).stage_path(job_id, stage)
    if not path.exists():
        raise HTTPException(404, f"Stage {stage} not found")
    return FileResponse(path, media_type="image/png", filename=f"{job_id}_{stage}.png")


@router.post("/jobs/{job_id}/resnap")
def resnap(
    job_id: str,
    body: ResnapRequest,
    background_tasks: BackgroundTasks,
    request: Request,
) -> dict:
    try:
        job = _runner(request).start_resnap(job_id, body)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    background_tasks.add_task(_runner(request).run_resnap, job_id)
    return enrich(job, _settings(request).public_base_url, _projects(request))


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
    return enrich(job, _settings(request).public_base_url, _projects(request))


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
    return enrich(job, _settings(request).public_base_url, _projects(request))


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ProjectRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ProjectJobBody(BaseModel):
    job_id: str = Field(min_length=1)


@router.get("/projects")
def list_projects(request: Request) -> dict:
    return {"projects": [p.model_dump() for p in _projects(request).list_projects()]}


@router.post("/projects")
def create_project(body: ProjectCreate, request: Request) -> dict:
    return _projects(request).create(body.name).model_dump()


@router.patch("/projects/{project_id}")
def rename_project(project_id: str, body: ProjectRename, request: Request) -> dict:
    project = _projects(request).rename(project_id, body.name)
    if project is None:
        raise HTTPException(404, "Project not found")
    return project.model_dump()


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, request: Request) -> dict:
    if not _projects(request).delete(project_id):
        raise HTTPException(404, "Project not found")
    return {"ok": True, "id": project_id}


@router.post("/projects/{project_id}/jobs")
def add_job_to_project(project_id: str, body: ProjectJobBody, request: Request) -> dict:
    if _store(request).get(body.job_id) is None:
        raise HTTPException(404, "Job not found")
    project = _projects(request).add_job(project_id, body.job_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    return project.model_dump()


@router.delete("/projects/{project_id}/jobs/{job_id}")
def remove_job_from_project(project_id: str, job_id: str, request: Request) -> dict:
    project = _projects(request).remove_job(project_id, job_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    return project.model_dump()
