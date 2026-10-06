"""Export the retrieval dataset with file-based media and existing stable IDs."""
import argparse
import json
import tempfile
from pathlib import Path

import datasets

from preparation.validate import file_sha256, parquet_rows, validate

ROOT = Path(__file__).resolve().parents[4] / 'data' / 'knowledge'


def rows(name):
    with (ROOT / name).open(encoding='utf-8') as source:
        for line in source:
            yield json.loads(line)


def generate_chunks():
    asset_hashes = {}
    for chunk in rows('chunks.jsonl'):
        asset = chunk.get('asset_path')
        if asset and asset not in asset_hashes:
            asset_hashes[asset] = file_sha256(ROOT / asset)
        yield {
            'chunk_id': chunk['chunk_id'], 'document_id': chunk['document_id'],
            'modality': chunk['modality'], 'text': chunk.get('text'),
            'asset_path': asset, 'asset_sha256': asset_hashes.get(asset),
            'source_location': json.dumps(chunk['source_location'], ensure_ascii=False),
            'warnings': chunk.get('warnings', []),
            'associated_text_chunk_ids': chunk.get('associated_text_chunk_ids', []),
            'default_embedding_candidate': chunk['default_embedding_candidate'],
            'embedding_duplicate_of': chunk.get('embedding_duplicate_of'),
        }


def generate_docs():
    for doc in rows('documents.jsonl'):
        if doc.get('processing_status') == 'error' or 'office_page_render_pending' in doc.get('warnings', []):
            raise ValueError('Document preparation is incomplete: ' + doc['document_id'])
        yield {
            'document_id': doc['document_id'], 'title': doc['title'],
            'sha256': doc['sha256'], 'original_path': doc['original_path'],
            'source_paths': doc['source_paths'],
            'handoff_sources': json.dumps(doc.get('handoff_sources', []), ensure_ascii=False),
        }


def write_jsonl(path, records, encoded_fields):
    temporary = path.with_suffix('.jsonl.tmp')
    with temporary.open('w', encoding='utf-8') as output:
        for row in records:
            for field in encoded_fields:
                row[field] = json.loads(row[field])
            output.write(json.dumps(row, ensure_ascii=False) + '\n')
    temporary.replace(path)


def main(cache_dir):
    value = datasets.Value
    features = datasets.Features({name: value('string') for name in (
        'chunk_id', 'document_id', 'modality', 'text', 'asset_path',
        'asset_sha256', 'source_location', 'embedding_duplicate_of',
    )})
    features['default_embedding_candidate'] = value('bool')
    for name in ('warnings', 'associated_text_chunk_ids'):
        features[name] = datasets.List(value('string'))
    data = ROOT / 'data'
    data.mkdir(exist_ok=True)
    chunks = datasets.Dataset.from_generator(generate_chunks, features=features, cache_dir=cache_dir)
    chunks.to_parquet(data / 'chunks.parquet')
    document_features = datasets.Features({name: value('string') for name in (
        'document_id', 'title', 'sha256', 'original_path', 'handoff_sources',
    )})
    document_features['source_paths'] = datasets.List(value('string'))
    docs = datasets.Dataset.from_generator(generate_docs, features=document_features, cache_dir=cache_dir)
    docs.to_parquet(data / 'documents.parquet')
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    manifest.update({
        'schema_version': 3, 'data_version': '0.4.0', 'format': 'parquet',
        'documents': 'data/documents.parquet', 'chunks': 'data/chunks.parquet',
        'media_storage': 'external_relative_paths',
        'parquet_sha256': {path.name: file_sha256(path) for path in data.glob('*.parquet')},
    })
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    checks = validate(ROOT)
    # The online importer reads JSONL; publish exactly the same retrieval fields.
    # Preparation details stay in the per-document preparation files and reports.
    write_jsonl(ROOT / 'chunks.jsonl', parquet_rows(data / 'chunks.parquet'), ('source_location',))
    write_jsonl(ROOT / 'documents.jsonl', parquet_rows(data / 'documents.parquet'), ('handoff_sources',))
    (ROOT / 'parquet-validation.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(checks, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=ROOT)
    args = parser.parse_args()
    ROOT = args.data_dir.expanduser().resolve()
    with tempfile.TemporaryDirectory(prefix='zhiya-export-') as cache_dir:
        main(cache_dir)
