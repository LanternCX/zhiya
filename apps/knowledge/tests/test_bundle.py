import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq


class BundleTests(unittest.TestCase):
    def test_uploaded_bundle_can_check_both_models_from_any_directory_without_source_repo(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = root / 'corpus'
            (data / 'data').mkdir(parents=True)
            pq.write_table(pa.Table.from_pylist([
                {'chunk_id': 'text1', 'document_id': 'doc1', 'modality': 'text', 'default_embedding_candidate': True},
                {'chunk_id': 'image1', 'document_id': 'doc1', 'modality': 'image', 'default_embedding_candidate': True},
            ]), data / 'data/chunks.parquet')
            (data / 'manifest.json').write_text('{"default_embedding_view":"text_first"}')
            (data / 'report.json').write_text('{"selection_finalized":true,"visual_review_chunk_ids":[]}')
            bundle = root / 'upload'
            result = subprocess.run([sys.executable, '-m', 'preparation.bundle', '--data-dir', str(data),
                                     '--output-dir', str(bundle)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            check = subprocess.run([sys.executable, str(bundle / 'check-inputs.py')], cwd=root,
                                   capture_output=True, text=True)
            self.assertEqual(check.returncode, 0, check.stderr)
            reports = json.loads(check.stdout)
            self.assertEqual(reports['text']['model_id'], 'Qwen/Qwen3-Embedding-8B')
            self.assertEqual(reports['visual']['model_id'], 'Qwen/Qwen3-VL-Embedding-8B')
            self.assertEqual(reports['text']['modalities'], {'text': 1})
            self.assertEqual(reports['visual']['modalities'], {'image': 1})
            self.assertEqual(reports['text']['dimension'], 4096)
            self.assertEqual(reports['visual']['dimension'], 4096)
            self.assertNotIn('.venv', [p.name for p in (bundle / 'apps/knowledge').iterdir()])
