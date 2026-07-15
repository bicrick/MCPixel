from __future__ import annotations

import logging
import threading
from collections import deque
from concurrent.futures import Future, ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)

JobKind = Literal["generate", "directions", "resnap"]

MIN_PARALLEL_JOBS = 1
MAX_PARALLEL_JOBS = 16


def clamp_parallel_jobs(n: int) -> int:
    return max(MIN_PARALLEL_JOBS, min(MAX_PARALLEL_JOBS, int(n)))


def _run_in_worker(kind: str, job_id: str, data_dir: str) -> list[str] | None:
    """Picklable entrypoint: rebuild runner in the child and execute one job.

    For ``directions``, returns child job ids ready to enqueue as ``generate``.
    """
    from mcpixel.config import Settings
    from mcpixel.jobs.models import JobStatus
    from mcpixel.jobs.runner import JobRunner, build_registry
    from mcpixel.jobs.store import JobStore
    from mcpixel.settings_store import apply_settings_file, load_settings_file

    settings = Settings(data_dir=Path(data_dir))
    apply_settings_file(settings, load_settings_file(settings))
    store = JobStore(settings)
    record = store.get(job_id)
    if record is None or record.status == JobStatus.cancelled:
        return None

    runner = JobRunner(settings, store, build_registry())

    if kind == "generate":
        runner.run_generate(job_id)
        return None
    if kind == "directions":
        return runner.run_direction_batch(job_id)
    if kind == "resnap":
        runner.run_resnap(job_id)
        return None
    raise ValueError(f"Unknown job kind: {kind}")


