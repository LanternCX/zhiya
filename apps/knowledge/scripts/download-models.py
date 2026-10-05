"""Download pinned model weights without loading a model or touching a dataset."""
import argparse
import json
from pathlib import Path
import tomllib

from huggingface_hub import snapshot_download

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model-cache', type=Path, required=True)
parser.add_argument('--workers', type=int, default=1)
args = parser.parse_args()
if args.workers < 1:
    parser.error('--workers must be positive')
project = Path(__file__).resolve().parents[1]
for name in ('embedding-text.toml', 'embedding.toml'):
    config = tomllib.loads((project / 'configs' / name).read_text())
    path = snapshot_download(config['model_id'], revision=config['model_revision'],
                             cache_dir=str(args.model_cache.resolve()), max_workers=args.workers)
    print(json.dumps({'model': config['model_id'], 'revision': config['model_revision'],
                      'path': path}), flush=True)
