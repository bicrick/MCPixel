# v4 research: image edit / reference images

Goal: refine an existing sprite or keep character consistency using OpenAI Images edit, not only text→image generate.

## Candidate API shape

```python
client.images.edit(
    model="gpt-image-2",  # or current Images edit-capable model
    image=open("snapped.png", "rb"),
    prompt="same slime, facing left, thicker outline",
)
```

Possible uses in MCPixel:

- **Refine**: edit from `snapped` / `edited` with a short instruction
- **Consistency**: pass a prior sprite as reference while generating a variant
- **Mask edit** (if supported): protect silhouette while changing colors/details

## Product notes

- Keep pipeline stages (`raw` → `cutout` → `snapped` → `edited`); a model edit probably lands as a new `raw` or dedicated `model_edit` stage before rembg/snap
- UI: “Edit with AI” beside the pixel editor, optional reference picker from queue/project
- Cost / latency: treat as a first-class job status, same polling model as generate

## Open questions

- Which models accept edit + multi-image refs in the account’s API version
- Whether cutout/snapped or original raw is the better edit input for rembg stability
- How to store prompt history for edit chains without bloating `meta.json`
