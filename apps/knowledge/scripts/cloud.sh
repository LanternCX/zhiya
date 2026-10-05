#!/usr/bin/env bash
set -euo pipefail

knowledge_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v uv >/dev/null 2>&1; then
  echo 'Install uv before running this script. See the knowledge README.' >&2
  exit 1
fi

# The first invocation installs the locked GPU inference dependencies.
# No cloud account, instance creation or model API is involved.
exec uv run --locked --extra embedding --project "$knowledge_dir" \
  python -m embedding.embed "$@"
