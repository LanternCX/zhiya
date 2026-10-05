"""Package a finalized corpus and its locked offline runner for a GPU machine."""
import argparse
import json
import shutil
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[2]

CHECK = '''import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
sys.path.insert(0, str(root / "apps/knowledge/src"))
from embedding.embed import read_config, inspect_input

reports = {}
for route, name in [("text", "embedding-text.toml"), ("visual", "embedding.toml")]:
    config = read_config(root / "apps/knowledge/configs" / name,
                         type("Args", (), {"data_dir": root / "data/knowledge"})())
    reports[route] = inspect_input(config)
print(json.dumps(reports, ensure_ascii=False, indent=2))
'''

RUN = '''#!/usr/bin/env bash
set -euo pipefail
bundle_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project="$bundle_root/apps/knowledge"
if ! command -v uv >/dev/null 2>&1; then
  echo 'Install uv before running this bundle.' >&2
  exit 1
fi
command="${1:-check}"
case "$command" in
  check)
    exec uv run --locked --project "$project" python "$bundle_root/check-inputs.py"
    ;;
  run)
    uv run --locked --project "$project" python "$bundle_root/check-inputs.py"
    for config in embedding-text.toml embedding.toml; do
      uv run --locked --extra embedding --project "$project" python -m embedding.embed run \\
        --config "$project/configs/$config" --data-dir "$bundle_root/data/knowledge"
    done
    ;;
  *) echo 'Usage: bash run-embeddings.sh [check|run]' >&2; exit 1 ;;
esac
'''


def package(root, output):
    report = json.loads((root / 'report.json').read_text())
    if not report.get('selection_finalized') or report.get('visual_review_chunk_ids'):
        raise ValueError('Finalize embedding selection before packaging')
    if output.exists():
        raise ValueError('Output already exists; use a new output directory')
    if output.is_relative_to(root):
        raise ValueError('Bundle output must be outside the dataset directory')
    output.mkdir(parents=True)
    shutil.copytree(root, output / 'data/knowledge')
    runtime = output / 'apps/knowledge'
    runtime.mkdir(parents=True)
    for name in ('pyproject.toml', 'uv.lock'):
        shutil.copy2(PROJECT / name, runtime / name)
    for name in ('src', 'configs'):
        shutil.copytree(PROJECT / name, runtime / name,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.egg-info'))
    (output / 'check-inputs.py').write_text(CHECK)
    (output / 'run-embeddings.sh').write_text(RUN)
    (output / 'run-embeddings.sh').chmod(0o755)
    (output / 'README.md').write_text('''# 知芽知识库离线 Embedding 包

上传并解压完整目录，无需主仓库、原始资料目录、Office 或 API Key。
计算云需要 NVIDIA GPU、兼容驱动与 uv。所有数据字节、模型配置、代码和依赖锁文件已包含。
首次运行会下载公开模型权重和安装推理依赖；本脚本不调用托管模型 API。

```sh
bash run-embeddings.sh check
bash run-embeddings.sh run
```

文本使用 Qwen3-Embedding-8B，视觉使用 Qwen3-VL-Embedding-8B，均为原生 4096 维，版本固定在配置中。
两路依次运行，避免同时占用显存。输出分别位于 data/embeddings/qwen3-text-8b 和 data/embeddings/qwen3-vl-8b-visual。
重复执行 run 可以恢复同一批任务。输入、模型、配置或代码变更时使用新的输出目录。
云端完整模型推理需要先检查显存、样本检索效果和与线上查询服务的一致性。
数据的来源、处理限制和许可说明见 data/knowledge/README.md。
''', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    package(args.data_dir.expanduser().resolve(), args.output_dir.expanduser().resolve())


if __name__ == '__main__':
    main()
