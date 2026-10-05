"""Choose separate text and visual embedding inputs without model/API calls."""
def page_layouts(root, doc):
    """Inspect PDF objects rather than paying a vision model to classify pages.

    Large images and complex vector drawings are visual candidates. Small logos,
    borders and page backgrounds do not make a text page a mandatory VL input.
    These are reviewable heuristics, not a guarantee of semantic completeness.
    """
    if not doc.get('render_pdf_path'):
        return {}
    import pypdfium2 as pdfium
    import pypdfium2.raw as raw

    layouts = {}
    try:
        with pdfium.PdfDocument(str(root / doc['render_pdf_path'])) as pdf:
            for number in range(len(pdf)):
                page = pdf[number]
                try:
                    width, height = page.get_size()
                    page_area = width * height
                    image_area, paths, complex_paths, objects = 0, 0, 0, 0
                    for obj in page.get_objects(max_depth=8):
                        objects += 1
                        if obj.type not in (raw.FPDF_PAGEOBJ_IMAGE, raw.FPDF_PAGEOBJ_PATH):
                            continue
                        left, bottom, right, top = obj.get_bounds()
                        area = max(0, min(right, width) - max(left, 0)) * max(0, min(top, height) - max(bottom, 0))
                        if obj.type == raw.FPDF_PAGEOBJ_IMAGE:
                            image_area += area
                        elif area < page_area * 0.9:
                            paths += 1
                            complex_paths += raw.FPDFPath_CountSegments(obj.raw) >= 8
                    layouts[number + 1] = {
                        'image_area_fraction': round(min(1, image_area / page_area), 4),
                        'drawing_paths': paths, 'complex_paths': complex_paths,
                        'empty': objects == 0,
                    }
                finally:
                    page.close()
    except Exception as error:
        # Do not quietly classify unreadable layouts as complete text.
        doc.setdefault('warnings', []).append('embedding_layout_check_failed: ' + type(error).__name__)
        return {}
    return layouts


def route_document(root, doc, chunks, overrides):
    layouts = page_layouts(root, doc)
    texts = [c for c in chunks if c['modality'] == 'text']
    hidden = set(doc.get('hidden_slide_numbers', []))
    text_pages = {}
    for text in texts:
        text_pages.setdefault(text['source_location'].get('page'), []).append(text)
    covered_pages = {page for page, rows in text_pages.items()
                     if page not in hidden and any(t.get('text', '').strip() and not t.get('is_hidden_slide') for t in rows)}
    any_text = bool(covered_pages)
    for chunk in chunks:
        page = chunk['source_location'].get('page')
        if page in hidden:
            chunk['is_hidden_slide'] = True
        same_page = text_pages.get(page, [])
        if chunk['modality'] != 'text' and page is not None:
            chunk['associated_text_chunk_ids'] = [t['chunk_id'] for t in same_page]
        covered = page in covered_pages if page is not None else any_text
        # DOCX extraction is organized by headings; rendered page numbers are not
        # valid text locators. Preserve heading chunks without inventing page links.
        if doc['extension'] == '.docx':
            covered = any_text
        layout = layouts.get(page)
        route, reason = 'none', 'hidden_slide'
        if not chunk.get('is_hidden_slide'):
            if chunk['modality'] == 'text':
                route, reason = ('text', 'extracted_text') if chunk.get('text', '').strip() else ('none', 'empty_text')
            elif chunk['modality'] == 'video':
                route, reason = 'review', 'video_requires_selection'
            elif chunk['source_location']['kind'] == 'image':
                route, reason = 'visual', 'standalone_image'
            elif layout and layout['empty']:
                route, reason = 'none', 'empty_page'
            elif not covered:
                route, reason = 'visual', 'no_extracted_text'
            elif layout is None:
                route, reason = 'review', 'unknown_page_layout'
            elif layout['image_area_fraction'] >= 0.08 or layout['drawing_paths'] >= 12 or layout['complex_paths']:
                route, reason = 'review', 'visual_content_requires_selection'
            else:
                route, reason = 'none', 'covered_by_text'
        if chunk['chunk_id'] in overrides:
            override = overrides[chunk['chunk_id']]
            valid_modality = override == 'none' or (
                override == 'text' and chunk['modality'] == 'text') or (
                override == 'visual' and chunk['modality'] in ('image', 'video'))
            if not valid_modality:
                raise ValueError('Invalid embedding route override: ' + chunk['chunk_id'])
            if chunk.get('is_hidden_slide') and override != 'none':
                raise ValueError('Hidden slides cannot be selected: ' + chunk['chunk_id'])
            route, reason = override, 'manual_selection'
        chunk['embedding_route'] = route
        chunk['embedding_reason'] = reason
        chunk['default_embedding_candidate'] = route in ('text', 'visual')
        if layout is not None:
            chunk['visual_evidence'] = layout
