"""Validate corpus provenance, references and portable Parquet payloads."""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import pyarrow.parquet as pq


DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / 'data' / 'knowledge'


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def asset(root, relative):
    path = (root / relative).resolve()
    require(path.is_relative_to(root), f'Asset escapes data directory: {relative}')
    require(path.is_file(), f'Missing asset: {relative}')
    return path


def parquet_rows(path):
    for batch in pq.ParquetFile(path).iter_batches(batch_size=32):
        yield from batch.to_pylist()


def validate(root):
    root = root.resolve()
    manifest = json.loads((root / 'manifest.json').read_text())
    require(manifest.get('parquet_sha256'), 'Missing Parquet checksums')
    for name in ('chunks.parquet', 'documents.parquet'):
        require(file_sha256(asset(root, 'data/' + name)) == manifest['parquet_sha256'].get(name),
                f'Parquet checksum mismatch: {name}')
    docs = list(parquet_rows(root / 'data/documents.parquet'))
    docmap = {doc['document_id']: doc for doc in docs}
    require(len(docmap) == len(docs), 'Duplicate document IDs')
    for doc in docs:
        require(file_sha256(asset(root, doc['original_path'])) == doc['sha256'],
                f'Original checksum mismatch: {doc["document_id"]}')
        metadata = json.loads(doc['metadata'])
        require(metadata.get('processing_status') != 'error', f'Processing failed: {doc["document_id"]}')
        require('office_page_render_pending' not in doc['warnings'], f'Office render pending: {doc["document_id"]}')
        if doc['extension'] == '.pptx':
            require(metadata.get('slide_count') == doc['page_count'] and doc['page_count'] is not None,
                    f'PPT page count mismatch: {doc["document_id"]}')
    chunks = {}
    modalities = Counter()
    for row in parquet_rows(root / 'data/chunks.parquet'):
        ident = row['chunk_id']
        require(ident not in chunks, f'Duplicate chunk ID: {ident}')
        require(row['document_id'] in docmap, f'Unknown document: {ident}')
        modality = row['modality']
        require(modality in ('text', 'image', 'video'), f'Unknown modality: {ident}')
        modalities[modality] += 1
        if modality == 'text':
            require(row['text'] and row['text'].strip(), f'Empty text: {ident}')
        else:
            payload = row[modality]
            require(payload and payload.get('bytes'), f'Missing media payload: {ident}')
            require(hashlib.sha256(payload['bytes']).hexdigest() == file_sha256(asset(root, row['asset_path'])),
                    f'Asset checksum mismatch: {ident}')
        for frame in row['sampled_frame_paths']:
            asset(root, frame)
        chunks[ident] = {key: value for key, value in row.items() if key not in ('image', 'video', 'text')}
    for ident, row in chunks.items():
        links = row['associated_text_chunk_ids'] + [row[key] for key in (
            'previous_text_chunk_id', 'next_text_chunk_id') if row[key]]
        for linked in links:
            target = chunks.get(linked)
            require(target and target['modality'] == 'text' and target['document_id'] == row['document_id'],
                    f'Invalid text reference: {ident} -> {linked}')
        for linked in row['associated_text_chunk_ids']:
            require(chunks[linked]['page_number'] == row['page_number'], f'PPT text page mismatch: {ident}')
    return {
        'parquet_roundtrip_verified': True, 'chunks': len(chunks), 'documents': len(docs),
        'modalities': dict(modalities), 'binary_payloads_verified': True,
        'unique_chunk_ids_verified': True, 'document_links_verified': True,
        'original_copies_sha256_verified': True, 'ppt_page_counts_verified': True,
        'ppt_text_page_links_verified': True,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=DEFAULT_DATA_DIR)
    args = parser.parse_args()
    try:
        print(json.dumps(validate(args.data_dir.expanduser()), ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f'Validation failed: {error}\n')
