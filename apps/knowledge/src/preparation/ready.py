"""Finalize text-first inputs using source structure, without paid model calls."""
import argparse
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from preparation import prepare
from preparation.validate import file_sha256

NS = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}


def slide_sources(root, doc):
    result = {}
    with zipfile.ZipFile(root / doc['original_path']) as archive:
        presentation = ET.fromstring(archive.read('ppt/presentation.xml'))
        size = presentation.find('p:sldSz', NS)
        area = int(size.attrib['cx']) * int(size.attrib['cy'])
        for name in archive.namelist():
            match = re.fullmatch(r'ppt/slides/slide(\d+)\.xml', name)
            if not match:
                continue
            slide = ET.fromstring(archive.read(name))
            tree = slide.find('p:cSld/p:spTree', NS)
            if tree is None:
                raise ValueError('Missing slide shape tree: ' + name)
            text = '\n'.join(''.join(t.text or '' for t in p.findall('.//a:t', NS))
                             for p in tree.findall('.//a:p', NS)).strip()
            visual = bool(tree.findall('.//p:cxnSp', NS) or tree.findall('.//a:custGeom', NS))
            # Backgrounds and layout/master logos are outside the slide shape tree.
            for pic in tree.findall('.//p:pic', NS):
                extent = pic.find('p:spPr/a:xfrm/a:ext', NS)
                fraction = int(extent.attrib['cx']) * int(extent.attrib['cy']) / area if extent is not None else 1
                if fraction >= 0.02:
                    visual = True
            # Chart/SmartArt frames require visual relationships. Tables retain text.
            for frame in tree.findall('.//p:graphicFrame', NS):
                data = frame.find('a:graphic/a:graphicData', NS)
                if data is not None and not data.attrib.get('uri', '').endswith('/table'):
                    visual = True
            for geometry in tree.findall('.//a:prstGeom', NS):
                if geometry.attrib.get('prst') not in ('rect', 'roundRect', 'line'):
                    visual = True
            result[int(match[1])] = {'text': text, 'visual': visual}
    return result


def finalize(root):
    prepare.ROOT = root
    overrides = {}
    for path in sorted((root / 'documents').glob('*/document.json')):
        doc = json.loads(path.read_text())
        media_path = path.parent / 'text_and_media_chunks.json'
        media = json.loads(media_path.read_text()) if media_path.exists() else []
        pages_path = path.parent / 'page_chunks.json'
        pages = json.loads(pages_path.read_text()) if pages_path.exists() else []
        if doc['extension'] == '.pptx':
            sources = slide_sources(root, doc)
            for chunk in pages:
                page = chunk['source_location']['page']
                source = sources[page]
                if page in doc.get('hidden_slide_numbers', []):
                    continue
                has_text = any(c['modality'] == 'text' and c['source_location'].get('page') == page for c in media)
                if not has_text and source['text']:
                    recovered = prepare.text_chunks(source['text'], doc, {'kind': 'slide', 'page': page})
                    for number, row in enumerate(recovered, 1):
                        row['chunk_id'] = doc['document_id'] + f'-source-text-{page:04d}-{number:04d}'
                        row['warnings'].append('recovered_from_source_slide_xml')
                    media.extend(recovered)
                overrides[chunk['chunk_id']] = 'visual' if source['visual'] else 'none'
                if not source['text'] and not has_text and source['visual']:
                    overrides[chunk['chunk_id']] = 'visual'
            prepare.dump(media_path, media)
        elif doc['extension'] in ('.docx', '.pdf'):
            from preparation.routing import page_layouts
            layouts = page_layouts(root, doc)
            for chunk in pages:
                page = chunk['source_location']['page']
                layout = layouts.get(page)
                if layout is None:
                    raise ValueError('Cannot resolve page layout: ' + chunk['chunk_id'])
                # DOCX tables/underlines are represented in extracted Markdown.
                # PDFs may require vector graphics to retain table/diagram relations.
                important = layout['image_area_fraction'] >= 0.08 or layout['complex_paths'] > 0
                if doc['extension'] == '.pdf' and layout['drawing_paths'] >= 12:
                    important = True
                covered = any(c['modality'] == 'text' and (doc['extension'] == '.docx' or
                              c['source_location'].get('page') == page) for c in media)
                overrides[chunk['chunk_id']] = 'visual' if important or not covered and not layout['empty'] else 'none'
        for chunk in media:
            if chunk['modality'] == 'video':
                overrides[chunk['chunk_id']] = 'visual'
    prepare.consolidate(overrides)
    # Identical inputs yield the same embedding; keep aliases and original source
    # identifiers so all copies can reuse the representative's output vector.
    rows = list(map(json.loads, (root / 'chunks.jsonl').read_text().splitlines()))
    representatives = {}
    hashes = {}
    for row in rows:
        if row['embedding_reason'] == 'manual_selection':
            row['embedding_reason'] = 'source_structure_selection'
        if not row['default_embedding_candidate']:
            continue
        if row['modality'] == 'text':
            fingerprint = prepare.digest(row['text'].encode())
        else:
            asset = row['asset_path']
            if asset not in hashes:
                hashes[asset] = file_sha256(root / asset)
            fingerprint = hashes[asset]
        key = row['modality'], fingerprint
        if key in representatives:
            row['embedding_duplicate_of'] = representatives[key]
            row['embedding_route'] = 'none'
            row['embedding_reason'] = 'identical_embedding_input'
            row['default_embedding_candidate'] = False
        else:
            representatives[key] = row['chunk_id']
    with (root / 'chunks.jsonl').open('w', encoding='utf-8') as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False) + '\n')
    report = json.loads((root / 'report.json').read_text())
    if report['visual_review_chunk_ids']:
        raise ValueError('Unresolved embedding selection remains')
    report['selection_finalized'] = True
    from collections import Counter
    report['default_embedding_candidates'] = sum(r['default_embedding_candidate'] for r in rows)
    report['embedding_candidates_by_route'] = dict(Counter(r['embedding_route'] for r in rows if r['default_embedding_candidate']))
    report['embedding_selection_reasons'] = dict(Counter(r['embedding_reason'] for r in rows))
    report['embedding_input_aliases'] = sum('embedding_duplicate_of' in r for r in rows)
    report['selected_text_characters'] = sum(len(r['text']) for r in rows if r['embedding_route'] == 'text')
    report['selection_method'] = 'source_slide_structure_and_pdf_objects'
    prepare.dump(root / 'report.json', report)
    manifest = json.loads((root / 'manifest.json').read_text())
    manifest['embedding_selection_finalized'] = True
    manifest['embedding_alias_field'] = 'embedding_duplicate_of'
    manifest['selection_method'] = report['selection_method']
    prepare.dump(root / 'manifest.json', manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=prepare.ROOT)
    args = parser.parse_args()
    finalize(args.data_dir.expanduser().resolve())


if __name__ == '__main__':
    main()
