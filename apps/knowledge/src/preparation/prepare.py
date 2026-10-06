"""Prepare a local, portable knowledge corpus; never modifies source files."""
import argparse
import concurrent.futures
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

from preparation.routing import route_document

ROOT = Path(__file__).resolve().parents[4] / 'data' / 'knowledge'
SOURCE = None

def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')

def digest(data):
    return hashlib.sha256(data).hexdigest()

def rel(path):
    return path.relative_to(ROOT).as_posix()

def run(args, timeout=180):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout)

def classify(name):
    s = name.lower()
    for keys, label in [(['answer key'], 'answer_key'), (['educator', 'mentor guide'], 'educator_guide'),
                         (['rubric'], 'assessment_rubric'), (['slide deck', '.pptx'], 'slides'),
                         (['worksheet', 'handout', 'activity', 'cards'], 'activity')]:
        if any(k in s for k in keys):
            return label
    return 'unclassified'

def text_chunks(text, doc, locator=None):
    """Split Markdown at headings/paragraphs; retain table headers across row groups."""
    text = re.sub(r'!\[[^\]]*\]\([^\n]*\)', '', text)
    text = text.replace('\x0b', '\n').replace('\x00', '')
    lines = text.splitlines()
    sections, headings, buf = [], [], []
    def flush():
        if buf and '\n'.join(buf).strip():
            sections.append((list(headings), '\n'.join(buf).strip()))
        buf.clear()
    for line in lines:
        m = re.match(r'^(#{1,6})\s+(.+)', line)
        if m:
            flush()
            level = len(m[1])
            headings[:] = headings[:level-1] + [m[2].strip()]
        else:
            buf.append(line)
    flush()
    result = []
    for heading, body in sections:
        paragraphs = re.split(r'\n\s*\n', body)
        units = []
        for p in paragraphs:
            if len(p) <= 2400:
                units.append((p, False))
            elif p.lstrip().startswith('|') and len(p.splitlines()) > 2:
                rows = p.splitlines()
                header = '\n'.join(rows[:2])
                current = header
                for row in rows[2:]:
                    if len(current) + len(row) > 2400 and current != header:
                        units.append((current, True))
                        current = header
                    current += '\n' + row
                units.append((current, True))
            else:
                # Prefer sentence boundaries, retaining oversized sentences intact.
                sentences = re.split(r'(?<=[.!?。！？])\s+|\n', p)
                current = ''
                for sentence in sentences:
                    if len(current) + len(sentence) > 2400 and current:
                        units.append((current, True))
                        current = ''
                    current += (' ' if current else '') + sentence
                if current:
                    units.append((current, True))
        current, split = '', False
        def emit():
            if not current.strip():
                return
            result.append({'modality': 'text', 'text': current.strip(), 'heading_path': heading,
                           'source_location': locator or {'kind': 'heading', 'heading_path': heading},
                           'warnings': (['long_section_split_review_context'] if split else [])
                           + (['oversized_text_review'] if len(current) > 4000 else [])})
        for unit, was_split in units:
            if current and len(current) + len(unit) > 2400:
                emit()
                current, split = '', False
            current += ('\n\n' if current else '') + unit
            split = split or was_split
        emit()
    for i, chunk in enumerate(result):
        chunk['chunk_id'] = doc['document_id'] + '-text-' + str((locator or {}).get('page', 0)) + '-' + str(i+1).zfill(4)
        chunk['document_id'] = doc['document_id']
        chunk['representation'] = 'text'
        chunk['content_sha256'] = digest(chunk['text'].encode())
    return result

