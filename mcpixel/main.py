from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from mcpixel.api.routes import router
from mcpixel.config import get_settings
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

    app = FastAPI(title="MCPixel", version="0.1.0")
    app.state.settings = settings
    app.state.store = store
    app.state.projects = projects
    app.state.runner = runner
    app.include_router(router)

    if STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

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
