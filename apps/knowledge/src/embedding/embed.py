"""Run reproducible, resumable Qwen embedding jobs on a local GPU."""
import argparse
from collections import Counter
import hashlib
import importlib.metadata
import io
import json
import math
from pathlib import Path
import tempfile
import tomllib

import pyarrow as pa
import pyarrow.parquet as pq
from PIL import Image

from preparation.validate import file_sha256


PROJECT = Path(__file__).resolve().parents[2]
REPO = PROJECT.parents[1]
DEFAULT_CONFIG = PROJECT / 'configs' / 'embedding.toml'


def read_config(path, args):
    config = tomllib.loads(path.read_text())
    for key in ('data_dir', 'output_dir'):
        override = getattr(args, key, None)
        if override is not None:
            config[key] = str(override.resolve())
    for key in ('data_dir', 'output_dir', 'model_cache'):
        config[key] = str((REPO / Path(config[key]).expanduser()).resolve())
    if config['view'] not in ('visual', 'text'):
        raise ValueError('view must be visual or text')
    if config['batch_size'] < 1 or config['dimension'] < 64:
        raise ValueError('batch_size must be positive and dimension must be at least 64')
    if config['dtype'] not in ('bfloat16', 'float16', 'float32'):
        raise ValueError('dtype must be bfloat16, float16 or float32')
    if not 1 <= config['max_length'] <= 32768 or config['video_num_frames'] < 2:
        raise ValueError('Invalid token limit or video frame count')
    if len(config['model_revision']) != 40 or any(c not in '0123456789abcdef' for c in config['model_revision']):
        raise ValueError('model_revision must be a fixed Hugging Face commit SHA')
    return config


def selected(row, config):
    return (row['modality'] == 'text' if config['view'] == 'text'
            else bool(row['default_embedding_candidate']))


def inspect_input(config):
    source = Path(config['data_dir']) / 'data/chunks.parquet'
    ids = set()
    counts = Counter()
    for batch in pq.ParquetFile(source).iter_batches(batch_size=256, columns=[
        'chunk_id', 'document_id', 'modality', 'default_embedding_candidate',
    ]):
        for row in batch.to_pylist():
            if row['chunk_id'] in ids:
                raise ValueError(f'Duplicate chunk ID: {row["chunk_id"]}')
            ids.add(row['chunk_id'])
            if selected(row, config):
                counts[row['modality']] += 1
    if not counts:
        raise ValueError('No embedding inputs selected')
    checksum = file_sha256(source)
    manifest = Path(config['data_dir']) / 'manifest.json'
    if manifest.exists():
        expected = json.loads(manifest.read_text()).get('parquet_sha256', {}).get('chunks.parquet')
        if expected and checksum != expected:
            raise ValueError('Input Parquet checksum does not match the dataset manifest')
    return {'selected': sum(counts.values()), 'modalities': dict(counts),
            'chunks_sha256': checksum, 'model_id': config['model_id'],
            'model_revision': config['model_revision'], 'dimension': config['dimension']}


def model_path(config):
    from huggingface_hub import snapshot_download

    return snapshot_download(config['model_id'], revision=config['model_revision'],
                             cache_dir=config['model_cache'])