def prepare_one(doc):
    from markitdown import MarkItDown
    from PIL import Image, ImageOps
    import pypdfium2 as pdfium
    ident = doc['document_id']
    base = ROOT / 'documents' / ident
    base.mkdir(parents=True, exist_ok=True)
    src = SOURCE / doc['source_paths'][0]
    original = base / ('original' + src.suffix.lower())
    if not original.exists():
        shutil.copy2(src, original)
    doc['original_path'] = rel(original)
    chunks, warnings = [], []
    try:
        suffix = src.suffix.lower()
        if suffix in ('.docx', '.pptx'):
            mdpath = base / 'extracted.md'
            if not mdpath.exists():
                text = MarkItDown().convert(str(original)).text_content
                mdpath.write_text(text, encoding='utf-8')
            else:
                text = mdpath.read_text(encoding='utf-8')
            doc['extracted_text_path'] = rel(mdpath)
            if suffix == '.pptx':
                for m in re.finditer(r'<!-- Slide number: (\d+) -->(.*?)(?=<!-- Slide number:|\Z)', text, re.S):
                    chunks.extend(text_chunks(m[2], doc, {'kind': 'slide', 'page': int(m[1])}))
            else:
                chunks.extend(text_chunks(text, doc))
            with zipfile.ZipFile(original) as archive:
                media = []
                for name in archive.namelist():
                    if re.match(r'^(word|ppt)/media/[^/]+$', name):
                        data = archive.read(name)
                        out = base / 'embedded' / Path(name).name
                        out.parent.mkdir(exist_ok=True)
                        out.write_bytes(data)
                        media.append({'path': rel(out), 'package_path': name, 'sha256': digest(data)})
                doc['embedded_assets'] = media
            if media:
                warnings.append('embedded_visual_content_preserved; text_alone_may_be_incomplete')
            warnings.append('office_page_render_pending')
        elif suffix == '.pdf':
            pdf = pdfium.PdfDocument(str(original))
            texts = []
            for n in range(len(pdf)):
                page = pdf[n]
                tp = page.get_textpage()
                text = tp.get_text_range()
                texts.append(f'\n<!-- Page {n+1} -->\n{text}')
                chunks.extend(text_chunks(text, doc, {'kind': 'page', 'page': n+1}))
                tp.close()
                page.close()
            pdf.close()
            mdpath = base / 'extracted.md'
            mdpath.write_text('\n'.join(texts), encoding='utf-8')
            doc['extracted_text_path'] = rel(mdpath)
            doc['render_pdf_path'] = rel(original)
            warnings.append('pdf_text_reading_order_may_differ')
        elif suffix in ('.jpg', '.png', '.jpeg'):
            with Image.open(original) as im:
                im = ImageOps.exif_transpose(im).convert('RGB')
                out = base / 'image.jpg'
                im.save(out, quality=95)
                doc['image_size'] = list(im.size)
            chunks.append({'chunk_id': ident+'-image', 'document_id': ident,
                           'modality': 'image', 'representation': 'visual', 'asset_path': rel(out),
                           'source_location': {'kind': 'image'},
                           'warnings': ['no_ocr_or_generated_caption']})
        elif suffix == '.mp4':
            probe = json.loads(run(['ffprobe','-v','quiet','-show_format','-show_streams','-of','json',str(original)]).stdout)
            duration = float(probe['format']['duration'])
            doc['duration_seconds'] = duration
            doc['has_audio'] = any(s['codec_type']=='audio' for s in probe['streams'])
            frames = base / 'frames'
            frames.mkdir(exist_ok=True)
            # These source videos are short; preserve the complete clip as a block.
            run(['ffmpeg','-v','error','-y','-i',str(original),'-vf','fps=1,scale=1024:-2','-q:v','3',str(frames/'%04d.jpg')])
            frame_paths = [rel(f) for f in sorted(frames.glob('*.jpg'))]
            chunks.append({'chunk_id': ident+'-video', 'document_id': ident,
                           'modality': 'video', 'representation': 'visual', 'asset_path': rel(original),
                           'source_location': {'kind': 'time_range', 'start_seconds': 0, 'end_seconds': duration},
                           'sampled_frame_paths': frame_paths, 'sample_fps': 1,
                           'warnings': ['audio_not_transcribed', 'frames_are_visual_preview_not_full_video'] if doc['has_audio'] else ['frames_are_visual_preview_not_full_video']})
        else:
            warnings.append('unsupported_format')
        doc['processing_status'] = 'prepared'
    except Exception as exc:
        doc['processing_status'] = 'error'
        warnings.append(type(exc).__name__ + ': ' + str(exc))
    doc['warnings'] = warnings
    dump(base/'document.json', doc)
    dump(base/'text_and_media_chunks.json', chunks)
    return ident, len(chunks), doc['processing_status']

