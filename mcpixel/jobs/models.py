from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    queued = "queued"
    generating = "generating"
    removing_background = "removing_background"
    snapping = "snapping"
    completed = "completed"
    failed = "failed"


class BgProvider(str, Enum):
    rembg_birefnet = "rembg_birefnet"
    skip = "skip"
    remove_bg = "remove_bg"


class ImageProviderName(str, Enum):
    openai = "openai"


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1)
    provider: ImageProviderName = ImageProviderName.openai
    k_colors: int = Field(default=16, ge=2, le=64)
    pixel_size: float | None = Field(default=None, gt=0)
    bg_provider: BgProvider = BgProvider.rembg_birefnet
    wrap_prompt: bool = True
    skip_bg_remove: bool = False


class ResnapRequest(BaseModel):
    k_colors: int = Field(default=16, ge=2, le=64)
    pixel_size: float | None = Field(default=None, gt=0)


class JobRecord(BaseModel):
    id: str
    status: JobStatus
    prompt: str
    wrapped_prompt: str | None = None
    provider: ImageProviderName = ImageProviderName.openai
    k_colors: int = 16
    pixel_size: float | None = None
    bg_provider: BgProvider = BgProvider.rembg_birefnet
    error: str | None = None
    stage_error: str | None = None
    detected_pixel_size: float | None = None
    output_width: int | None = None
    output_height: int | None = None
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    stages: dict[str, bool] = Field(
        default_factory=lambda: {
            "raw": False,
            "cutout": False,
            "snapped": False,
            "edited": False,
        }
    )
    extra: dict[str, Any] = Field(default_factory=dict)

    def touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc).isoformat()
