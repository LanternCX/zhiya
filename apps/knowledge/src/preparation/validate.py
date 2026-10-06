"""Validate corpus provenance, references and portable Parquet payloads."""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import pyarrow.parquet as pq


DEFAULT_DATA_DIR = Path(__file__).resolve().parents[4] / 'data' / 'knowledge'


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
    hidden_pages = {}
    require(len(docmap) == len(docs), 'Duplicate document IDs')
    for doc in docs:
        require(file_sha256(asset(root, doc['original_path'])) == doc['sha256'],
                f'Original checksum mismatch: {doc["document_id"]}')
        processing = root / 'documents' / doc['document_id'] / 'document.json'
        if Path(doc['original_path']).suffix.lower() == '.pptx':
            require(processing.is_file(), f'Missing PPT preparation record: {doc["document_id"]}')
        if processing.is_file():
            metadata = json.loads(processing.read_text())
            hidden_pages[doc['document_id']] = set(metadata.get('hidden_slide_numbers', []))
            require(metadata.get('processing_status') != 'error', f'Processing failed: {doc["document_id"]}')
            require('office_page_render_pending' not in metadata.get('warnings', []),
                    f'Office render pending: {doc["document_id"]}')
            if metadata.get('extension') == '.pptx':
                require(metadata.get('slide_count') == metadata.get('page_count')
                        and metadata.get('page_count') is not None,
                        f'PPT page count mismatch: {doc["document_id"]}')
    chunks = {}
    fingerprints = {}
    modalities = Counter()
    for row in parquet_rows(root / 'data/chunks.parquet'):
        ident = row['chunk_id']
        require(ident not in chunks, f'Duplicate chunk ID: {ident}')
        require(row['document_id'] in docmap, f'Unknown document: {ident}')
        modality = row['modality']
        require(modality in ('text', 'image', 'video'), f'Unknown modality: {ident}')
        require(isinstance(row['default_embedding_candidate'], bool), f'Invalid embedding selection: {ident}')
        location = json.loads(row['source_location'])
        require(not row['default_embedding_candidate']
                or location.get('page') not in hidden_pages.get(row['document_id'], set()),
                f'Hidden slide selected: {ident}')
        modalities[modality] += 1
        if modality == 'text':
            require(row['text'] and row['text'].strip(), f'Empty text: {ident}')
            fingerprints[ident] = hashlib.sha256(row['text'].encode()).hexdigest()
        else:
            source_hash = file_sha256(asset(root, row['asset_path']))
            require(row.get('asset_sha256') == source_hash, f'Asset checksum mismatch: {ident}')
            fingerprints[ident] = source_hash
        chunks[ident] = {key: value for key, value in row.items() if key != 'text'}
        chunks[ident]['source_location'] = location
    for ident, row in chunks.items():
        representative = row['embedding_duplicate_of']
        if representative:
            target = chunks.get(representative)
            require(target and target['default_embedding_candidate'] and not row['default_embedding_candidate']
                    and target['modality'] == row['modality'] and fingerprints[representative] == fingerprints[ident],
                    f'Invalid embedding alias: {ident} -> {representative}')
        for linked in row['associated_text_chunk_ids']:
            target = chunks.get(linked)
            require(target and target['modality'] == 'text' and target['document_id'] == row['document_id'],
                    f'Invalid text reference: {ident} -> {linked}')
            require(target['source_location'].get('page') == row['source_location'].get('page'),
                    f'Text page mismatch: {ident}')
    return {
        'parquet_roundtrip_verified': True, 'chunks': len(chunks), 'documents': len(docs),
        'modalities': dict(modalities), 'assets_sha256_verified': True,
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
