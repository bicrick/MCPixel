from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, Field

from mcpixel.config import Settings


class Project(BaseModel):
    id: str
    name: str
    job_ids: list[str] = Field(default_factory=list)
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc).isoformat()


class ProjectStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.path = settings.data_dir / "projects.json"
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)

    def _load(self) -> list[Project]:
        if not self.path.exists():
            return []
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            return [Project.model_validate(p) for p in raw.get("projects", [])]
        except Exception:
            return []

    def _save(self, projects: list[Project]) -> None:
        payload = {"projects": [p.model_dump() for p in projects]}
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def list_projects(self) -> list[Project]:
        return sorted(self._load(), key=lambda p: p.updated_at, reverse=True)

    def get(self, project_id: str) -> Project | None:
        for p in self._load():
            if p.id == project_id:
                return p
        return None

    def create(self, name: str) -> Project:
        projects = self._load()
        project = Project(id=uuid.uuid4().hex[:12], name=name.strip() or "Untitled")
        projects.append(project)
        self._save(projects)
        return project

    def rename(self, project_id: str, name: str) -> Project | None:
        projects = self._load()
        for p in projects:
            if p.id == project_id:
                p.name = name.strip() or p.name
                p.touch()
                self._save(projects)
                return p
        return None

    def delete(self, project_id: str) -> bool:
        projects = self._load()
        next_list = [p for p in projects if p.id != project_id]
        if len(next_list) == len(projects):
            return False
        self._save(next_list)
        return True

    def add_job(self, project_id: str, job_id: str) -> Project | None:
        projects = self._load()
        for p in projects:
            if p.id == project_id:
                if job_id not in p.job_ids:
                    p.job_ids.append(job_id)
                    p.touch()
                    self._save(projects)
                return p
        return None

    def remove_job(self, project_id: str, job_id: str) -> Project | None:
        projects = self._load()
        for p in projects:
            if p.id == project_id:
                p.job_ids = [j for j in p.job_ids if j != job_id]
                p.touch()
                self._save(projects)
                return p
        return None

    def projects_for_job(self, job_id: str) -> list[Project]:
        return [p for p in self._load() if job_id in p.job_ids]

    def remove_job_from_all(self, job_id: str) -> None:
        projects = self._load()
        changed = False
        for p in projects:
            if job_id in p.job_ids:
                p.job_ids = [j for j in p.job_ids if j != job_id]
                p.touch()
                changed = True
        if changed:
            self._save(projects)
