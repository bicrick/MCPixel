from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SNAPPER = (
    Path.home()
    / "Desktop"
    / "spritefusion-pixel-snapper"
    / "target"
    / "release"
    / "spritefusion-pixel-snapper"
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "127.0.0.1"
    port: int = 8787
    data_dir: Path = ROOT / "data"
    snapper_bin: Path = DEFAULT_SNAPPER
    openai_api_key: str | None = None
    openai_image_model: str = "gpt-image-1"
    # Fast/cheap chat model for prompt polish (not image gen).
    openai_text_model: str = "gpt-5.6-luna"
    # u2net (~176MB) fits typical Docker heaps; birefnet-general (~1GB) often OOMs.
    rembg_model: str = "u2net"
    alpha_harden_threshold: int = 128
    public_base_url: str = "http://127.0.0.1:8787"
    remove_bg_api_key: str | None = None
    max_parallel_jobs: int = 4
    # Runtime map of prompt overrides (from settings.json). Not loaded from env.
    prompt_overrides: dict[str, Any] = Field(default_factory=dict)

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    @property
    def default_prompt_suffix(self) -> str:
        """Deprecated alias — prefer prompts.resolve.get_prompt(..., 'wrap_suffix')."""
        from mcpixel.prompts.resolve import get_prompt

        return get_prompt(self, "wrap_suffix")


def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.jobs_dir.mkdir(parents=True, exist_ok=True)
    return settings
