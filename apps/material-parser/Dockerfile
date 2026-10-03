FROM ghcr.io/astral-sh/uv:0.11.7 AS uv
FROM python:3.12.13-slim-bookworm
COPY --from=uv /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-impress fonts-noto-cjk fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV UV_LINK_MODE=copy UV_NO_CACHE=1 PYTHONDONTWRITEBYTECODE=1 HOME=/tmp
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen
COPY parser.py server.py test_parser.py ./
USER 65534:65534
EXPOSE 8090
CMD ["/app/.venv/bin/python", "server.py"]
