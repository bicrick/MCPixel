# MCPixel

Local pixel art suite: **generate → remove background → snap to grid → tweak**.

Drive it from the browser UI or from Cursor via MCP. Bring your own API keys (BYOK). Not an official Sprite Fusion product; uses [Pixel Snapper](https://github.com/Hugo-Dz/spritefusion-pixel-snapper) as a binary dependency (MIT — see `THIRD_PARTY_NOTICES`).

## Quick start (dev)

Prereqs: Python 3.11+, [uv](https://github.com/astral-sh/uv), and a built Pixel Snapper binary.

```bash
# sibling checkout recommended
# ~/Desktop/spritefusion-pixel-snapper  (cargo build --release)
# ~/Desktop/mcpixel

cd ~/Desktop/mcpixel
cp .env.example .env
# edit .env — set OPENAI_API_KEY and SNAPPER_BIN if needed

uv sync
uv run uvicorn mcpixel.main:app --host 127.0.0.1 --port 8787
```

Open http://127.0.0.1:8787

Without an OpenAI key you can still **upload a PNG** and run cutout + snap.

## Docker (share with others)

```bash
cp .env.example .env   # add OPENAI_API_KEY
docker compose up --build
```

## MCP (Cursor)

1. Start the API (`uv run uvicorn …` or Docker).
2. Add to Cursor MCP config:

```json
{
  "mcpServers": {
    "mcpixel": {
      "command": "uv",
      "args": ["run", "--directory", "/Users/YOU/Desktop/mcpixel", "mcpixel-mcp"],
      "env": {
        "MCPIXEL_URL": "http://127.0.0.1:8787"
      }
    }
  }
}
```

Tools: `health`, `generate_sprite`, `list_jobs`, `get_job`, `resnap`.

## Pipeline

```text
prompt → OpenAI Images → rembg (BiRefNet) + alpha harden → pixel snapper → optional edit
```

- **Resnap** reuses `cutout.png` (no new generation cost).
- **Skip** background removal if the image is already transparent.

## License

MIT for MCPixel. Pixel Snapper remains copyright Hugo Duprez (MIT) — see `THIRD_PARTY_NOTICES`.
