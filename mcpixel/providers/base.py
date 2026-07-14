from __future__ import annotations

from abc import ABC, abstractmethod

from mcpixel.config import Settings


class ImageProvider(ABC):
    name: str

    @abstractmethod
    def generate(self, prompt: str, settings: Settings) -> bytes:
        """Return PNG bytes for the given prompt."""


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
