import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

import pyarrow as pa
import pyarrow.parquet as pq

from embedding.retrieval_export import export


class RetrievalExportTest(unittest.TestCase):
    def test_exports_existing_vectors_and_their_model_without_inference(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            vector = [1.0] + [0.0] * 4095
            pq.write_table(pa.Table.from_pylist([{'chunk_id': 'block', 'document_id': 'doc',
                                                'modality': 'image', 'embedding': vector}]), root / 'embeddings.parquet')
            (root / 'run.json').write_text(json.dumps({'status': 'complete', 'completed': 1, 'selected': 1,
                'normalized': True, 'settings': {'model_id': 'Qwen/Qwen3-VL-Embedding-8B',
                'model_revision': '2c4565515e0f265c6511776e7193b22c0968ddc7', 'dimension': 4096,
                'view': 'visual', 'instruction': "Represent the user's input."}}))
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                export(root)
            lines = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(lines[0]['model'], 'Qwen/Qwen3-VL-Embedding-8B')
            self.assertEqual(lines[0]['dimension'], 4096)
            self.assertEqual(lines[1]['chunk_id'], 'block')
            self.assertEqual(lines[1]['embedding'], vector)
