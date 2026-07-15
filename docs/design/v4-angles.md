# v4 research: angles / multi-view

Goal: produce facing variants (front / side / back / 3/4) of the same sprite for game use.

## Approaches

1. **Prompt packs** — fixed templates (“same character, side view, …”) with optional size hint; cheapest to ship
2. **Edit with reference** — `images.edit` using the best existing frame as identity lock
3. **Local rotate** — only for flat/top-down assets; trivial PIL rotate, useless for side-view characters that need redrawn silhouettes

## Product sketch

- Angle chips on Create or on a completed job: Front / Side / Back / 3-4
- Batch enqueue N jobs sharing a project + parent job id
- Optional “match palette” note in the wrapped prompt

## Open questions

- Whether gpt-image-2 edit refs are strong enough to keep silhouette without a LoRA/custom model
- How many angles are “enough” for Minecraft-style vs platformer pipelines
- Should angle jobs inherit rembg/snap settings automatically from the parent