def prepare():
    if SOURCE is None or not SOURCE.is_dir():
        raise ValueError('prepare requires --source-dir pointing to the source materials')
    if ROOT.is_relative_to(SOURCE):
        raise ValueError('The data directory must be outside the source directory')
    groups = {}
    for p in sorted(SOURCE.rglob('*')):
        if not p.is_file() or p.name.startswith('.'):
            continue
        sha = digest(p.read_bytes())
        path = p.relative_to(SOURCE).as_posix()
        if sha in groups:
            groups[sha]['source_paths'].append(path)
            continue
        m = re.search(r'(?:^|/)grade_(\d+)(?:/|$)', path)
        groups[sha] = {'document_id': sha[:24], 'sha256': sha, 'source_paths': [path],
                       'title': p.stem, 'extension': p.suffix.lower(), 'bytes': p.stat().st_size,
                       'collection': path.split('/')[0], 'grade_label': 'Grade '+m[1] if m else None,
                       'material_type': classify(p.name), 'classification_method': 'filename_and_directory_heuristic'}
    dump(ROOT/'source_inventory.json', list(groups.values()))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(prepare_one, doc) for doc in groups.values()]
        for n, f in enumerate(concurrent.futures.as_completed(futures), 1):
            print(n, '/', len(groups), *f.result(), flush=True)

def render(soffice):
    work = ROOT/'tools'/'render'
    inputs, outputs = work/'input', work/'pdf'
    inputs.mkdir(parents=True, exist_ok=True)
    outputs.mkdir(parents=True, exist_ok=True)
    pending = []
    for meta in sorted((ROOT/'documents').glob('*/document.json')):
        doc = json.loads(meta.read_text())
        if doc['extension'] not in ('.docx', '.pptx'):
            continue
        ident = doc['document_id']
        out = meta.parent/'rendered.pdf'
        if out.exists():
            continue
        inp = inputs/(ident+doc['extension'])
        if not inp.exists():
            shutil.copy2(ROOT/doc['original_path'], inp)
        pending.append(inp)
    # Isolated profile avoids touching any user's Office application or settings.
    for start in range(0, len(pending), 20):
        batch = pending[start:start+20]
        cmd = [soffice, '-env:UserInstallation='+ (work/'profile').as_uri(), '--headless', '--convert-to', 'pdf', '--outdir', str(outputs)] + [str(p) for p in batch]
        try:
            result = run(cmd, timeout=600)
            print(result.stdout[-1500:], flush=True)
        except Exception as exc:
            print('RENDER_BATCH_ERROR', str(exc), flush=True)
        for inp in batch:
            rendered = outputs/(inp.stem+'.pdf')
            if rendered.exists():
                dest = ROOT/'documents'/inp.stem/'rendered.pdf'
                shutil.move(rendered, dest)
        print('RENDER', min(start+20,len(pending)), '/',len(pending), flush=True)
    for meta in sorted((ROOT/'documents').glob('*/document.json')):
        doc = json.loads(meta.read_text())
        pdfpath = meta.parent/'rendered.pdf'
        if pdfpath.exists():
            doc['render_pdf_path'] = rel(pdfpath)
            doc['warnings'] = [w for w in doc['warnings'] if w != 'office_page_render_pending']
            doc['warnings'].append('office_layout_rendered_with_libreoffice; fonts_and_layout_need_spot_check')
            dump(meta,doc)

def pages():
    import pypdfium2 as pdfium
    for meta in sorted((ROOT/'documents').glob('*/document.json')):
        doc = json.loads(meta.read_text())
        if not doc.get('render_pdf_path'):
            continue
        out = meta.parent/'pages'
        out.mkdir(exist_ok=True)
        chunks = []
        try:
            pdf = pdfium.PdfDocument(str(ROOT/doc['render_pdf_path']))
            hidden = set(doc.get('hidden_slide_numbers', []))
            for n in range(len(pdf)):
                asset = out/f'{n+1:04d}.jpg'
                if not asset.exists():
                    page = pdf[n]
                    scale = min(2.0, 2000/max(page.get_size()))
                    # PDFium documents float scales; its unannotated default is inferred as int.
                    bitmap = page.render(scale=scale)  # pyright: ignore[reportArgumentType]
                    im = bitmap.to_pil().convert('RGB')
                    im.save(asset,quality=90)
                    bitmap.close()
                    page.close()
                chunks.append({'chunk_id': doc['document_id']+f'-page-{n+1:04d}',
                               'document_id': doc['document_id'], 'modality': 'image',
                               'representation': 'visual', 'asset_path': rel(asset),
                               'source_location': {'kind': 'slide' if doc['extension']=='.pptx' else 'rendered_page' if doc['extension']=='.docx' else 'page', 'page': n+1},
                               'warnings': ['cross_page_context_not_merged']})
                if doc['extension'] == '.pptx':
                    chunks[-1]['is_hidden_slide'] = n+1 in hidden
                    if n+1 in hidden:
                        chunks[-1]['warnings'].append('source_slide_hidden')
            doc['page_count'] = len(pdf)
            pdf.close()
            dump(meta, doc)
            dump(meta.parent/'page_chunks.json',chunks)
            print('PAGES',doc['document_id'],len(chunks),flush=True)
        except Exception as exc:
            doc['warnings'].append('page_render_error: '+str(exc))
            dump(meta,doc)

