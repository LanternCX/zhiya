import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from preparation.import_release import confirm, import_release


class ImportReleaseTest(unittest.TestCase):
    def release(self, root):
        profiles = []
        for route in ("text", "visual"):
            directory = f"embeddings/{route}"
            path = root / directory / "final/embeddings.parquet"
            path.parent.mkdir(parents=True)
            path.write_bytes(route.encode())
            profiles.append({"route": route, "directory": directory, "file": str(path.relative_to(root)),
                             "sha256": hashlib.sha256(route.encode()).hexdigest()})
        (root / "manifest.json").write_text(json.dumps({"format": "zhiya-knowledge-release-v1",
            "knowledge_directory": "knowledge", "embeddings": profiles}))

    def test_download_and_validation_precede_writes_and_both_routes_are_imported(self):
        with tempfile.TemporaryDirectory() as temp, contextlib.redirect_stdout(io.StringIO()):
            root = Path(temp).resolve()
            self.release(root)
            calls = []
            import_release(root, revision="fixed-release", execute=calls.append)
            self.assertEqual(calls[0][0], "hf")
            self.assertIn("fixed-release", calls[0])
            self.assertIn("preparation.validate", calls[1])
            self.assertIn("--upload-objects", calls[2])
            self.assertEqual(calls[3].count("--embedding-dir"), 2)
            self.assertIn(str(root / "embeddings/text"), calls[3])
            self.assertIn(str(root / "embeddings/visual"), calls[3])
            self.assertFalse(any("embedding.embed" in call for call in calls))

    def test_corrupt_vectors_stop_before_object_or_database_writes(self):
        with tempfile.TemporaryDirectory() as temp, contextlib.redirect_stdout(io.StringIO()):
            root = Path(temp).resolve()
            self.release(root)
            (root / "embeddings/text/final/embeddings.parquet").write_bytes(b"corrupt")
            calls = []
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                import_release(root, skip_download=True, execute=calls.append)
            self.assertFalse(any(call[0] == "go" for call in calls))

    def test_confirmation_explains_operations_and_never_treats_empty_input_as_approval(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertFalse(confirm(Path("data"), input_stream=io.StringIO("")))
        for text in ("Hugging Face", "PostgreSQL", "RustFS", "--yes"):
            self.assertIn(text, output.getvalue())
        class Terminal(io.StringIO):
            def isatty(self): return True
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(confirm(Path("data"), input_stream=Terminal("\n")))
            self.assertTrue(confirm(Path("data"), input_stream=Terminal("IMPORT\n")))
