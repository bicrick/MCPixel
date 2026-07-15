# v4 research: angles / multi-view

Goal: produce facing variants of the same sprite for game use.

## Shipped approach (Pose = 8 directions)

**Eight separate jobs**, not one sheet to extract.

1. User sets Pose → **8 directions** (or **Create 8 rotations** tab).
2. **Reference required** — library snapped sprite or file; longest side ≤ **1024px**.
3. User picks **which way the reference already faces**. That facing becomes the **master** with **no image regenerate** (library snapped copied as-is; file uploads get cutout + snap only).
4. The master’s snapped sprite is re-passed as reference into the **other seven** jobs, with pose-locked prompts (same pose, rotate facing only).
5. All eight land in an auto-created project; queue collapses the batch into one row.

Endpoint: `POST /v1/generate/directions` (JSON or multipart) with `reference_facing`.

Local geometric rotate is **not** used for characters.

## Why not a single sheet?

- rembg/snap expect one subject; sheet cells often touch or mis-align
- GPT Image often ignores freeform grid prompts
- Scaffold-fill (template PNG → fill cells → crop) is a promising later experiment, not V1

## Later

- Pose = turnaround (front / ¾ / side / back)
- Sheet download (assemble 8 snapped frames)
- Per-direction regenerate
- Animation via image→video→frames
- Optional ControlNet / video backends for reliability

## Older notes

Approaches considered: prompt packs, edit with reference (chosen), local rotate (rejected for characters).
