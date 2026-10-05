"""Export portable Hugging Face-compatible Parquet datasets and verify them."""
import hashlib
import argparse
import json
import tempfile
from pathlib import Path
from collections import Counter
import datasets
from preparation.validate import file_sha256, validate

ROOT = Path(__file__).resolve().parents[4] / 'data' / 'knowledge'
EXTERNAL_MEDIA = False

def rows(name):
    with (ROOT/name).open(encoding='utf-8') as file:
        for line in file:
            yield json.loads(line)

def generate_chunks():
    asset_hashes = {}
    for chunk in rows('chunks.jsonl'):
        asset = chunk.get('asset_path')
        image = video = None
        if asset and not EXTERNAL_MEDIA:
            data = (ROOT/asset).read_bytes()
            if chunk['modality'] == 'image':
                image = {'bytes': data, 'path': asset}
            elif chunk['modality'] == 'video':
                video = {'bytes': data, 'path': asset}
        if asset and asset not in asset_hashes:
            asset_hashes[asset] = file_sha256(ROOT / asset)
        yield {
            'chunk_id': chunk['chunk_id'], 'document_id': chunk['document_id'],
            'modality': chunk['modality'], 'representation': chunk['representation'],
            'text': chunk.get('text'), 'image': image, 'video': video, 'asset_path': asset,
            'asset_sha256': asset_hashes.get(asset),
            'document_title': chunk['document_title'], 'collection': chunk['collection'],
            'grade_label': chunk.get('grade_label'), 'material_type': chunk['material_type'],
            'page_number': chunk['source_location'].get('page'),
            'start_seconds': chunk['source_location'].get('start_seconds'),
            'end_seconds': chunk['source_location'].get('end_seconds'),
            'source_location': json.dumps(chunk['source_location'],ensure_ascii=False),
            'heading_path': chunk.get('heading_path',[]), 'warnings': chunk.get('warnings',[]),
            'review_status': chunk['review_status'],
            'default_embedding_candidate': chunk['default_embedding_candidate'],
            'embedding_route': chunk['embedding_route'],
            'embedding_reason': chunk['embedding_reason'],
            'embedding_duplicate_of': chunk.get('embedding_duplicate_of'),
            'visual_evidence': json.dumps(chunk.get('visual_evidence'), ensure_ascii=False),
            'is_hidden_slide': chunk.get('is_hidden_slide',False),
            'associated_text_chunk_ids': chunk.get('associated_text_chunk_ids',[]),
            'previous_text_chunk_id': chunk.get('previous_text_chunk_id'),
            'next_text_chunk_id': chunk.get('next_text_chunk_id'),
            'sampled_frame_paths': chunk.get('sampled_frame_paths',[]),
        }

def generate_docs():
    for doc in rows('documents.jsonl'):
        yield {
            'document_id':doc['document_id'],'title':doc['title'],'sha256':doc['sha256'],
            'source_paths':doc['source_paths'],'original_path':doc['original_path'],
            'extension':doc['extension'],'collection':doc['collection'],
            'grade_label':doc.get('grade_label'),'material_type':doc['material_type'],
            'page_count':doc.get('page_count'),'warnings':doc['warnings'],
            'metadata':json.dumps(doc,ensure_ascii=False),
        }

def main(cache_dir):
    V = datasets.Value
    string_fields = ['chunk_id','document_id','modality','representation','text','asset_path',
                     'document_title','collection','grade_label','material_type','source_location',
                     'review_status','previous_text_chunk_id','next_text_chunk_id',
                     'embedding_route','embedding_reason','visual_evidence','embedding_duplicate_of','asset_sha256']
    features = datasets.Features({name:V('string') for name in string_fields})
    features.update({'image':datasets.Image(decode=False),'video':datasets.Video(decode=False),
                     'page_number':V('int32'),'start_seconds':V('float64'),'end_seconds':V('float64'),
                     'default_embedding_candidate':V('bool'),'is_hidden_slide':V('bool')})
    for name in ['heading_path','warnings','associated_text_chunk_ids','sampled_frame_paths']:
        features[name] = datasets.List(V('string'))
    data = ROOT/'data'
    data.mkdir(exist_ok=True)
    chunks = datasets.Dataset.from_generator(generate_chunks,features=datasets.Features(features),cache_dir=cache_dir)
    chunks.to_parquet(data/'chunks.parquet')
    df = datasets.Features({name:V('string') for name in ['document_id','title','sha256','original_path','extension','collection','grade_label','material_type','metadata']})
    df.update({'source_paths':datasets.List(V('string')),'warnings':datasets.List(V('string')),'page_count':V('int32')})
    docs = datasets.Dataset.from_generator(generate_docs,features=datasets.Features(df),cache_dir=cache_dir)
    docs.to_parquet(data/'documents.parquet')
    # Read the actual exported files using the public loader. Check binary payloads
    # against source assets without requiring image/video decoding dependencies.
    restored = datasets.load_dataset('parquet',data_files=str(data/'chunks.parquet'),split='train',streaming=True)
    restored = restored.cast_column('image',datasets.Image(decode=False)).cast_column('video',datasets.Video(decode=False))
    docids = set(docs['document_id'])
    seen, modality_counts = set(), Counter()
    for r in restored:
        assert r['chunk_id'] not in seen
        seen.add(r['chunk_id'])
        assert r['document_id'] in docids
        modality_counts[r['modality']] += 1
        if r['asset_path']:
            field = 'image' if r['modality']=='image' else 'video'
            payload = (ROOT/r['asset_path']).read_bytes() if EXTERNAL_MEDIA else r[field]['bytes']
            assert payload and hashlib.sha256(payload).digest() == hashlib.sha256((ROOT/r['asset_path']).read_bytes()).digest()
        if r['modality']=='text':
            assert r['text'] and r['text'].strip()
        for linked in r['sampled_frame_paths']:
            assert (ROOT/linked).is_file()
    assert len(seen)==len(chunks)
    checks = {'parquet_roundtrip_verified':True,'chunks':len(chunks),'documents':len(docs),
              'modalities':dict(modality_counts),'binary_payloads_verified':True,
              'unique_chunk_ids_verified':True,'document_links_verified':True}
    (ROOT/'parquet-validation.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
    manifest = json.loads((ROOT/'manifest.json').read_text())
    manifest.update({'data_version':'0.3.0','format':'parquet',
                     'documents':'data/documents.parquet','chunks':'data/chunks.parquet',
                     'media_storage':'external_relative_paths' if EXTERNAL_MEDIA else 'embedded_bytes',
                     'parquet_sha256':{p.name:file_sha256(p) for p in data.glob('*.parquet')}})
    (ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(checks,ensure_ascii=False,indent=2))

if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=ROOT)
    parser.add_argument('--external-media', action='store_true', help='Store media once as files with relative paths and checksums')
    args = parser.parse_args()
    ROOT = args.data_dir.expanduser().resolve()
    EXTERNAL_MEDIA = args.external_media
    with tempfile.TemporaryDirectory(prefix='zhiya-export-') as cache_dir:
        main(cache_dir)
    checks = validate(ROOT)
    (ROOT/'parquet-validation.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
