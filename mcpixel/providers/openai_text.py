from __future__ import annotations

from openai import OpenAI

from mcpixel.config import Settings
from mcpixel.providers.refine_prompts import refine_system_prompt


def refine_pixel_prompt(
    prompt: str,
    settings: Settings,
    *,
    kind: str = "sprite",
) -> str:
    if not settings.openai_api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Add it in Settings or .env to refine prompts."
        )
    text = prompt.strip()
    if not text:
        raise ValueError("Prompt is empty")

    client = OpenAI(api_key=settings.openai_api_key)
    kwargs: dict = {
        "model": settings.openai_text_model,
        "messages": [
            {"role": "system", "content": refine_system_prompt(kind, settings)},
            {"role": "user", "content": text},
        ],
        # Cap length — refine should stay short.
        "max_completion_tokens": 400,
    }
    model = (settings.openai_text_model or "").lower()
    # GPT-5.x supports reasoning_effort; "none" keeps Luna snappy for polish.
    if model.startswith("gpt-5"):
        kwargs["reasoning_effort"] = "none"
    else:
        kwargs["temperature"] = 0.4
        kwargs["max_tokens"] = 400
        kwargs.pop("max_completion_tokens", None)

    response = client.chat.completions.create(**kwargs)
    refined = (response.choices[0].message.content or "").strip()
    if not refined:
        raise RuntimeError("Model returned an empty refined prompt")
    # Strip accidental wrapping quotes some models add
    if len(refined) >= 2 and refined[0] == refined[-1] and refined[0] in "\"'":
        refined = refined[1:-1].strip()
    return refined
