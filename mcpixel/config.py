from __future__ import annotations

from pathlib import Path

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
    openai_text_model: str = "gpt-5-nano"
    rembg_model: str = "birefnet-general"
    alpha_harden_threshold: int = 128
    public_base_url: str = "http://127.0.0.1:8787"
    remove_bg_api_key: str | None = None
    default_prompt_suffix: str = (
        "True pixel art sprite, limited color palette, flat colors, "
        "crisp pixels, no anti-aliasing, no blur, solid simple background, "
        "game asset, centered subject."
    )

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"


def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.jobs_dir.mkdir(parents=True, exist_ok=True)
    return settings
