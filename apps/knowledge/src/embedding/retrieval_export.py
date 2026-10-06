"""Stream completed offline embeddings for the server's database import."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq


def export(root):
    run = json.loads((root / 'run.json').read_text())
    if run['status'] != 'complete' or run['completed'] != run['selected'] or not run['normalized']:
        raise ValueError('Only complete, normalized embedding jobs can be imported')
    final = root / 'final/embeddings.parquet'
    if not final.exists():
        final = root / 'embeddings.parquet'
    files = [final] if final.exists() else sorted(root.glob('part-*.parquet'))
    settings = run['settings']
    profile = {'model': settings['model_id'], 'revision': settings['model_revision'],
               'dimension': settings['dimension'], 'route': settings['view'],
               'instruction': settings['instruction'], 'normalized': True,
               'count': run['selected'], 'settings': settings}
    profile['id'] = hashlib.sha256(json.dumps(profile, sort_keys=True).encode()).hexdigest()
    seen = set()
    # Validate before emitting any data to the importing process.
    for file in files:
        for batch in pq.ParquetFile(file).iter_batches(batch_size=64):
            for row in batch.to_pylist():
                vector = np.asarray(row['embedding'], dtype=np.float32)
                if row['chunk_id'] in seen or vector.shape != (profile['dimension'],) or not np.isfinite(vector).all():
                    raise ValueError('Invalid or duplicate embedding')
                if abs(float(np.linalg.norm(vector)) - 1) > 1e-5:
                    raise ValueError('Embedding is not normalized')
                seen.add(row['chunk_id'])
    if len(seen) != profile['count']:
        raise ValueError('Embedding count does not match run.json')
    print(json.dumps(profile, separators=(',', ':')), flush=True)
    for file in files:
        for batch in pq.ParquetFile(file).iter_batches(batch_size=64):
            for row in batch.to_pylist():
                print(json.dumps(row, separators=(',', ':')))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--embedding-dir', type=Path, required=True)
    export(parser.parse_args().embedding_dir)
