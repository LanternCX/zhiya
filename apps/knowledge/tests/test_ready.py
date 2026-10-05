import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


class ReadyDatasetTests(unittest.TestCase):
    def test_ready_corpus_recovers_slide_titles_ignores_backgrounds_and_keeps_real_pictures(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            base = root / 'documents/doc'
            base.mkdir(parents=True)
            with zipfile.ZipFile(base / 'original.pptx', 'w') as archive:
                archive.writestr('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="1000" cy="1000"/></p:presentation>')
                for page in (1, 2):
                    picture = '' if page == 1 else '<p:pic><p:spPr><a:xfrm><a:ext cx="500" cy="500"/></a:xfrm></p:spPr></p:pic>'
                    archive.writestr(f'ppt/slides/slide{page}.xml',
                        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:bg><a:blipFill/></p:bg><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Training examples</a:t></a:r></a:p></p:txBody></p:sp>' + picture + '</p:spTree></p:cSld></p:sld>')
            doc = {'document_id': 'doc', 'original_path': 'documents/doc/original.pptx',
                   'extension': '.pptx', 'title': 'Lesson', 'collection': 'examples',
                   'grade_label': None, 'material_type': 'slides', 'source_paths': ['lesson.pptx'],
                   'processing_status': 'prepared', 'warnings': []}
            (base / 'document.json').write_text(json.dumps(doc))
            (base / 'text_and_media_chunks.json').write_text('[]')
            pages = []
            for page in (1, 2):
                (base / f'{page}.jpg').write_bytes(f'page-{page}'.encode())
                pages.append({'chunk_id': f'doc-page-{page:04d}', 'document_id': 'doc',
                              'modality': 'image', 'representation': 'visual',
                              'asset_path': f'documents/doc/{page}.jpg',
                              'source_location': {'kind': 'slide', 'page': page}})
            (base / 'page_chunks.json').write_text(json.dumps(pages))
            result = subprocess.run([sys.executable, '-m', 'preparation.ready', '--data-dir', str(root)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            rows = {r['chunk_id']: r for r in map(json.loads, (root / 'chunks.jsonl').read_text().splitlines())}
            self.assertFalse(rows['doc-page-0001']['default_embedding_candidate'])
            self.assertTrue(rows['doc-page-0002']['default_embedding_candidate'])
            self.assertEqual(rows['doc-page-0002']['embedding_route'], 'visual')
            recovered = [r for r in rows.values() if r['modality'] == 'text']
            self.assertEqual(len(recovered), 2)
            self.assertEqual(recovered[0]['text'], 'Training examples')
            self.assertEqual(sum(r['default_embedding_candidate'] for r in recovered), 1)
            duplicate = next(r for r in recovered if not r['default_embedding_candidate'])
            self.assertIn(duplicate['embedding_duplicate_of'], rows)
            self.assertEqual(json.loads((root / 'report.json').read_text())['visual_review_chunk_ids'], [])