def repair_slides(soffice):
    """Export hidden slides too, preserving original numbering and note links."""
    import pypdfium2 as pdfium
    work = ROOT/'tools'/'hidden_slides'
    inputs, outputs = work/'input', work/'pdf'
    inputs.mkdir(parents=True,exist_ok=True)
    outputs.mkdir(parents=True,exist_ok=True)
    pending = []
    ns = {'p':'http://schemas.openxmlformats.org/presentationml/2006/main',
          'r':'http://schemas.openxmlformats.org/package/2006/relationships'}
    for meta in sorted((ROOT/'documents').glob('*/document.json')):
        doc = json.loads(meta.read_text())
        if doc['extension'] != '.pptx':
            continue
        with zipfile.ZipFile(ROOT/doc['original_path']) as z:
            tree = ET.fromstring(z.read('ppt/presentation.xml'))
            ids = tree.findall('.//p:sldId',ns)
            relationships = ET.fromstring(z.read('ppt/_rels/presentation.xml.rels'))
            targets = {e.attrib['Id']:e.attrib['Target'] for e in relationships}
            hidden = []
            for n, e in enumerate(ids,1):
                rid = e.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
                target = targets[rid]
                path = target.lstrip('/') if target.startswith('/') else 'ppt/'+target
                slide = ET.fromstring(z.read(path))
                if slide.attrib.get('show') == '0':
                    hidden.append(n)
        doc['slide_count'] = len(ids)
        doc['hidden_slide_numbers'] = hidden
        dump(meta,doc)
        pdf = pdfium.PdfDocument(str(ROOT/doc['render_pdf_path']))
        mismatch = len(pdf) != len(ids)
        pdf.close()
        if mismatch:
            inp = inputs/(doc['document_id']+'.pptx')
            shutil.copy2(ROOT/doc['original_path'],inp)
            pending.append(inp)
    for start in range(0,len(pending),10):
        batch = pending[start:start+10]
        result = run([soffice,'-env:UserInstallation='+(work/'profile').as_uri(),
                      '--headless','--convert-to',
                      'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"}}',
                      '--outdir',str(outputs)]+[str(p) for p in batch],timeout=600)
        print(result.stdout[-1000:],flush=True)
        for inp in batch:
            pdfpath = outputs/(inp.stem+'.pdf')
            base = ROOT/'documents'/inp.stem
            doc = json.loads((base/'document.json').read_text())
            pdf = pdfium.PdfDocument(str(pdfpath))
            assert len(pdf) == doc['slide_count'], (inp.stem,len(pdf),doc['slide_count'])
            pdf.close()
            shutil.move(pdfpath,base/'rendered.pdf')
            if (base/'pages').exists():
                shutil.rmtree(base/'pages')
            (base/'page_chunks.json').unlink(missing_ok=True)
        print('REPAIRED',min(start+10,len(pending)),'/',len(pending),flush=True)

