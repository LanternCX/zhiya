import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class PipelineTests(unittest.TestCase):
    def test_text_first_routing_keeps_diagrams_and_unreadable_pages_without_embedding_plain_pages(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            docdir = root / 'documents' / 'doc1'
            docdir.mkdir(parents=True)
            # Real PDF pages: prose, prose plus vector drawing, no extractable text, hidden prose.
            prose = b'BT /F1 12 Tf 20 250 Td (A lesson about training examples.) Tj ET\n'
            streams = [prose, prose + b'\n'.join(
                f'{20+i*4} 30 m {20+i*4} 180 l S'.encode() for i in range(25)), b'0 0 300 300 re f', prose]
            objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
                       b'<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R 10 0 R] /Count 4 >>',
                       b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
            for i, stream in enumerate(streams):
                objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 3 0 R >> >> /Contents {5+i*2} 0 R >>'.encode())
                objects.append(f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'\nendstream')
            pdf = b'%PDF-1.4\n'
            offsets = [0]
            for i, obj in enumerate(objects, 1):
                offsets.append(len(pdf))
                pdf += f'{i} 0 obj\n'.encode() + obj + b'\nendobj\n'
            xref = len(pdf)
            pdf += f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode()
            pdf += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
            pdf += f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode()
            (docdir / 'rendered.pdf').write_bytes(pdf)
            (docdir / 'document.json').write_text(json.dumps({
                'document_id': 'doc1', 'source_paths': ['lesson.pptx'],
                'collection': 'examples', 'grade_label': None, 'material_type': 'slides',
                'title': 'Lesson', 'extension': '.pptx', 'processing_status': 'prepared',
                'warnings': [], 'render_pdf_path': 'documents/doc1/rendered.pdf',
                'hidden_slide_numbers': [4],
            }))
            texts = [{'chunk_id': f'text{page}', 'document_id': 'doc1',
                      'modality': 'text', 'representation': 'text',
                      'text': 'A lesson about training examples.',
                      'source_location': {'kind': 'slide', 'page': page}}
                     for page in (1, 2, 4)]
            (docdir / 'text_and_media_chunks.json').write_text(json.dumps(texts))
            pages = []
            for page in range(1, 5):
                (docdir / f'{page}.jpg').write_bytes(b'page')
                pages.append({'chunk_id': f'page{page}', 'document_id': 'doc1',
                              'modality': 'image', 'representation': 'visual',
                              'asset_path': f'documents/doc1/{page}.jpg',
                              'source_location': {'kind': 'slide', 'page': page},
                              'is_hidden_slide': page == 4})
            (docdir / 'page_chunks.json').write_text(json.dumps(pages))
            result = subprocess.run([sys.executable, '-m', 'preparation.prepare', 'consolidate',
                                     '--data-dir', str(root)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            rows = {row['chunk_id']: row for row in map(json.loads, (root / 'chunks.jsonl').read_text().splitlines())}
            self.assertEqual({ident for ident, row in rows.items() if row['default_embedding_candidate']},
                             {'text1', 'text2', 'page3'})
            self.assertEqual(rows['page1']['embedding_reason'], 'covered_by_text')
            self.assertEqual(rows['page2']['embedding_route'], 'review')
            self.assertEqual(rows['page3']['embedding_reason'], 'no_extracted_text')
            self.assertEqual(rows['page2']['associated_text_chunk_ids'], ['text2'])
            report = json.loads((root / 'report.json').read_text())
            self.assertEqual(report['embedding_candidates_by_route'], {'text': 2, 'visual': 1})
            self.assertEqual(report['visual_review_chunk_ids'], ['page2'])
            (root / 'selection.json').write_text('{"page2":"visual"}')
            selected = subprocess.run([sys.executable, '-m', 'preparation.prepare', 'consolidate',
                                       '--data-dir', str(root), '--embedding-overrides', str(root / 'selection.json')],
                                      capture_output=True, text=True)
            self.assertEqual(selected.returncode, 0, selected.stderr)
            rows = {row['chunk_id']: row for row in map(json.loads, (root / 'chunks.jsonl').read_text().splitlines())}
            self.assertTrue(rows['page2']['default_embedding_candidate'])
            self.assertEqual(rows['page2']['embedding_reason'], 'manual_selection')

    def test_prepare_rejects_output_inside_source(self):
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run([
                sys.executable, '-m', 'preparation.prepare', 'prepare',
                '--source-dir', folder, '--data-dir', str(Path(folder) / 'output'),
            ], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('outside', result.stderr)

    def test_export_is_portable_and_validation_rejects_changed_assets(self):
        import hashlib
        from PIL import Image
        from datasets import Image as DatasetImage, load_dataset

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            Image.new('RGB', (8, 8), 'red').save(root / 'image.png')
            doc = {
                'document_id': 'doc1', 'title': 'Example',
                'sha256': hashlib.sha256((root / 'image.png').read_bytes()).hexdigest(),
                'source_paths': ['image.png'], 'original_path': 'image.png',
                'extension': '.png', 'collection': 'examples', 'material_type': 'activity',
                'warnings': [], 'processing_status': 'prepared',
            }
            chunk = {
                'chunk_id': 'image1', 'document_id': 'doc1', 'modality': 'image',
                'representation': 'visual', 'asset_path': 'image.png',
                'document_title': 'Example', 'collection': 'examples',
                'material_type': 'activity', 'source_location': {'kind': 'image'},
                'default_embedding_candidate': True,
                'embedding_route': 'visual', 'embedding_reason': 'standalone_image',
            }
            (root / 'documents.jsonl').write_text(json.dumps(doc) + '\n')
            (root / 'chunks.jsonl').write_text(json.dumps(chunk) + '\n')
            (root / 'manifest.json').write_text('{"schema_version": 1}')
            result = subprocess.run([
                sys.executable, '-m', 'preparation.export_parquet', '--data-dir', str(root),
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            loaded = load_dataset('parquet', data_files=str(root / 'data/chunks.parquet'), split='train')
            loaded = loaded.cast_column('image', DatasetImage(decode=False))
            self.assertEqual(loaded[0]['image']['bytes'], (root / 'image.png').read_bytes())
            self.assertEqual(loaded[0]['embedding_route'], 'visual')
            self.assertEqual(loaded[0]['embedding_reason'], 'standalone_image')
            self.assertNotIn('review_status', loaded.column_names)
            validator = [sys.executable, '-m', 'preparation.validate', '--data-dir', str(root)]
            valid = subprocess.run(validator, capture_output=True, text=True)
            self.assertEqual(valid.returncode, 0, valid.stderr)
            external = subprocess.run([
                sys.executable, '-m', 'preparation.export_parquet', '--data-dir', str(root),
                '--external-media',
            ], capture_output=True, text=True)
            self.assertEqual(external.returncode, 0, external.stderr)
            import pyarrow.parquet as pq
            external_row = pq.read_table(root / 'data/chunks.parquet').to_pylist()[0]
            self.assertIsNone(external_row['image'])
            self.assertEqual(external_row['asset_path'], 'image.png')
            from embedding.embed import media_bytes
            self.assertEqual(media_bytes(external_row, root), (root / 'image.png').read_bytes())
            (root / 'image.png').write_bytes(b'changed')
            invalid = subprocess.run(validator, capture_output=True, text=True)
            self.assertNotEqual(invalid.returncode, 0)
            self.assertIn('checksum', invalid.stderr.lower())

    def test_consolidate_uses_selected_directory_and_preserves_source_links(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            docdir = root / 'documents' / 'doc1'
            docdir.mkdir(parents=True)
            (docdir / 'document.json').write_text(json.dumps({
                'document_id': 'doc1', 'source_paths': ['grade_1/a.docx'],
                'collection': 'grade_1', 'grade_label': 'Grade 1',
                'material_type': 'activity', 'title': 'Activity',
                'extension': '.docx', 'processing_status': 'prepared', 'warnings': [],
            }))
            (docdir / 'text_and_media_chunks.json').write_text(json.dumps([
                {'chunk_id': 'text1', 'document_id': 'doc1', 'modality': 'text',
                 'representation': 'text', 'text': 'A learning activity.',
                 'source_location': {'kind': 'heading'}, 'content_sha256': 'hash1'},
            ]))
            result = subprocess.run([
                sys.executable, '-m', 'preparation.prepare', 'consolidate',
                '--data-dir', str(root), '--source-dir', str(root / 'source'),
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            chunk = json.loads((root / 'chunks.jsonl').read_text())
            self.assertEqual(chunk['document_title'], 'Activity')
            self.assertTrue(chunk['default_embedding_candidate'])
            self.assertEqual(chunk['embedding_route'], 'text')
            self.assertNotIn('review_status', chunk)
            self.assertEqual(json.loads((root / 'report.json').read_text())['chunks'], 1)


if __name__ == '__main__':
    unittest.main()
