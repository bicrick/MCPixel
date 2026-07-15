from __future__ import annotations

import logging
from pathlib import Path

from mcpixel.config import Settings
from mcpixel.jobs.models import (
    ACTIVE_JOB_STATUSES,
    AssetKind,
    BgProvider,
    DirectionsRequest,
    GenerateRequest,
    ImageSize,
    JobRecord,
    JobStatus,
    PoseMode,
    ResnapRequest,
)
from mcpixel.jobs.store import JobStore
from mcpixel.pipeline.cutout import remove_background
from mcpixel.pipeline.directions import (
    master_and_children,
    pose_locked_direction_prompt,
    validate_directions_reference,
)
from mcpixel.pipeline.snapper import snap_image
from mcpixel.projects import ProjectStore
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
        kind: AssetKind = AssetKind.sprite,
        image_size: ImageSize = ImageSize.square,
    ) -> str:
        text = prompt.strip()
        if kind == AssetKind.background:
            if image_size == ImageSize.landscape:
                framing = "Wide landscape framing (16:9)."
            elif image_size == ImageSize.portrait:
                framing = "Tall portrait framing (9:16)."
            else:
                framing = "Square framing (1:1)."
            text = (
                f"{text}\n\nFull-bleed pixel-art environment / background scene. "
                f"{framing} No single character focus; fill the frame with scenery "
                "suitable for a game backdrop."
            )
        elif target_width and target_height:
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
        if req.kind == AssetKind.background:
            bg = BgProvider.skip
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
                kind=req.kind,
                image_size=req.image_size,
            ),
            provider=req.provider,
            k_colors=req.k_colors,
            pixel_size=req.pixel_size,
            bg_provider=bg,
            target_width=req.target_width,
            target_height=req.target_height,
            image_size=req.image_size,
            kind=req.kind,
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

    def start_directions(
        self,
        req: DirectionsRequest,
        projects: ProjectStore,
        reference_bytes: bytes | None = None,
    ) -> list[JobRecord]:
        if req.pose != PoseMode.topdown8:
            raise ValueError(f"Unsupported pose mode: {req.pose}")

        ref_data = reference_bytes
        if ref_data is None and req.reference_job_id:
            ref_data = self._load_reference_job(
                req.reference_job_id, req.reference_stage or "snapped"
            )
        if not ref_data:
            raise ValueError(
                "8 directions requires a reference image "
                "(library sprite or file, longest side ≤ 1024px)."
            )
        validate_directions_reference(ref_data)

        master_code, children = master_and_children(req.reference_facing)
        label = (req.prompt or "").strip() or f"8-dir · {master_code}"
        project_name = (req.project_name or "").strip() or f"8-dir: {label[:48]}"
        project = projects.create(project_name)
        batch_id = self.store.new_id()

        # Library snapped/edited → copy as master without rembg.
        stage = (req.reference_stage or "snapped").strip() or "snapped"
        if reference_bytes is not None:
            master_source = "file"
        elif req.reference_job_id and stage in {"snapped", "edited"}:
            master_source = "library_snapped"
        else:
            master_source = "file"

        bg = BgProvider.skip if req.skip_bg_remove else req.bg_provider
        master_id = self.store.new_id()
        master = JobRecord(
            id=master_id,
            status=JobStatus.queued,
            prompt=label,
            wrapped_prompt=None,
            provider=req.provider,
            k_colors=req.k_colors,
            pixel_size=req.pixel_size,
            bg_provider=bg,
            target_width=req.target_width,
            target_height=req.target_height,
            extra={
                "had_reference": True,
                "direction_batch_id": batch_id,
                "direction": master_code,
                "pose": req.pose.value,
                "direction_role": "master",
                "project_id": project.id,
                "base_prompt": label,
                "master_source": master_source,
                "reference_facing": master_code,
            },
        )
        if req.reference_job_id:
            master.extra["reference_job_id"] = req.reference_job_id
            master.extra["reference_stage"] = stage
        self.store.create(master)
        self.store.write_bytes(master_id, "reference", ref_data)
        self.store.write_bytes(master_id, "raw", ref_data)
        master.stages["raw"] = True
        self.store.save(master)
        projects.add_job(project.id, master_id)

        records: list[JobRecord] = [master]
        for code, clause in children:
            prompt = pose_locked_direction_prompt(clause, label=label)
            child_req = GenerateRequest(
                prompt=prompt,
                provider=req.provider,
                k_colors=req.k_colors,
                pixel_size=req.pixel_size,
                bg_provider=req.bg_provider,
                wrap_prompt=False,
                skip_bg_remove=req.skip_bg_remove,
                target_width=req.target_width,
                target_height=req.target_height,
            )
            record = self.start_generate(child_req, reference_bytes=None)
            record.extra["direction_batch_id"] = batch_id
            record.extra["direction"] = code
            record.extra["pose"] = req.pose.value
            record.extra["direction_role"] = "child"
            record.extra["project_id"] = project.id
            record.extra["base_prompt"] = label
            record.extra["parent_job_id"] = master_id
            record.extra["waiting_for_parent"] = True
            record.extra["reference_facing"] = master_code
            self.store.save(record)
            projects.add_job(project.id, record.id)
            records.append(record)

        return records

    def run_master_from_reference(self, master_id: str) -> None:
        """Ingest reference as master: copy snapped library sprite, or cutout+snap a file."""
        record = self.store.get(master_id)
        if record is None:
            return
        if record.status == JobStatus.cancelled:
            return

        try:
            ref_path = self.store.stage_path(master_id, "reference")
            raw_path = self.store.stage_path(master_id, "raw")
            if not ref_path.exists() and raw_path.exists():
                ref_path.write_bytes(raw_path.read_bytes())
            if not ref_path.exists():
                raise FileNotFoundError("Master reference image missing")

            image_bytes = ref_path.read_bytes()
            source = record.extra.get("master_source") or "file"

            if source == "library_snapped":
                # Already a snapped (or edited) library tile — use as-is.
                self.store.write_bytes(master_id, "raw", image_bytes)
                self.store.write_bytes(master_id, "cutout", image_bytes)
                snapped_path = self.store.write_bytes(master_id, "snapped", image_bytes)
                record.stages["raw"] = True
                record.stages["cutout"] = True
                record.stages["snapped"] = True
                try:
                    from PIL import Image
                    from io import BytesIO

                    with Image.open(BytesIO(image_bytes)) as im:
                        record.output_width, record.output_height = im.size
                except Exception:
                    pass
                self.store.save(record)
                if self._is_cancelled(master_id):
                    return
                self.store.set_status(record, JobStatus.completed)
                return

            if self._is_cancelled(master_id):
                return
            self.store.write_bytes(master_id, "raw", image_bytes)
            record.stages["raw"] = True
            self.store.save(record)

            self.store.set_status(record, JobStatus.removing_background)
            if self._is_cancelled(master_id):
                return
            cutout_bytes = remove_background(image_bytes, self.settings, record.bg_provider)
            cutout_path = self.store.write_bytes(master_id, "cutout", cutout_bytes)
            record.stages["cutout"] = True
            self.store.save(record)

            if self._is_cancelled(master_id):
                return
            self._snap(record, cutout_path)
            if self._is_cancelled(master_id):
                return
            self.store.set_status(record, JobStatus.completed)
        except Exception as exc:
            logger.exception("Master direction ingest %s failed", master_id)
            record = self.store.get(master_id) or record
            if record.status == JobStatus.cancelled:
                return
            self.store.set_status(
                record,
                JobStatus.failed,
                error=str(exc),
                stage_error=record.status.value,
            )

    def prepare_direction_children(self, master_id: str) -> list[str]:
        """Copy master's snapped sprite onto each child as reference. Returns child ids ready to run."""
        master = self.store.get(master_id)
        if master is None:
            return []
        snapped = self.store.stage_path(master_id, "snapped")
        if not snapped.exists():
            raise FileNotFoundError(
                "Master snapped image missing; cannot start direction children"
            )
        ref_bytes = snapped.read_bytes()
        batch_id = master.extra.get("direction_batch_id")
        child_ids: list[str] = []
        for job in self.store.list_jobs(limit=200):
            if job.extra.get("direction_batch_id") != batch_id:
                continue
            if job.extra.get("direction_role") != "child":
                continue
            self.store.write_bytes(job.id, "reference", ref_bytes)
            job.extra["had_reference"] = True
            job.extra["waiting_for_parent"] = False
            job.extra["parent_job_id"] = master_id
            job.extra["reference_from"] = "master_snapped"
            self.store.save(job)
            child_ids.append(job.id)
        return child_ids

    def fail_waiting_direction_children(self, master_id: str, error: str) -> None:
        master = self.store.get(master_id)
        if master is None:
            return
        batch_id = master.extra.get("direction_batch_id")
        for job in self.store.list_jobs(limit=200):
            if job.extra.get("direction_batch_id") != batch_id:
                continue
            if job.extra.get("direction_role") != "child":
                continue
            if not job.extra.get("waiting_for_parent"):
                continue
            self.store.set_status(
                job,
                JobStatus.failed,
                error=error,
                stage_error="queued",
            )

    def cancel_waiting_direction_children(self, master_id: str) -> None:
        master = self.store.get(master_id)
        if master is None:
            return
        batch_id = master.extra.get("direction_batch_id")
        for job in self.store.list_jobs(limit=200):
            if job.extra.get("direction_batch_id") != batch_id:
                continue
            if job.extra.get("direction_role") != "child":
                continue
            if job.status not in ACTIVE_JOB_STATUSES:
                continue
            self.store.set_status(
                job,
                JobStatus.cancelled,
                error="Cancelled",
                stage_error=job.status.value,
            )

    def cancel_job(self, job_id: str) -> JobRecord:
        record = self.store.get(job_id)
        if record is None:
            raise FileNotFoundError(f"Job not found: {job_id}")
        if record.status not in ACTIVE_JOB_STATUSES:
            raise RuntimeError("Job is not active")
        stage = record.status.value
        self.store.set_status(
            record,
            JobStatus.cancelled,
            error="Cancelled",
            stage_error=stage,
        )
        if record.extra.get("direction_role") == "master":
            self.cancel_waiting_direction_children(job_id)
        done = self.store.get(job_id)
        if done is None:
            raise FileNotFoundError(f"Job not found: {job_id}")
        return done

    def _is_cancelled(self, job_id: str) -> bool:
        record = self.store.get(job_id)
        return record is None or record.status == JobStatus.cancelled

    def run_direction_batch(self, master_id: str) -> list[str]:
        """Ingest master from reference, prepare children. Returns child ids to enqueue."""
        if self._is_cancelled(master_id):
            self.cancel_waiting_direction_children(master_id)
            return []
        self.run_master_from_reference(master_id)
        master = self.store.get(master_id)
        if master is None:
            return []
        if master.status == JobStatus.cancelled:
            self.cancel_waiting_direction_children(master_id)
            return []
        if master.status != JobStatus.completed:
            self.fail_waiting_direction_children(
                master_id, master.error or "Master direction failed"
            )
            return []
        try:
            return self.prepare_direction_children(master_id)
        except Exception as exc:
            logger.exception("Failed to prepare direction children for %s", master_id)
            self.fail_waiting_direction_children(master_id, str(exc))
            return []

    def _reset_job_for_retry(self, record: JobRecord) -> JobRecord:
        """Clear errors and output stages so the facing regenerates in-place."""
        for stage in ("raw", "cutout", "snapped", "edited"):
            path = self.store.stage_path(record.id, stage)
            if path.exists():
                path.unlink()
            record.stages[stage] = False
        # Keep reference.png for direction children / ref jobs.
        record.error = None
        record.stage_error = None
        record.detected_pixel_size = None
        record.output_width = None
        record.output_height = None
        self.store.save(record)
        self.store.set_status(record, JobStatus.queued)
        refreshed = self.store.get(record.id)
        if refreshed is None:
            raise FileNotFoundError(f"Job not found: {record.id}")
        return refreshed

    def retry_job(self, job_id: str) -> tuple[JobRecord, str]:
        """
        Re-queue a failed/cancelled job in place.
        Returns (record, pool_kind) where pool_kind is 'generate' or 'directions'.
        """
        record = self.store.get(job_id)
        if record is None:
            raise FileNotFoundError(f"Job not found: {job_id}")
        if record.status in ACTIVE_JOB_STATUSES:
            raise RuntimeError("Job is already running")
        if record.status == JobStatus.completed:
            raise RuntimeError("Job already completed")
        if record.status not in {JobStatus.failed, JobStatus.cancelled}:
            raise RuntimeError(f"Cannot retry job in status {record.status.value}")

        record = self._reset_job_for_retry(record)
        is_master = record.extra.get("direction_role") == "master"
        if is_master:
            # Re-arm waiting children that were failed with the master.
            batch_id = record.extra.get("direction_batch_id")
            for job in self.store.list_jobs(limit=200):
                if job.extra.get("direction_batch_id") != batch_id:
                    continue
                if job.extra.get("direction_role") != "child":
                    continue
                if job.status == JobStatus.completed:
                    continue
                if job.status in ACTIVE_JOB_STATUSES:
                    continue
                child = self._reset_job_for_retry(job)
                child.extra["waiting_for_parent"] = True
                child.extra.pop("reference_from", None)
                self.store.save(child)
            return record, "directions"
        return record, "generate"

    def retry_batch_incomplete(self, job_id: str) -> tuple[list[JobRecord], list[tuple[str, str]]]:
        """
        Retry all non-completed facings in a direction batch.
        Returns (updated_records, submits) where submits is [(kind, id), ...].
        """
        seed = self.store.get(job_id)
        if seed is None:
            raise FileNotFoundError(f"Job not found: {job_id}")
        batch_id = seed.extra.get("direction_batch_id")
        if not batch_id:
            raise RuntimeError("Job is not part of a direction batch")

        siblings = [
            j
            for j in self.store.list_jobs(limit=200)
            if j.extra.get("direction_batch_id") == batch_id
        ]
        if not siblings:
            raise RuntimeError("No jobs found for batch")
        if any(j.status in ACTIVE_JOB_STATUSES for j in siblings):
            raise RuntimeError("Batch still has active jobs")

        master = next(
            (j for j in siblings if j.extra.get("direction_role") == "master"),
            None,
        )
        if master is None:
            raise RuntimeError("Batch master not found")

        incomplete = [j for j in siblings if j.status != JobStatus.completed]
        if not incomplete:
            raise RuntimeError("All directions already completed")

        submits: list[tuple[str, str]] = []
        updated: list[JobRecord] = []

        if master.status != JobStatus.completed:
            # Master must run first; retry_job re-arms children.
            record, kind = self.retry_job(master.id)
            updated.append(record)
            submits.append((kind, record.id))
            # Refresh siblings after reset
            for j in self.store.list_jobs(limit=200):
                if j.extra.get("direction_batch_id") != batch_id:
                    continue
                if j.id == record.id:
                    continue
                updated.append(j)
            return updated, submits

        # Master done — ensure children have snapped reference, then enqueue incomplete.
        try:
            self.prepare_direction_children(master.id)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc

        for job in incomplete:
            if job.id == master.id:
                continue
            record = self._reset_job_for_retry(job)
            record.extra["waiting_for_parent"] = False
            self.store.save(record)
            # Re-copy reference after reset wiped stages but not reference file —
            # prepare_direction_children already wrote it; re-run for this id if missing.
            ref = self.store.stage_path(record.id, "reference")
            if not ref.exists():
                snapped = self.store.stage_path(master.id, "snapped")
                if snapped.exists():
                    self.store.write_bytes(record.id, "reference", snapped.read_bytes())
                    record.extra["had_reference"] = True
                    record.extra["reference_from"] = "master_snapped"
                    self.store.save(record)
            updated.append(record)
            submits.append(("generate", record.id))

        return updated, submits

    def run_generate(self, job_id: str) -> None:
        record = self.store.get(job_id)
        if record is None:
            return
        if record.status == JobStatus.cancelled:
            return

        try:
            self.store.set_status(record, JobStatus.generating)
            if self._is_cancelled(job_id):
                return
            provider = self.providers.get(record.provider.value)
            prompt = record.wrapped_prompt or record.prompt
            size = (
                record.image_size.value
                if hasattr(record.image_size, "value")
                else (record.image_size or "1024x1024")
            )
            ref_path = self.store.stage_path(job_id, "reference")
            if ref_path.exists():
                raw_bytes = provider.generate_with_reference(
                    prompt, ref_path.read_bytes(), self.settings, size=size
                )
            else:
                raw_bytes = provider.generate(prompt, self.settings, size=size)
            if self._is_cancelled(job_id):
                return
            self.store.write_bytes(job_id, "raw", raw_bytes)
            record.stages["raw"] = True
            self.store.save(record)

            if self._is_cancelled(job_id):
                return
            self.store.set_status(record, JobStatus.removing_background)
            if self._is_cancelled(job_id):
                return
            cutout_bytes = remove_background(
                raw_bytes, self.settings, record.bg_provider
            )
            if self._is_cancelled(job_id):
                return
            cutout_path = self.store.write_bytes(job_id, "cutout", cutout_bytes)
            record.stages["cutout"] = True
            self.store.save(record)

            if self._is_cancelled(job_id):
                return
            self._snap(record, cutout_path)
            if self._is_cancelled(job_id):
                return
            self.store.set_status(record, JobStatus.completed)
        except Exception as exc:
            logger.exception("Job %s failed", job_id)
            record = self.store.get(job_id) or record
            if record.status == JobStatus.cancelled:
                return
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

        if record.status in ACTIVE_JOB_STATUSES:
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
        if record.status == JobStatus.cancelled:
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
            if self._is_cancelled(job_id):
                return
            self._snap(record, cutout)
            if self._is_cancelled(job_id):
                return
            self.store.set_status(record, JobStatus.completed)
        except Exception as exc:
            logger.exception("Resnap %s failed", job_id)
            record = self.store.get(job_id) or record
            if record.status == JobStatus.cancelled:
                return
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
