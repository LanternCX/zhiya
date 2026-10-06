import io
import tempfile
import unittest
from pathlib import Path

from preparation.publish_objects import upload


class MissingObject(Exception):
    response = {"Error": {"Code": "404"}}


class Store:
    def __init__(self):
        self.objects = {}
        self.writes = 0

    def head_object(self, *, Bucket, Key):
        if Key not in self.objects:
            raise MissingObject()
        return {"ContentLength": len(self.objects[Key])}

    def put_object(self, *, Bucket, Key, Body, ContentType):
        self.objects[Key] = Body.read()
        self.writes += 1


class PublishObjectsTest(unittest.TestCase):
    def test_upload_preserves_relative_paths_and_reuses_identical_objects(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "documents").mkdir()
            (root / "documents/original.txt").write_bytes(b"teaching content")
            (root / "copy.txt").write_bytes(b"teaching content")
            store = Store()
            catalog = upload(root, store, "knowledge", progress=io.StringIO())
            self.assertEqual(catalog["format"], "zhiya-knowledge-object-catalog-v1")
            self.assertEqual([f["path"] for f in catalog["files"]], ["knowledge/copy.txt", "knowledge/documents/original.txt"])
            self.assertEqual(catalog["files"][0]["key"], catalog["files"][1]["key"])
            self.assertEqual(store.writes, 1)
            self.assertEqual(upload(root, store, "knowledge", progress=io.StringIO()), catalog)
            self.assertEqual(store.writes, 1)

    def test_storage_errors_are_not_treated_as_missing_objects(self):
        class BrokenStore(Store):
            def head_object(self, **kwargs):
                raise RuntimeError("service unavailable")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "source.txt").write_text("content")
            store = BrokenStore()
            with self.assertRaises(RuntimeError):
                upload(root, store, "knowledge", progress=io.StringIO())
            self.assertEqual(store.writes, 0)
