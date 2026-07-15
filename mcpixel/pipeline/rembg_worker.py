"""CLI entrypoint: run rembg in an isolated process so ONNX crashes do not kill the job worker."""

from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path


def _run(input_path: Path, output_path: Path, model_name: str) -> None:
    from rembg import new_session, remove

    image_bytes = input_path.read_bytes()
    try:
        session = new_session(model_name)
        cutout = remove(image_bytes, session=session)
    except Exception:
        if model_name == "u2net":
            raise
        session = new_session("u2net")
        cutout = remove(image_bytes, session=session)

    if isinstance(cutout, bytes):
        raw = cutout
    else:
        buf = BytesIO()
        cutout.save(buf, format="PNG")
        raw = buf.getvalue()
    output_path.write_bytes(raw)


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 3:
        print(
            "usage: python -m mcpixel.pipeline.rembg_worker <input.png> <output.png> <model>",
            file=sys.stderr,
        )
        return 2
    input_path = Path(args[0])
    output_path = Path(args[1])
    model_name = args[2]
    try:
        _run(input_path, output_path, model_name)
    except Exception as exc:
        print(f"rembg_worker failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
