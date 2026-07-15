from __future__ import annotations

from openai import OpenAI

from mcpixel.config import Settings

REFINE_SYSTEM = """You refine prompts for pixel-art game sprite generation.
Rewrite the user's prompt into a clear, specific pixel-art sprite prompt.
Preserve their subject and intent. Prefer: view/angle, silhouette, limited palette cues,
flat colors, crisp pixels, no anti-aliasing, centered game asset.
Do not invent unrelated characters or scenes. Return only the refined prompt text,
with no quotes, labels, or explanation."""


def refine_pixel_prompt(prompt: str, settings: Settings) -> str:
    if not settings.openai_api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Add it in Settings or .env to refine prompts."
        )
    text = prompt.strip()
    if not text:
        raise ValueError("Prompt is empty")

    client = OpenAI(api_key=settings.openai_api_key)
    response = client.chat.completions.create(
        model=settings.openai_text_model,
        messages=[
            {"role": "system", "content": REFINE_SYSTEM},
            {"role": "user", "content": text},
        ],
    )
    refined = (response.choices[0].message.content or "").strip()
    if not refined:
        raise RuntimeError("Model returned an empty refined prompt")
    return refined
