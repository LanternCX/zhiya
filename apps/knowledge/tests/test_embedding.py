import json
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from embedding import embed


CONFIG = Path(__file__).resolve().parents[1] / 'configs' / 'embedding.toml'


class EmbeddingTests(unittest.TestCase):
    def test_dataset_output_and_model_cache_can_be_independently_selected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            args = type('Args', (), {'data_dir': root / 'datasets/lesson',
                                     'output_dir': root / 'results/lesson/text',
                                     'model_cache': root / 'models'})()
            config = embed.read_config(CONFIG.with_name('embedding-text.toml'), args)
            self.assertEqual(config['data_dir'], str(root / 'datasets/lesson'))
            self.assertEqual(config['output_dir'], str(root / 'results/lesson/text'))
            self.assertEqual(config['model_cache'], str(root / 'models'))

    def test_text_job_embeds_selected_text_without_media_or_hidden_text(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'data').mkdir()
            pq.write_table(pa.Table.from_pylist([
                {'chunk_id': 'text1', 'document_id': 'doc1', 'modality': 'text',
                 'default_embedding_candidate': True, 'text': 'Learning from examples.'},
                {'chunk_id': 'hidden-text', 'document_id': 'doc1', 'modality': 'text',
                 'default_embedding_candidate': False, 'text': 'Hidden lesson.'},
                {'chunk_id': 'image1', 'document_id': 'doc1', 'modality': 'image',
                 'default_embedding_candidate': True},
            ]), root / 'data/chunks.parquet')
            config = embed.read_config(CONFIG.with_name('embedding-text.toml'), type('Args', (), {
                'data_dir': root, 'output_dir': root / 'text-output',
            })())
            config.update(view='text', dimension=64)
            inputs = []
            def encode(batch):
                inputs.extend(batch)
                return [[1.0] + [0.0] * 63]
            result = embed.run_job(config, encode=encode)
            self.assertEqual(result['completed'], 1)
            self.assertEqual(inputs, [{'text': 'Learning from examples.'}])
            rows = [row for file in (root / 'text-output').glob('*.parquet')
                    for row in pq.read_table(file).to_pylist()]
            self.assertEqual([row['chunk_id'] for row in rows], ['text1'])
            (root / 'manifest.json').write_text('{"default_embedding_view":"visual"}')
            with self.assertRaisesRegex(ValueError, 'consolidate'):
                embed.inspect_input(config)

    def test_interrupted_job_resumes_and_rejects_changed_instruction(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'data').mkdir()
            image = io.BytesIO()
            Image.new('RGB', (8, 8), 'red').save(image, format='PNG')
            pq.write_table(pa.Table.from_pylist([
                {'chunk_id': ident, 'document_id': 'doc1', 'modality': 'image',
                 'default_embedding_candidate': True, 'image': {'bytes': image.getvalue()},
                 'video': None, 'text': None}
                for ident in ('image1', 'image2')
            ]), root / 'data/chunks.parquet')
            config = embed.read_config(CONFIG, type('Args', (), {
                'data_dir': root, 'output_dir': root / 'output',
            })())
            config['dimension'] = 64
            calls = []

            def interrupted(inputs):
                calls.append(inputs)
                if len(calls) == 2:
                    raise RuntimeError('GPU interrupted')
                return [[3.0, 4.0] + [0.0] * 62]

            with self.assertRaisesRegex(RuntimeError, 'GPU interrupted'):
                embed.run_job(config, encode=interrupted)
            resumed = []

            def encode(inputs):
                resumed.extend(inputs)
                return [[3.0, 4.0] + [0.0] * 62]

            result = embed.run_job(config, encode=encode)
            self.assertEqual(result['completed'], 2)
            self.assertEqual(len(resumed), 1)
            rows = [row for file in (root / 'output').glob('*.parquet')
                    for row in pq.read_table(file).to_pylist()]
            self.assertEqual({row['chunk_id'] for row in rows}, {'image1', 'image2'})
            self.assertAlmostEqual(rows[0]['embedding'][0], 0.6)
            self.assertAlmostEqual(rows[0]['embedding'][1], 0.8)
            config['instruction'] = 'A different task.'
            with self.assertRaisesRegex(ValueError, 'different'):
                embed.run_job(config, encode=encode)

    def test_check_selects_candidates_without_loading_model_or_external_assets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'data').mkdir()
            pq.write_table(pa.Table.from_pylist([
                {'chunk_id': 'image1', 'document_id': 'doc1', 'modality': 'image',
                 'default_embedding_candidate': True},
                {'chunk_id': 'hidden1', 'document_id': 'doc1', 'modality': 'image',
                 'default_embedding_candidate': False},
                {'chunk_id': 'text1', 'document_id': 'doc1', 'modality': 'text',
                 'default_embedding_candidate': True},
                {'chunk_id': 'video1', 'document_id': 'doc2', 'modality': 'video',
                 'default_embedding_candidate': True},
            ]), root / 'data/chunks.parquet')
            result = subprocess.run([
                sys.executable, '-m', 'embedding.embed', 'check',
                '--data-dir', str(root),
            ], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report['selected'], 2)
            self.assertEqual(report['modalities'], {'image': 1, 'video': 1})


if __name__ == '__main__':
    unittest.main()
