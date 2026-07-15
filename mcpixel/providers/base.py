from __future__ import annotations

from abc import ABC, abstractmethod

from mcpixel.config import Settings


class ImageProvider(ABC):
    name: str

    @abstractmethod
    def generate(
        self, prompt: str, settings: Settings, *, size: str = "1024x1024"
    ) -> bytes:
        """Return PNG bytes for the given prompt."""

    def generate_with_reference(
        self,
        prompt: str,
        image_bytes: bytes,
        settings: Settings,
        *,
        size: str = "1024x1024",
    ) -> bytes:
        raise NotImplementedError(
            f"Provider {self.name} does not support reference images"
        )

class ProviderRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, ImageProvider] = {}

    def register(self, provider: ImageProvider) -> None:
        self._providers[provider.name] = provider

    def get(self, name: str) -> ImageProvider:
        if name not in self._providers:
            raise KeyError(f"Unknown image provider: {name}")
        return self._providers[name]

    def available(self) -> list[str]:
        return sorted(self._providers.keys())
