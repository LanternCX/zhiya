"""Import an offline handoff archive into the existing text-first corpus."""
import argparse
import base64
import io
import json
import posixpath
import re
from urllib.parse import unquote, urlsplit
from pathlib import Path, PurePosixPath
import zipfile

from preparation import prepare


def joined(value):
    return ''.join(value) if isinstance(value, list) else str(value or '')


def bound_text_chunks(chunks):
    result = []
    for row in chunks:
        text = row.get('text', '')
        if len(text) <= 2400:
            result.append(row)
            continue
        for start in range(0, len(text), 2400):
            piece = dict(row, text=text[start:start + 2400],
                         chunk_id=row['chunk_id'] + f'-part-{start // 2400 + 1:04d}')
            if piece['text'].strip():
                piece['content_sha256'] = prepare.digest(piece['text'].encode())
                result.append(piece)
    return result


def text_segments(extension, raw):
    text = raw.decode('utf-8-sig')
    if extension == '.ipynb':
        notebook = json.loads(text)
        cells = notebook.get('cells')
        if cells is None:
            cells = [c for w in notebook.get('worksheets', []) for c in w.get('cells', [])]
        for number, cell in enumerate(cells, 1):
            source = joined(cell.get('source', cell.get('input', '')))
            parts = [source]
            if cell.get('cell_type') == 'code':
                parts = ['```python\n' + source + '\n```']
                for output in cell.get('outputs', []):
                    data = output.get('data', {})
                    value = output.get('text') or data.get('text/plain') or output.get('traceback')
                    if value:
                        parts.append(joined(value))
            yield '\n\n'.join(parts), {'kind': 'cell', 'cell': number}
    elif extension == '.jsonl':
        for number, line in enumerate(text.splitlines(), 1):
            if not line.strip():
                continue
            record = json.loads(line)
            content = record.get('content')
            if not isinstance(content, str):
                raise ValueError(f'Missing text content in JSONL record {number}')
            yield content, {'kind': 'record', 'record': number, 'record_id': record.get('id')}
    elif extension == '.html':
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(text, 'html.parser')
        for node in soup(['script', 'style', 'nav', 'header', 'footer']):
            node.decompose()
        yield soup.get_text('\n', strip=True), {'kind': 'document'}
    else:
        yield text, {'kind': 'document'}


def notebook_images(raw):
    notebook = json.loads(raw)
    cells = notebook.get('cells')
    if cells is None:
        cells = [c for w in notebook.get('worksheets', []) for c in w.get('cells', [])]
    for number, cell in enumerate(cells, 1):
        for output in cell.get('outputs', []):
            data = output.get('data', output)
            for mime in ('image/png', 'image/jpeg', 'png', 'jpeg'):
                if mime in data:
                    yield base64.b64decode(joined(data[mime])), number
                    break
        for data in cell.get('attachments', {}).values():
            for mime in ('image/png', 'image/jpeg'):
                if mime in data:
                    yield base64.b64decode(joined(data[mime])), number
                    break


