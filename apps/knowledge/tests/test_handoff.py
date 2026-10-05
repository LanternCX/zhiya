import json
import unittest
import tempfile
import zipfile
import io
from pathlib import Path

from preparation.handoff import text_segments, bound_text_chunks, import_archive, import_linked_images, preserve_sources


class HandoffTests(unittest.TestCase):
    def test_archive_import_reuses_documents_and_preserves_linked_images(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'handoff.zip'
            image = io.BytesIO()
            Image.new('RGB', (10, 10), 'red').save(image, format='PNG')
            entry = {'source_id': 'example', 'path': 'example/lesson.md', 'file_type': 'md'}
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('handoff_package/metadata/rag_documents_manifest.json', json.dumps({'documents': [entry]}))
                z.writestr('handoff_package/data/example/lesson.md', '# Lesson\n\nTraining data\n\n![diagram](diagram.png)')
                z.writestr('handoff_package/data/example/diagram.png', image.getvalue())
            output = root / 'output'
            self.assertEqual(import_archive(archive, output)['added'], 1)
            import_linked_images(archive, output)
            path = next((output / 'documents').glob('*/text_and_media_chunks.json'))
            chunks = json.loads(path.read_text())
            self.assertEqual({c['modality'] for c in chunks}, {'text', 'image'})
            self.assertEqual(import_archive(archive, output)['reused'], 1)
            import_linked_images(archive, output)
            self.assertEqual(json.loads(path.read_text()), chunks)
            preserve_sources(archive, output)
            self.assertEqual((output / 'sources/example/diagram.png').read_bytes(), image.getvalue())
            self.assertEqual((output / 'sources/example/lesson.md').read_text(),
                             '# Lesson\n\nTraining data\n\n![diagram](diagram.png)')

    def test_long_unbroken_output_is_split_without_losing_text_or_provenance(self):
        rows = bound_text_chunks([{'chunk_id': 'cell-1', 'modality': 'text',
                                   'text': 'x' * 5001, 'source_location': {'cell': 1}}])
        self.assertEqual([len(r['text']) for r in rows], [2400, 2400, 201])
        self.assertEqual(''.join(r['text'] for r in rows), 'x' * 5001)
        self.assertEqual(len({r['chunk_id'] for r in rows}), 3)
        self.assertTrue(all(r['source_location'] == {'cell': 1} for r in rows))

    def test_notebook_preserves_cells_and_outputs_without_execution(self):
        raw = json.dumps({'cells': [
            {'cell_type': 'markdown', 'source': ['# Lesson\n', 'Training examples']},
            {'cell_type': 'code', 'source': ['print(42)'],
             'outputs': [{'output_type': 'stream', 'text': ['42\n']}]},
        ]}).encode()
        result = list(text_segments('.ipynb', raw))
        self.assertEqual(result[0], ('# Lesson\nTraining examples', {'kind': 'cell', 'cell': 1}))
        self.assertIn('print(42)', result[1][0])
        self.assertIn('42\n', result[1][0])
        self.assertEqual(result[1][1]['cell'], 2)

    def test_jsonl_keeps_record_identity_and_extracts_content(self):
        raw = b'{"id":"book-a","content":"First lesson"}\n{"id":"book-b","content":"Second lesson"}\n'
        self.assertEqual(list(text_segments('.jsonl', raw)), [
            ('First lesson', {'kind': 'record', 'record': 1, 'record_id': 'book-a'}),
            ('Second lesson', {'kind': 'record', 'record': 2, 'record_id': 'book-b'}),
        ])
