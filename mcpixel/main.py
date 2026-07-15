from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.types import Scope


class NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store"
        return response


from mcpixel.api.routes import router
from mcpixel.config import get_settings
from mcpixel.jobs.pool import JobPool
from mcpixel.jobs.runner import JobRunner, build_registry
from mcpixel.jobs.store import JobStore
from mcpixel.projects import ProjectStore
from mcpixel.settings_store import apply_settings_file, load_settings_file

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcpixel")

STATIC_DIR = Path(__file__).resolve().parent / "static"


def create_app() -> FastAPI:
    settings = get_settings()
    apply_settings_file(settings, load_settings_file(settings))
    store = JobStore(settings)
    projects = ProjectStore(settings)
    runner = JobRunner(settings, store, build_registry())
    job_pool = JobPool(settings.data_dir, max_workers=settings.max_parallel_jobs)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        from mcpixel.jobs.models import ACTIVE_JOB_STATUSES, JobStatus

        stale = 0
        for job in store.list_jobs(limit=10_000):
            if job.status not in ACTIVE_JOB_STATUSES:
                continue
            store.set_status(
                job,
                JobStatus.failed,
                error="Interrupted by server restart",
                stage_error=job.status.value,
            )
            stale += 1
        if stale:
            logger.warning("Marked %s leftover active job(s) as failed on startup", stale)
        yield
        pool: JobPool = app.state.job_pool
        pool.shutdown(wait=False)

    app = FastAPI(title="MCPixel", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.store = store
    app.state.projects = projects
    app.state.runner = runner
    app.state.job_pool = job_pool
    app.include_router(router)

    if STATIC_DIR.exists():
        app.mount("/static", NoCacheStaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(
            STATIC_DIR / "index.html",
            headers={"Cache-Control": "no-store"},
        )

    return app


app = create_app()


def run() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "mcpixel.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    run()
