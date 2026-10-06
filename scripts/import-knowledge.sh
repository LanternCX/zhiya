#!/usr/bin/env bash
# Download and verify the public knowledge release, upload its assets to
# RustFS/S3, and import existing vectors into PostgreSQL. Python explains the
# target and requires confirmation before any download or storage write.
set -euo pipefail
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec uv run --locked --project "$PROJECT_ROOT/apps/knowledge" \
  python -m preparation.import_release "$@"
