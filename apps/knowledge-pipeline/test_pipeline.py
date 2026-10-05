import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parent


class PipelineTests(unittest.TestCase):
    def test_prepare_rejects_output_inside_source(self):
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run([
                sys.executable, str(SCRIPTS / 'prepare.py'), 'prepare',
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
                'review_status': 'unreviewed', 'default_embedding_candidate': True,
            }
            (root / 'documents.jsonl').write_text(json.dumps(doc) + '\n')
            (root / 'chunks.jsonl').write_text(json.dumps(chunk) + '\n')
            (root / 'manifest.json').write_text('{"schema_version": 1}')
            result = subprocess.run([
                sys.executable, str(SCRIPTS / 'export_parquet.py'), '--data-dir', str(root),
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            loaded = load_dataset('parquet', data_files=str(root / 'data/chunks.parquet'), split='train')
            loaded = loaded.cast_column('image', DatasetImage(decode=False))
            self.assertEqual(loaded[0]['image']['bytes'], (root / 'image.png').read_bytes())
            validator = [sys.executable, str(SCRIPTS / 'validate.py'), '--data-dir', str(root)]
            valid = subprocess.run(validator, capture_output=True, text=True)
            self.assertEqual(valid.returncode, 0, valid.stderr)
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
                sys.executable, str(SCRIPTS / 'prepare.py'), 'consolidate',
                '--data-dir', str(root), '--source-dir', str(root / 'source'),
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            chunk = json.loads((root / 'chunks.jsonl').read_text())
            self.assertEqual(chunk['document_title'], 'Activity')
            self.assertFalse(chunk['default_embedding_candidate'])
            self.assertEqual(json.loads((root / 'report.json').read_text())['chunks'], 1)


if __name__ == '__main__':
    unittest.main()
