# syntax=docker/dockerfile:1

FROM rust:1.85-bookworm AS snapper
WORKDIR /src
RUN git clone --depth 1 https://github.com/Hugo-Dz/spritefusion-pixel-snapper.git .
RUN cargo build --release

FROM python:3.11-slim-bookworm
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=snapper /src/target/release/spritefusion-pixel-snapper /usr/local/bin/spritefusion-pixel-snapper
COPY pyproject.toml README.md ./
COPY mcpixel ./mcpixel
COPY THIRD_PARTY_NOTICES ./

RUN pip install --no-cache-dir . \
    && pip install --no-cache-dir "numba>=0.60" "llvmlite>=0.43"

ENV HOST=0.0.0.0
ENV PORT=8787
ENV PUBLIC_BASE_URL=http://127.0.0.1:8787
ENV SNAPPER_BIN=/usr/local/bin/spritefusion-pixel-snapper
ENV DATA_DIR=/app/data
ENV REMBG_MODEL=birefnet-general

EXPOSE 8787
VOLUME ["/app/data"]

CMD ["uvicorn", "mcpixel.main:app", "--host", "0.0.0.0", "--port", "8787"]