def consolidate(overrides=None):
    overrides = overrides or {}
    docs, chunks = [], []
    for meta in sorted((ROOT/'documents').glob('*/document.json')):
        doc = json.loads(meta.read_text())
        docs.append(doc)
        for name in ('text_and_media_chunks.json','page_chunks.json'):
            p = meta.parent/name
            if p.exists():
                for chunk in json.loads(p.read_text()):
                    chunk['collection'] = doc['collection']
                    chunk['grade_label'] = doc['grade_label']
                    chunk['material_type'] = doc['material_type']
                    chunk['document_title'] = doc['title']
                    chunk['alternative_view_group'] = doc['document_id']
                    chunks.append(chunk)
    bydoc = defaultdict(list)
    for c in chunks:
        bydoc[c['document_id']].append(c)
    unknown = set(overrides) - {c['chunk_id'] for c in chunks}
    if unknown:
        raise ValueError('Unknown embedding override IDs: ' + ', '.join(sorted(unknown)))
    for doc in docs:
        group = bydoc[doc['document_id']]
        texts = [c for c in group if c['modality']=='text']
        for i,c in enumerate(texts):
            c['previous_text_chunk_id'] = texts[i-1]['chunk_id'] if i else None
            c['next_text_chunk_id'] = texts[i+1]['chunk_id'] if i+1<len(texts) else None
        route_document(ROOT, doc, group, overrides)
    for name,records in [('documents.jsonl',docs),('chunks.jsonl',chunks)]:
        with (ROOT/name).open('w',encoding='utf-8') as f:
            for row in records:
                f.write(json.dumps(row,ensure_ascii=False)+'\n')
    textgroups = defaultdict(list)
    for c in chunks:
        if c.get('content_sha256'):
            textgroups[c['content_sha256']].append(c['chunk_id'])
    repeated = [v for v in textgroups.values() if len(v)>1]
    dump(ROOT/'duplicate_text_groups.json',repeated)
    missing = []
    ids = set()
    for c in chunks:
        assert c['chunk_id'] not in ids, c['chunk_id']
        ids.add(c['chunk_id'])
        for asset in ([c['asset_path']] if c.get('asset_path') else []) + c.get('sampled_frame_paths',[]):
            if not (ROOT/asset).is_file():
                missing.append(asset)
    report = {'source_files':sum(len(d['source_paths']) for d in docs), 'unique_documents':len(docs),
              'extensions':dict(Counter(d['extension'] for d in docs)),
              'chunks':len(chunks), 'modalities':dict(Counter(c['modality'] for c in chunks)),
              'rendered_pages':sum(d.get('page_count',0) for d in docs),
              'default_embedding_candidates':sum(c['default_embedding_candidate'] for c in chunks),
              'embedding_candidates_by_route':dict(Counter(c['embedding_route'] for c in chunks if c['default_embedding_candidate'])),
              'embedding_selection_reasons':dict(Counter(c['embedding_reason'] for c in chunks)),
              'visual_review_chunk_ids':[c['chunk_id'] for c in chunks if c['embedding_route']=='review'],
              'selected_text_characters':sum(len(c['text']) for c in chunks if c['embedding_route']=='text'),
              'processing_errors':[d['document_id'] for d in docs if d['processing_status']=='error'],
              'pending_office_renders':[d['document_id'] for d in docs if 'office_page_render_pending' in d['warnings']],
              'missing_assets':missing, 'exact_duplicate_text_groups':len(repeated),
              'embedding_generated':False}
    dump(ROOT/'report.json',report)
    dump(ROOT/'manifest.json',{'schema_version':2,'source_directory':str(SOURCE) if SOURCE else None,
                              'path_base':'directory_containing_manifest', 'documents':'documents.jsonl',
                              'chunks':'chunks.jsonl', 'embedding_model':None,
                              'text_chunk_target_max_characters':2400,
                              'text_length_unit':'characters_not_tokens',
                              'default_embedding_view':'text_first',
                              'embedding_routes':['text','visual'],
                              'note':'Embed text and selected visual chunks separately with their corresponding models. Review uncertain layouts before visual embedding. Model-specific token limits must be checked before embedding.'})
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stage',choices=['prepare','render','repair-slides','pages','consolidate'])
    parser.add_argument('--data-dir', type=Path, default=ROOT)
    parser.add_argument('--source-dir', type=Path)
    parser.add_argument('--soffice')
    parser.add_argument('--embedding-overrides', type=Path,
                        help='JSON object mapping chunk IDs to text, visual or none; used by consolidate')
    args = parser.parse_args()
    ROOT = args.data_dir.expanduser().resolve()
    SOURCE = args.source_dir.expanduser().resolve() if args.source_dir else None
    if args.stage in ('render', 'repair-slides'):
        args.soffice = args.soffice or shutil.which('soffice')
        if not args.soffice:
            parser.error('LibreOffice is required: supply --soffice or put soffice on PATH')
    if args.stage=='prepare': prepare()
    elif args.stage=='render': render(args.soffice)
    elif args.stage=='repair-slides': repair_slides(args.soffice)
    elif args.stage=='pages': pages()
    else:
        overrides = json.loads(args.embedding_overrides.read_text()) if args.embedding_overrides else {}
        if not isinstance(overrides, dict):
            parser.error('--embedding-overrides must contain a JSON object')
        consolidate(overrides)
