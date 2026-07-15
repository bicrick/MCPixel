# v4 research: animation / sprite sheets

Goal: short frame sequences (idle, walk) as discrete PNGs or a single sheet.

## Approaches

1. **Multi-frame generate** — N generate (or edit) calls with “frame i of n, motion …” prompts; stitch later
2. **Sheet + slice** — ask the model for a grid sheet, then slice by known rows/cols and snap each cell
3. **External tools** — export snapped stills into Aseprite / PixelLab animation flows (PixelLab MCP already exists in the broader tooling set)

## Product sketch

- Animation job type: frame count, FPS label (metadata only), base prompt
- Output: `frames/00.png…` plus optional `sheet.png`
- Preview: simple scrubber in the job inspector (no timeline editor in v4 research)

## Open questions

- Temporal consistency across frames without video models
- Whether snapper should run per-frame or on the sheet before slice
- Storage growth under `data/jobs` and cleanup UX

Research only in this pass — no animation pipeline code yet.