def import_linked_images(archive_path, root):
    report = {'added': 0, 'unresolved': []}
    with zipfile.ZipFile(archive_path) as archive:
        names = set(archive.namelist())
        by_name = {}
        for name in names:
            by_name.setdefault(PurePosixPath(name).name, []).append(name)
        for path in (root / 'documents').glob('*/document.json'):
            doc = json.loads(path.read_text())
            if doc['extension'] not in ('.md', '.html', '.ipynb') or not doc.get('handoff_sources'):
                continue
            raw = (root / doc['original_path']).read_text(encoding='utf-8-sig')
            if doc['extension'] == '.ipynb':
                raw = '\n'.join(text for text, _ in text_segments('.ipynb', raw.encode()))
            from bs4 import BeautifulSoup
            references = re.findall(r'!\[[^\]]*\]\(\s*<?([^\s)>]+)', raw)
            references += [tag.get('src') for tag in BeautifulSoup(raw, 'html.parser').find_all('img') if tag.get('src')]
            chunks_path = path.parent / 'text_and_media_chunks.json'
            chunks = json.loads(chunks_path.read_text())
            for reference in sorted(set(references)):
                url = urlsplit(reference)
                if reference.startswith('attachment:'):
                    continue  # Notebook attachments were extracted with their cell.
                candidates = by_name.get(PurePosixPath(unquote(url.path)).name, [])
                candidates = [n for n in candidates if n.startswith('handoff_package/data/' + doc['handoff_sources'][0]['source_id'] + '/')]
                candidate = candidates[0] if len(candidates) == 1 else None
                if len(candidates) > 1:
                    signatures = {(archive.getinfo(n).CRC, archive.getinfo(n).file_size) for n in candidates}
                    if len(signatures) == 1:
                        candidate = candidates[0]
                if (url.scheme or url.netloc) and not candidate:
                    report['unresolved'].append({'document_id': doc['document_id'], 'reference': reference,
                                                 'reason': 'external_or_inline_reference'})
                    continue
                name = posixpath.normpath('handoff_package/data/' + posixpath.dirname(doc['handoff_sources'][0]['path']) + '/' + unquote(url.path))
                if name not in names and candidate:
                    name = candidate
                if not name.startswith('handoff_package/data/') or name not in names:
                    report['unresolved'].append({'document_id': doc['document_id'], 'reference': reference,
                                                 'reason': 'local_image_missing'})
                    continue
                try:
                    before = len(chunks)
                    add_image(root, path.parent, doc, chunks, archive.read(name),
                              {'kind': 'image', 'reference': reference, 'source_path': name.removeprefix('handoff_package/data/')})
                    report['added'] += len(chunks) - before
                except Exception as error:
                    report['unresolved'].append({'document_id': doc['document_id'], 'reference': reference,
                                                 'reason': type(error).__name__, 'error': str(error)})
            prepare.dump(chunks_path, chunks)
    from collections import Counter, defaultdict
    unresolved = defaultdict(list)
    for item in report['unresolved']:
        unresolved[item['document_id']].append(item)
    for path in (root / 'documents').glob('*/document.json'):
        doc = json.loads(path.read_text())
        if doc['extension'] in ('.md', '.html', '.ipynb') and doc.get('handoff_sources'):
            doc['unresolved_image_references'] = unresolved.get(doc['document_id'], [])
            prepare.dump(path, doc)
    report['unresolved_by_reason'] = dict(Counter(item['reason'] for item in report['unresolved']))
    prepare.dump(root / 'linked-image-report.json', report)
    print('Linked images:', report['added'], 'unresolved:', len(report['unresolved']), flush=True)