class QwenEncoder:
    def __init__(self, config):
        import torch
        from sentence_transformers import SentenceTransformer

        if config['device'] == 'cuda' and not torch.cuda.is_available():
            raise ValueError('CUDA GPU unavailable; run this command on the GPU cloud instance')
        if config['device'] == 'cuda' and config['dtype'] == 'bfloat16' and not torch.cuda.is_bf16_supported():
            raise ValueError('This GPU does not support bfloat16; use dtype = "float16"')
        self.config = config
        self.model = SentenceTransformer(
            model_path(config), device=config['device'],
            model_kwargs={'torch_dtype': getattr(torch, config['dtype']), 'attn_implementation': 'sdpa'},
        )
        if config['dimension'] > self.model.get_sentence_embedding_dimension():
            raise ValueError('Requested dimension exceeds the model embedding dimension')

    def __call__(self, inputs):
        from transformers.video_utils import load_video

        prepared = []
        for item in inputs:
            if 'video' in item:
                frames, metadata = load_video(item['video'], backend='pyav', num_frames=self.config['video_num_frames'])
                prepared.append({'video': {'array': frames, 'video_metadata': dict(metadata)}})
            else:
                prepared.append(item)
        processing = {
            'text': {'max_length': self.config['max_length'], 'truncation': False},
            'image': {'size': {'shortest_edge': 4096, 'longest_edge': self.config['image_max_pixels']}},
            'video': {'do_sample_frames': False,
                      'size': {'shortest_edge': 4096, 'longest_edge': self.config['video_max_pixels']}},
        }
        features = self.model.preprocess(prepared, prompt=self.config['instruction'], processing_kwargs=processing)
        if features['attention_mask'].sum(dim=1).max().item() > self.config['max_length']:
            raise ValueError('Input exceeds max_length; adjust the input or preprocessing instead of silently truncating it')
        del features
        return self.model.encode(
            prepared, batch_size=len(prepared), prompt=self.config['instruction'],
            truncate_dim=self.config['dimension'], normalize_embeddings=True,
            convert_to_numpy=True, show_progress_bar=False,
            processing_kwargs=processing,
        )


def atomic_json(path, value):
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)


def run_job(config, encode=None, limit=None):
    """Embed selected rows; encode is the batch inference boundary for testing."""
    import fcntl

    report = inspect_input(config)
    output = Path(config['output_dir'])
    output.mkdir(parents=True, exist_ok=True)
    with (output / '.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another job is using this output directory') from None
        return _run_locked(config, report, encode, limit)


def _run_locked(config, report, encode, limit):
    output = Path(config['output_dir'])
    settings = {key: value for key, value in config.items()
                if key not in ('data_dir', 'output_dir', 'model_cache', 'device', 'batch_size')}
    identity = {'settings': settings, 'chunks_sha256': report['chunks_sha256'], 'limit': limit,
                'script_sha256': file_sha256(Path(__file__)),
                'lock_sha256': file_sha256(PROJECT / 'uv.lock')}
    job_id = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    manifest = output / 'run.json'
    if manifest.exists():
        previous = json.loads(manifest.read_text())
        if previous['job_id'] != job_id:
            raise ValueError('Output belongs to a different model, dataset or configuration; use a new output directory')
    elif list(output.glob('*.parquet')):
        raise ValueError('Existing output has no run.json; use a new output directory')
    state = {'job_id': job_id, **identity, 'selected': min(report['selected'], limit) if limit else report['selected'],
             'completed': 0, 'status': 'running', 'normalized': True,
             'dependencies': {name: importlib.metadata.version(name) for name in ('datasets', 'pyarrow')},
             'execution': {'device': config['device'], 'batch_size': config['batch_size']}}
    done = set()
    for file in sorted(output.glob('*.parquet')):
        table = pq.read_table(file)
        if (table.schema.metadata or {}).get(b'job_id') != job_id.encode():
            raise ValueError(f'Foreign output shard: {file.name}')
        for row in table.to_pylist():
            if row['chunk_id'] in done:
                raise ValueError(f'Duplicate output chunk: {row["chunk_id"]}')
            normalized_vector(row['embedding'], config['dimension'])
            done.add(row['chunk_id'])
    state['completed'] = len(done)
    atomic_json(manifest, state)
    schema = pa.schema([
        ('chunk_id', pa.string()), ('document_id', pa.string()), ('modality', pa.string()),
        ('embedding', pa.list_(pa.float32(), config['dimension'])),
    ], metadata={b'job_id': job_id.encode()})
    pending = []
    encountered = set()

    def flush():
        nonlocal encode
        if not pending:
            return
        if encode is None:
            encode = QwenEncoder(config)
        with tempfile.TemporaryDirectory(prefix='zhiya-media-') as temp:
            inputs = []
            images = []
            try:
                for row in pending:
                    if row['modality'] == 'text':
                        if not row['text'] or not row['text'].strip():
                            raise ValueError(f'Empty text: {row["chunk_id"]}')
                        inputs.append({'text': row['text']})
                    elif row['modality'] == 'image':
                        with Image.open(io.BytesIO(row['image']['bytes'])) as source:
                            image = source.convert('RGB')
                        images.append(image)
                        inputs.append({'image': image})
                    elif row['modality'] == 'video':
                        path = Path(temp) / f'{len(inputs)}.mp4'
                        path.write_bytes(row['video']['bytes'])
                        inputs.append({'video': str(path)})
                    else:
                        raise ValueError(f'Unsupported modality: {row["modality"]}')
                vectors = encode(inputs)
                if len(vectors) != len(pending):
                    raise ValueError('Model returned a different number of vectors than inputs')
                records = [
                    {'chunk_id': row['chunk_id'], 'document_id': row['document_id'],
                     'modality': row['modality'], 'embedding': normalized_vector(vector, config['dimension'])}
                    for row, vector in zip(pending, vectors)
                ]
            finally:
                for image in images:
                    image.close()
        shard_id = hashlib.sha256(json.dumps([row['chunk_id'] for row in records]).encode()).hexdigest()[:24]
        destination = output / f'part-{shard_id}.parquet'
        temporary = destination.with_suffix('.parquet.tmp')
        pq.write_table(pa.Table.from_pylist(records, schema=schema), temporary)
        temporary.replace(destination)
        done.update(row['chunk_id'] for row in records)
        state['completed'] = len(done)
        atomic_json(manifest, state)
        print(f'Embedded {len(done)}/{state["selected"]}', flush=True)
        pending.clear()

    source = Path(config['data_dir']) / 'data/chunks.parquet'
    for batch in pq.ParquetFile(source).iter_batches(batch_size=16):
        for row in batch.to_pylist():
            if not selected(row, config) or (limit and len(encountered) >= limit):
                continue
            encountered.add(row['chunk_id'])
            if row['chunk_id'] not in done:
                pending.append(row)
                if len(pending) >= config['batch_size']:
                    flush()
    flush()
    if done != encountered:
        raise ValueError('Output chunk IDs do not match the selected input')
    state['status'] = 'complete'
    atomic_json(manifest, state)
    return state


