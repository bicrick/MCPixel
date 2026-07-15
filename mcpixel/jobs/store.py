from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from mcpixel.config import Settings
from mcpixel.jobs.models import JobRecord, JobStatus


class JobStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.settings.jobs_dir.mkdir(parents=True, exist_ok=True)

    def _job_dir(self, job_id: str) -> Path:
        return self.settings.jobs_dir / job_id

    def _meta_path(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "meta.json"

    def create(self, record: JobRecord) -> JobRecord:
        job_dir = self._job_dir(record.id)
        job_dir.mkdir(parents=True, exist_ok=True)
        self.save(record)
        return record

    def new_id(self) -> str:
        return uuid.uuid4().hex[:12]

    def save(self, record: JobRecord) -> None:
        record.touch()
        path = self._meta_path(record.id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(record.model_dump_json(indent=2), encoding="utf-8")

    def get(self, job_id: str) -> JobRecord | None:
        path = self._meta_path(job_id)
        if not path.exists():
            return None
        return JobRecord.model_validate_json(path.read_text(encoding="utf-8"))

    def list_jobs(self, limit: int = 50) -> list[JobRecord]:
        jobs: list[JobRecord] = []
        for meta in sorted(
            self.settings.jobs_dir.glob("*/meta.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        ):
            try:
                jobs.append(
                    JobRecord.model_validate_json(meta.read_text(encoding="utf-8"))
                )
            except Exception:
                continue
            if len(jobs) >= limit:
                break
        return jobs

    def stage_path(self, job_id: str, stage: str) -> Path:
        return self._job_dir(job_id) / f"{stage}.png"

    def mark_stage(self, record: JobRecord, stage: str, present: bool = True) -> None:
        record.stages[stage] = present
        self.save(record)

    def set_status(
        self,
        record: JobRecord,
        status: JobStatus,
        error: str | None = None,
        stage_error: str | None = None,
    ) -> None:
        # Cooperative cancel: never clobber cancelled with a later pipeline status.
        if status != JobStatus.cancelled:
            current = self.get(record.id)
            if current is not None and current.status == JobStatus.cancelled:
                record.status = JobStatus.cancelled
                record.error = current.error
                record.stage_error = current.stage_error
                return
        record.status = status
        if error is not None:
            record.error = error
        if stage_error is not None:
            record.stage_error = stage_error
        self.save(record)

    def write_bytes(self, job_id: str, stage: str, data: bytes) -> Path:
        path = self.stage_path(job_id, stage)
        path.write_bytes(data)
        return path

    def delete(self, job_id: str) -> bool:
        job_dir = self._job_dir(job_id)
        if not job_dir.exists():
            return False
        shutil.rmtree(job_dir)
        return True

    def clear_failed(self) -> int:
        removed = 0
        for job in self.list_jobs(limit=10_000):
            if job.status in {JobStatus.failed, JobStatus.cancelled} and self.delete(
                job.id
            ):
                removed += 1
        return removed