def import_archive(archive_path, root):
    prepare.ROOT = root
    root.mkdir(parents=True, exist_ok=True)
    documents = {}
    for path in (root / 'documents').glob('*/document.json'):
        doc = json.loads(path.read_text())
        documents[doc['sha256']] = doc
    report = {'reused': 0, 'added': 0, 'missing': [], 'errors': [], 'excluded': []}
    with zipfile.ZipFile(archive_path) as archive:
        for name in archive.namelist():
            for prefix in ('handoff_package/metadata/', 'handoff_package/links/'):
                if not name.startswith(prefix) or name.endswith('/'):
                    continue
                relative = PurePosixPath(name.removeprefix('handoff_package/'))
                if '..' in relative.parts:
                    raise ValueError('Unsafe handoff metadata path')
                target = root / 'source_metadata' / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
        entries = json.loads(archive.read('handoff_package/metadata/rag_documents_manifest.json'))['documents']
        names = set(archive.namelist())
        for entry in entries:
            relative = PurePosixPath(entry['path'])
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Unsafe source path')
            if any(part.startswith('.') for part in relative.parts):
                report['excluded'].append({'path': entry['path'], 'reason': 'cache_or_hidden_path'})
                continue
            name = 'handoff_package/data/' + entry['path']
            if name not in names:
                report['missing'].append(entry['path'])
                continue
            raw = archive.read(name)
            sha = prepare.digest(raw)
            if sha in documents:
                doc = documents[sha]
                refs = doc.setdefault('handoff_sources', [])
                if entry not in refs:
                    refs.append(entry)
                prepare.dump(root / 'documents' / doc['document_id'] / 'document.json', doc)
                report['reused'] += 1
                continue
            ident = sha[:24]
            extension = relative.suffix.lower()
            base = root / 'documents' / ident
            base.mkdir(parents=True, exist_ok=True)
            original = base / ('original' + extension)
            original.write_bytes(raw)
            doc = {'document_id': ident, 'sha256': sha, 'source_paths': [entry['path']],
                   'title': relative.stem, 'extension': extension, 'bytes': len(raw),
                   'collection': entry['source_id'], 'grade_label': entry.get('grade_range'),
                   'material_type': prepare.classify(relative.name),
                   'original_path': prepare.rel(original), 'handoff_sources': [entry],
                   'warnings': [], 'processing_status': 'prepared'}
            chunks = []
            try:
                if extension in ('.pdf', '.docx', '.pptx'):
                    # Reuse native document extractors with an isolated source directory.
                    prepare.SOURCE = base
                    source_paths = doc['source_paths']
                    doc['source_paths'] = [original.name]
                    prepare.prepare_one(doc)
                    doc['source_paths'] = source_paths
                    if extension == '.docx' and doc['processing_status'] == 'prepared':
                        # Native paragraphs/tables plus embedded images avoid rendering prose.
                        chunks = json.loads((base / 'text_and_media_chunks.json').read_text())
                        for item in doc.get('embedded_assets', []):
                            add_image(root, base, doc, chunks, (root / item['path']).read_bytes(),
                                      {'kind': 'image', 'package_path': item['package_path']})
                        doc['warnings'] = [w for w in doc['warnings'] if w != 'office_page_render_pending']
                        doc['warnings'].append('native_text_and_embedded_images; layout_not_rendered')
                        prepare.dump(base / 'text_and_media_chunks.json', chunks)
                else:
                    for number, (text, locator) in enumerate(text_segments(extension, raw), 1):
                        rows = prepare.text_chunks(text, doc, locator)
                        for index, row in enumerate(rows, 1):
                            row['chunk_id'] = f'{ident}-segment-{number:06d}-text-{index:04d}'
                        chunks.extend(rows)
                    if extension == '.ipynb':
                        for image, cell in notebook_images(raw):
                            add_image(root, base, doc, chunks, image, {'kind': 'image', 'cell': cell})
                    prepare.dump(base / 'text_and_media_chunks.json', chunks)
                if doc['processing_status'] == 'error':
                    raise ValueError('; '.join(doc['warnings']))
            except Exception as error:
                doc['processing_status'] = 'error'
                doc['warnings'].append(str(error))
                report['errors'].append({'path': entry['path'], 'error': str(error)})
            documents[sha] = doc
            prepare.dump(base / 'document.json', doc)
            report['added'] += 1
            if report['added'] % 100 == 0:
                print('Imported', report['added'], flush=True)
    prepare.dump(root / 'handoff-import-report.json', report)
    for doc in documents.values():
        if not doc.get('handoff_sources') or doc['collection'] not in (
                'microsoft_ai_for_beginners', 'ai4k12', 'k12_textbook', 'datawhale_ai_edu'):
            continue
        path = root / 'documents' / doc['document_id'] / 'text_and_media_chunks.json'
        if path.exists():
            prepare.dump(path, bound_text_chunks(json.loads(path.read_text())))
    prepare.dump(root / 'source_inventory.json', list(documents.values()))
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return report


def add_image(root, base, doc, chunks, raw, locator):
    from PIL import Image
    digest = prepare.digest(raw)
    ident = doc['document_id'] + '-embedded-' + digest[:24]
    if b'<svg' in raw[:1000]:
        import cairosvg
        raw = cairosvg.svg2png(bytestring=raw)
    with Image.open(io.BytesIO(raw)) as image:
        extension = {'JPEG': '.jpg', 'PNG': '.png', 'GIF': '.gif', 'WEBP': '.webp'}.get(image.format)
        if extension is None:
            buffer = io.BytesIO()
            image.convert('RGB').save(buffer, format='PNG')
            raw = buffer.getvalue()
            extension = '.png'
    asset = root / 'assets' / (prepare.digest(raw) + extension)
    asset.parent.mkdir(exist_ok=True)
    if not asset.exists():
        asset.write_bytes(raw)
    for chunk in chunks:
        if chunk['chunk_id'] == ident:
            chunk['asset_path'] = asset.relative_to(root).as_posix()
            return
    chunks.append({'chunk_id': ident, 'document_id': doc['document_id'], 'modality': 'image',
                   'representation': 'visual', 'asset_path': asset.relative_to(root).as_posix(),
                   'source_location': locator,
                   'warnings': []})


