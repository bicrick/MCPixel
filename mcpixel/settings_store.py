from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from mcpixel.config import Settings
from mcpixel.jobs.pool import (
    MAX_PARALLEL_JOBS,
    MIN_PARALLEL_JOBS,
    clamp_parallel_jobs,
)


class AppSettingsFile(BaseModel):
    openai_api_key: str | None = None
    remove_bg_api_key: str | None = None
    max_parallel_jobs: int | None = None


def settings_path(settings: Settings) -> Path:
    return settings.data_dir / "settings.json"


def load_settings_file(settings: Settings) -> AppSettingsFile:
    path = settings_path(settings)
    if not path.exists():
        return AppSettingsFile()
    try:
        return AppSettingsFile.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        return AppSettingsFile()


def save_settings_file(settings: Settings, payload: AppSettingsFile) -> AppSettingsFile:
    path = settings_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload.model_dump_json(indent=2), encoding="utf-8")
    return payload


def apply_settings_file(
    settings: Settings,
    file: AppSettingsFile,
    *,
    overwrite: bool = False,
) -> Settings:
    """Merge file keys into runtime settings.

    By default, only fill keys that are currently empty so process env wins.
    Pass overwrite=True after a Settings UI save to hot-apply stored values.
    """
    if file.openai_api_key is not None:
        if overwrite or not settings.openai_api_key:
            settings.openai_api_key = file.openai_api_key or None
    if file.remove_bg_api_key is not None:
        if overwrite or not settings.remove_bg_api_key:
            settings.remove_bg_api_key = file.remove_bg_api_key or None
    if file.max_parallel_jobs is not None:
        settings.max_parallel_jobs = clamp_parallel_jobs(file.max_parallel_jobs)
    return settings


def public_settings_view(settings: Settings) -> dict[str, Any]:
    def mask(key: str | None) -> dict[str, Any]:
        if not key:
            return {"configured": False, "hint": ""}
        hint = key[:4] + "…" + key[-4:] if len(key) > 8 else "••••"
        return {"configured": True, "hint": hint}

    return {
        "openai_api_key": mask(settings.openai_api_key),
        "remove_bg_api_key": mask(settings.remove_bg_api_key),
        "max_parallel_jobs": clamp_parallel_jobs(settings.max_parallel_jobs),
        "max_parallel_jobs_min": MIN_PARALLEL_JOBS,
        "max_parallel_jobs_max": MAX_PARALLEL_JOBS,
        "data_dir": str(settings.data_dir),
        "jobs_dir": str(settings.jobs_dir),
        "openai_image_model": settings.openai_image_model,
    }


class SettingsUpdate(BaseModel):
    openai_api_key: str | None = Field(default=None)
    remove_bg_api_key: str | None = Field(default=None)
    max_parallel_jobs: int | None = Field(default=None)
    clear_openai_api_key: bool = False
    clear_remove_bg_api_key: bool = False