def normalized_vector(vector, dimension):
    values = [float(value) for value in vector]
    if len(values) != dimension or not all(math.isfinite(value) for value in values):
        raise ValueError('Invalid vector dimension or nonfinite values')
    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0 or not math.isfinite(norm):
        raise ValueError('Zero or invalid embedding vector norm')
    return [value / norm for value in values]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['check', 'doctor', 'download-model', 'run'])
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--limit', type=int, help='Embed only this many inputs, using a separate output directory')
    args = parser.parse_args()
    try:
        config = read_config(args.config, args)
        if args.limit is not None and args.limit < 1:
            raise ValueError('--limit must be positive')
        if args.command == 'check':
            print(json.dumps(inspect_input(config), ensure_ascii=False, indent=2))
        elif args.command == 'doctor':
            import torch
            from torch.version import cuda as cuda_runtime
            import sentence_transformers
            import av

            if not torch.cuda.is_available():
                raise ValueError('CUDA GPU unavailable; check the NVIDIA driver and cloud GPU allocation')
            properties = torch.cuda.get_device_properties(0)
            if config['dtype'] == 'bfloat16' and not torch.cuda.is_bf16_supported():
                raise ValueError('GPU does not support bfloat16; change dtype to float16')
            print(json.dumps({'gpu': properties.name, 'memory_gib': round(properties.total_memory / 1024**3, 1),
                              'torch': torch.__version__, 'cuda_runtime': cuda_runtime,
                              'sentence_transformers': sentence_transformers.__version__,
                              'av': av.__version__}, indent=2))
        elif args.command == 'download-model':
            print(model_path(config))
        else:
            run_job(config, limit=args.limit)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f'Embedding failed: {error}\n')


if __name__ == '__main__':
    main()