class JobPool:
    """FIFO job queue capped by max_parallel_jobs, executed in child processes."""

    def __init__(self, data_dir: Path, max_workers: int = 4) -> None:
        self._data_dir = str(Path(data_dir).resolve())
        self._max_workers = clamp_parallel_jobs(max_workers)
        self._pending: deque[tuple[JobKind, str]] = deque()
        self._futures: dict[str, Future] = {}
        self._lock = threading.Lock()
        self._active = 0
        self._closed = False
        self._executor_generation = 0
        # Pool sized to hard max so set_max_workers only changes the dispatch cap.
        self._executor = ProcessPoolExecutor(max_workers=MAX_PARALLEL_JOBS)
        self._wake = threading.Event()
        self._dispatcher = threading.Thread(
            target=self._dispatch_loop,
            name="mcpixel-job-dispatcher",
            daemon=True,
        )
        self._dispatcher.start()

    @property
    def max_workers(self) -> int:
        return self._max_workers

    def set_max_workers(self, n: int) -> None:
        with self._lock:
            self._max_workers = clamp_parallel_jobs(n)
        self._wake.set()

    def submit(self, kind: JobKind, job_id: str) -> None:
        if self._closed:
            raise RuntimeError("JobPool is shut down")
        with self._lock:
            # Avoid duplicate pending entries for the same id.
            if any(jid == job_id for _, jid in self._pending):
                return
            if job_id in self._futures:
                return
            self._pending.append((kind, job_id))
        self._wake.set()

    def cancel(self, job_id: str) -> bool:
        """Remove from pending and try to cancel an in-flight future. Returns True if found."""
        found = False
        with self._lock:
            kept = deque()
            while self._pending:
                kind, jid = self._pending.popleft()
                if jid == job_id:
                    found = True
                else:
                    kept.append((kind, jid))
            self._pending = kept
            future = self._futures.get(job_id)
        if future is not None:
            if future.cancel():
                found = True
            # Running futures cannot be cancelled; cooperative abort via store status.
        return found

    def shutdown(self, *, wait: bool = False) -> None:
        self._closed = True
        self._wake.set()
        self._executor.shutdown(wait=wait, cancel_futures=not wait)

    def _dispatch_loop(self) -> None:
        while True:
            self._wake.wait(timeout=0.5)
            self._wake.clear()
            if self._closed:
                return
            while self._try_dispatch_one():
                pass

    def _try_dispatch_one(self) -> bool:
        from mcpixel.config import Settings
        from mcpixel.jobs.models import JobStatus
        from mcpixel.jobs.store import JobStore

        with self._lock:
            if self._closed or self._active >= self._max_workers:
                return False
            if not self._pending:
                return False
            kind, job_id = self._pending.popleft()
            self._active += 1
            generation = self._executor_generation

        # Skip jobs already cancelled on disk (set by API before dispatch).
        try:
            store = JobStore(Settings(data_dir=Path(self._data_dir)))
            record = store.get(job_id)
            if record is None or record.status == JobStatus.cancelled:
                with self._lock:
                    self._active -= 1
                return True
        except Exception:
            logger.exception("Failed to check job %s before dispatch", job_id)

        try:
            with self._lock:
                if self._closed or generation != self._executor_generation:
                    self._active -= 1
                    self._pending.appendleft((kind, job_id))
                    return False
                executor = self._executor
            future = executor.submit(_run_in_worker, kind, job_id, self._data_dir)
        except BrokenProcessPool as exc:
            logger.error("Executor broken on submit for %s: %s", job_id, exc)
            self._mark_worker_failure(job_id, kind, exc)
            with self._lock:
                self._active -= 1
            self._rebuild_executor()
            return True
        except Exception:
            logger.exception("Failed to submit job %s (%s)", job_id, kind)
            with self._lock:
                self._active -= 1
            return True

        with self._lock:
            self._futures[job_id] = future
        future.add_done_callback(
            lambda f, jid=job_id, k=kind, gen=generation: self._on_done(f, k, jid, gen)
        )
        return True

    def _on_done(
        self, future: Future, kind: JobKind, job_id: str, generation: int
    ) -> None:
        child_ids: list[str] | None = None
        rebuild = False
        try:
            exc = future.exception()
            if exc is not None:
                logger.error(
                    "Worker failed for %s (%s): %s", job_id, kind, exc, exc_info=exc
                )
                self._mark_worker_failure(job_id, kind, exc)
                if isinstance(exc, BrokenProcessPool):
                    rebuild = True
            elif kind == "directions":
                result = future.result()
                if isinstance(result, list):
                    child_ids = result
        except Exception:
            logger.exception("Error inspecting worker future for %s", job_id)

        with self._lock:
            self._active = max(0, self._active - 1)
            self._futures.pop(job_id, None)

        if rebuild:
            self._rebuild_executor(expected_generation=generation)

        if child_ids:
            for child_id in child_ids:
                self.submit("generate", child_id)

        self._wake.set()

    def _mark_worker_failure(self, job_id: str, kind: JobKind, exc: BaseException) -> None:
        from mcpixel.config import Settings
        from mcpixel.jobs.models import ACTIVE_JOB_STATUSES, JobStatus
        from mcpixel.jobs.store import JobStore

        store = JobStore(Settings(data_dir=Path(self._data_dir)))
        crashed = isinstance(exc, BrokenProcessPool)
        base_msg = (
            "Worker process crashed"
            if crashed
            else (str(exc) or exc.__class__.__name__)
        )

        def fail_if_active(record) -> None:
            if record.status not in ACTIVE_JOB_STATUSES:
                return
            stage = record.status.value
            store.set_status(
                record,
                JobStatus.failed,
                error=f"{base_msg} during {stage}",
                stage_error=stage,
            )

        record = store.get(job_id)
        if record is None:
            return
        fail_if_active(record)

        batch_id = record.extra.get("direction_batch_id")
        # Directions task owns the whole batch until children are handed off.
        # Also fail siblings still active when a directions worker dies mid-master.
        if kind == "directions" and batch_id:
            for job in store.list_jobs(limit=200):
                if job.extra.get("direction_batch_id") != batch_id:
                    continue
                if job.id == job_id:
                    continue
                fail_if_active(job)

    def _rebuild_executor(self, expected_generation: int | None = None) -> None:
        with self._lock:
            if self._closed:
                return
            if (
                expected_generation is not None
                and expected_generation != self._executor_generation
            ):
                return
            old = self._executor
            self._executor_generation += 1
            self._futures.clear()
            self._active = 0
            self._executor = ProcessPoolExecutor(max_workers=MAX_PARALLEL_JOBS)
            logger.warning(
                "Rebuilt process pool after worker crash (generation %s)",
                self._executor_generation,
            )
        try:
            old.shutdown(wait=False, cancel_futures=True)
        except Exception:
            logger.exception("Error shutting down broken process pool")
        self._wake.set()
