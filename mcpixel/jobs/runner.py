from __future__ import annotations

import logging
from pathlib import Path

from mcpixel.config import Settings
from mcpixel.jobs.models import (
    BgProvider,
    GenerateRequest,
    JobRecord,
    JobStatus,
    ResnapRequest,
)
from mcpixel.jobs.store import JobStore
from mcpixel.pipeline.cutout import remove_background
from mcpixel.pipeline.snapper import snap_image
from mcpixel.providers.base import ProviderRegistry
from mcpixel.providers.openai_images import OpenAIImageProvider

logger = logging.getLogger(__name__)


def build_registry() -> ProviderRegistry:
    registry = ProviderRegistry()
    registry.register(OpenAIImageProvider())
    return registry


class JobRunner:
    def __init__(self, settings: Settings, store: JobStore, providers: ProviderRegistry):
        self.settings = settings
        self.store = store
        self.providers = providers

    def wrap_prompt(
        self,
        prompt: str,
        wrap: bool,
        target_width: int | None = None,
        target_height: int | None = None,
    ) -> str:
        text = prompt.strip()
        if target_width and target_height:
            text = (
                f"{text}\n\nTarget sprite roughly {target_width}x{target_height} pixels, "
                "single centered subject, clear silhouette, game asset framing."
            )
        if not wrap:
            return text
        suffix = self.settings.default_prompt_suffix.strip()
        if not suffix:
            return text
        return f"{text}\n\n{suffix}"

    def start_generate(
        self,
        req: GenerateRequest,
        reference_bytes: bytes | None = None,
    ) -> JobRecord:
        job_id = self.store.new_id()
        bg = BgProvider.skip if req.skip_bg_remove else req.bg_provider
        extra: dict = {}
        if reference_bytes or req.reference_job_id:
            extra["had_reference"] = True
        if req.reference_job_id:
            extra["reference_job_id"] = req.reference_job_id
            extra["reference_stage"] = req.reference_stage or "snapped"

        record = JobRecord(
            id=job_id,
            status=JobStatus.queued,
            prompt=req.prompt,
            wrapped_prompt=self.wrap_prompt(
                req.prompt,
                req.wrap_prompt,
                target_width=req.target_width,
                target_height=req.target_height,
            ),
            provider=req.provider,
            k_colors=req.k_colors,
            pixel_size=req.pixel_size,
            bg_provider=bg,
            target_width=req.target_width,
            target_height=req.target_height,
            extra=extra,
        )
        self.store.create(record)

        ref_data = reference_bytes
        if ref_data is None and req.reference_job_id:
            ref_data = self._load_reference_job(
                req.reference_job_id, req.reference_stage or "snapped"
            )
        if ref_data:
            self.store.write_bytes(job_id, "reference", ref_data)
            record.extra["had_reference"] = True
            self.store.save(record)

        return record

    def _load_reference_job(self, job_id: str, stage: str) -> bytes:
        allowed = {"snapped", "edited", "cutout", "raw"}
        if stage not in allowed:
            raise FileNotFoundError(f"Invalid reference stage: {stage}")
        # Prefer best available if requested stage missing
        order = [stage, "edited", "snapped", "cutout", "raw"]
        seen: set[str] = set()
        for s in order:
            if s in seen:
                continue
            seen.add(s)
            path = self.store.stage_path(job_id, s)
            if path.exists():
                return path.read_bytes()
        raise FileNotFoundError(f"No reference image found for job {job_id}")

    def run_generate(self, job_id: str) -> None:
        record = self.store.get(job_id)
        if record is None:
            return

        try:
            self.store.set_status(record, JobStatus.generating)
            provider = self.providers.get(record.provider.value)
            prompt = record.wrapped_prompt or record.prompt
            ref_path = self.store.stage_path(job_id, "reference")
            if ref_path.exists():
                raw_bytes = provider.generate_with_reference(
                    prompt, ref_path.read_bytes(), self.settings
                )
            else:
                raw_bytes = provider.generate(prompt, self.settings)
            self.store.write_bytes(job_id, "raw", raw_bytes)
            record.stages["raw"] = True
            self.store.save(record)

            self.store.set_status(record, JobStatus.removing_background)
            cutout_bytes = remove_background(
                raw_bytes, self.settings, record.bg_provider
            )
            cutout_path = self.store.write_bytes(job_id, "cutout", cutout_bytes)
            record.stages["cutout"] = True
            self.store.save(record)

            self._snap(record, cutout_path)
            self.store.set_status(record, JobStatus.completed)
        except Exception as exc:
            logger.exception("Job %s failed", job_id)
            record = self.store.get(job_id) or record
            self.store.set_status(
                record,
                JobStatus.failed,
                error=str(exc),
                stage_error=record.status.value,
            )

    def start_resnap(self, job_id: str, req: ResnapRequest) -> JobRecord:
        record = self.store.get(job_id)
        if record is None:
            raise FileNotFoundError(f"Job not found: {job_id}")

        cutout = self.store.stage_path(job_id, "cutout")
        if not cutout.exists():
            raise FileNotFoundError("cutout.png missing; cannot resnap")

        if record.status in {
            JobStatus.queued,
            JobStatus.generating,
            JobStatus.removing_background,
            JobStatus.snapping,
        }:
            raise RuntimeError("Job is already running")

        record.k_colors = req.k_colors
        record.pixel_size = req.pixel_size
        record.error = None
        record.stage_error = None
        # A new snap invalidates any hand edit of the previous snap.
        edited = self.store.stage_path(job_id, "edited")
        if edited.exists():
            edited.unlink()
        record.stages["edited"] = False
        record.stages["snapped"] = False
        self.store.save(record)
        self.store.set_status(record, JobStatus.snapping)
        return self.store.get(job_id)  # type: ignore[return-value]

    def run_resnap(self, job_id: str) -> None:
        record = self.store.get(job_id)
        if record is None:
            return
        cutout = self.store.stage_path(job_id, "cutout")
        if not cutout.exists():
            self.store.set_status(
                record,
                JobStatus.failed,
                error="cutout.png missing; cannot resnap",
                stage_error="snapping",
            )
            return
        try:
            self._snap(record, cutout)
            self.store.set_status(record, JobStatus.completed)
        except Exception as exc:
            logger.exception("Resnap %s failed", job_id)
            record = self.store.get(job_id) or record
            self.store.set_status(
                record, JobStatus.failed, error=str(exc), stage_error="snapping"
            )

    def resnap(self, job_id: str, req: ResnapRequest) -> JobRecord:
        """Synchronous resnap (MCP / scripts). Prefer start_resnap + run_resnap in the API."""
        record = self.start_resnap(job_id, req)
        self.run_resnap(record.id)
        done = self.store.get(job_id)
        if done is None:
            raise FileNotFoundError(f"Job not found: {job_id}")
        if done.status == JobStatus.failed:
            raise RuntimeError(done.error or "Resnap failed")
        return done

    def process_upload(
        self,
        image_bytes: bytes,
        k_colors: int = 16,
        pixel_size: float | None = None,
        bg_provider: BgProvider = BgProvider.rembg_birefnet,
        prompt: str = "(uploaded image)",
    ) -> JobRecord:
        job_id = self.store.new_id()
        record = JobRecord(
            id=job_id,
            status=JobStatus.queued,
            prompt=prompt,
            k_colors=k_colors,
            pixel_size=pixel_size,
            bg_provider=bg_provider,
        )
        self.store.create(record)
        try:
            self.store.write_bytes(job_id, "raw", image_bytes)
            record.stages["raw"] = True
            self.store.set_status(record, JobStatus.removing_background)
            cutout_bytes = remove_background(image_bytes, self.settings, bg_provider)
            cutout_path = self.store.write_bytes(job_id, "cutout", cutout_bytes)
            record.stages["cutout"] = True
            self.store.save(record)
            self._snap(record, cutout_path)
            self.store.set_status(record, JobStatus.completed)
        except Exception as exc:
            record = self.store.get(job_id) or record
            self.store.set_status(
                record, JobStatus.failed, error=str(exc), stage_error=record.status.value
            )
        return self.store.get(job_id)  # type: ignore[return-value]

    def _snap(self, record: JobRecord, cutout_path: Path) -> None:
        self.store.set_status(record, JobStatus.snapping)
        out = self.store.stage_path(record.id, "snapped")
        meta = snap_image(
            self.settings,
            cutout_path,
            out,
            k_colors=record.k_colors,
            pixel_size=record.pixel_size,
        )
        record.stages["snapped"] = True
        record.detected_pixel_size = meta.get("detected_pixel_size")  # type: ignore[assignment]
        record.output_width = meta.get("output_width")  # type: ignore[assignment]
        record.output_height = meta.get("output_height")  # type: ignore[assignment]
        self.store.save(record)

    def save_edit(self, job_id: str, png_bytes: bytes) -> JobRecord:
        record = self.store.get(job_id)
        if record is None:
            raise FileNotFoundError(f"Job not found: {job_id}")
        self.store.write_bytes(job_id, "edited", png_bytes)
        record.stages["edited"] = True
        self.store.save(record)
        return record