def compact_images(archive_path, root):
    import_linked_images(archive_path, root)
    for path in (root / 'documents').glob('*/document.json'):
        doc = json.loads(path.read_text())
        if doc['extension'] != '.ipynb':
            continue
        chunks_path = path.parent / 'text_and_media_chunks.json'
        chunks = json.loads(chunks_path.read_text())
        for image, cell in notebook_images((root / doc['original_path']).read_bytes()):
            add_image(root, path.parent, doc, chunks, image, {'kind': 'image', 'cell': cell})
        prepare.dump(chunks_path, chunks)
    live = set()
    for path in (root / 'documents').glob('*/text_and_media_chunks.json'):
        live.update(c['asset_path'] for c in json.loads(path.read_text()) if c.get('asset_path'))
        doc = json.loads((path.parent / 'document.json').read_text())
        live.update(a['path'] for a in doc.get('embedded_assets', []))
    removed = 0
    for path in (root / 'documents').glob('*/embedded/*.png'):
        if len(path.stem) == 64 and path.relative_to(root).as_posix() not in live:
            removed += path.stat().st_size
            path.unlink()
    print('Removed duplicate converted image bytes:', removed, flush=True)


def preserve_sources(archive_path, root):
    """Keep unselected source files while sharing existing originals by hard link."""
    import hashlib
    import os
    originals = {}
    for path in (root / 'documents').glob('*/document.json'):
        doc = json.loads(path.read_text())
        originals[doc['sha256']] = root / doc['original_path']
    count = linked = 0
    with zipfile.ZipFile(archive_path) as archive:
        for item in archive.infolist():
            prefix = 'handoff_package/data/'
            if item.is_dir() or not item.filename.startswith(prefix):
                continue
            relative = PurePosixPath(item.filename.removeprefix(prefix))
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Unsafe source archive path')
            target = root / 'sources' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                continue
            temporary = target.with_name(target.name + '.importing')
            sha = hashlib.sha256()
            with archive.open(item) as source, temporary.open('wb') as output:
                for block in iter(lambda: source.read(1024 * 1024), b''):
                    sha.update(block)
                    output.write(block)
            digest = sha.hexdigest()
            if digest in originals:
                temporary.unlink()
                os.link(originals[digest], target)
                linked += 1
            else:
                temporary.replace(target)
                originals[digest] = target
            count += 1
            if count % 1000 == 0:
                print('Preserved source files:', count, flush=True)
    print('Preserved files:', count, 'reused file storage:', linked, flush=True)


def prune_unused_extractions(root):
    """Remove redundant Office media copies while keeping their original packages."""
    live = {c['asset_path'] for c in map(json.loads, (root / 'chunks.jsonl').read_text().splitlines())
            if c.get('asset_path')}
    removed = 0
    for path in (root / 'documents').glob('*/document.json'):
        doc = json.loads(path.read_text())
        kept = []
        for asset in doc.get('embedded_assets', []):
            if asset['path'] in live:
                kept.append(asset)
                continue
            original = root / doc['original_path']
            with zipfile.ZipFile(original) as archive:
                if prepare.digest(archive.read(asset['package_path'])) != asset['sha256']:
                    raise ValueError('Original package media mismatch')
            target = root / asset['path']
            if target.is_file():
                removed += target.stat().st_size
                target.unlink()
            reference = {k: v for k, v in asset.items() if k != 'path'}
            refs = doc.setdefault('original_package_assets', [])
            if reference not in refs:
                refs.append(reference)
        if 'embedded_assets' in doc:
            doc['embedded_assets'] = kept
            prepare.dump(path, doc)
    print('Removed unused extraction bytes:', removed, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--data-dir', required=True, type=Path)
    args = parser.parse_args()
    report = import_archive(args.archive, args.data_dir.resolve())
    if report['errors'] or report['missing']:
        raise SystemExit(1)
    import_linked_images(args.archive, args.data_dir.resolve())
