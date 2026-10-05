#!/usr/bin/env bash
set -euo pipefail

knowledge_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
workspace_dir="$(cd -- "$knowledge_dir/../../.." && pwd)"
route="${1:-}"
command="${2:-}"
if [[ ( "$route" != text && "$route" != visual ) ||
      ( "$command" != check && "$command" != doctor && "$command" != download-model && "$command" != run ) ]]; then
  echo 'Usage: workspace.sh text|visual check|doctor|download-model|run [options]' >&2
  exit 1
fi
shift 2
config=embedding.toml
if [[ "$route" == text ]]; then config=embedding-text.toml; fi
if [[ "$command" == run || "$command" == check ]]; then
  if [[ " $* " != *' --data-dir '* ]]; then
    echo 'Specify --data-dir for each dataset.' >&2
    exit 1
  fi
fi
if [[ "$command" == run && " $* " != *' --output-dir '* ]]; then
  echo 'Specify a separate --output-dir for each dataset and route.' >&2
  exit 1
fi
export UV_PROJECT_ENVIRONMENT="$workspace_dir/env"
export UV_PYTHON_INSTALL_DIR="$workspace_dir/python"
export UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/zhiya-embedding-uv-cache}"
export HF_XET_CACHE="${HF_XET_CACHE:-/tmp/zhiya-embedding-xet-cache}"
uv_command="$workspace_dir/bin/uv"
if [[ ! -x "$uv_command" ]]; then uv_command=uv; fi
exec "$uv_command" run --locked --extra embedding --project "$knowledge_dir" \
  python -m embedding.embed "$command" --config "$knowledge_dir/configs/$config" \
  --model-cache "$workspace_dir/models" "$@"
