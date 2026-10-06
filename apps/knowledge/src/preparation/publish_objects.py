"""Upload a downloaded corpus to an S3-compatible bucket and emit its import catalog."""
import argparse
import json
import mimetypes
import os
from pathlib import Path
import sys

from preparation.validate import file_sha256


def upload(root, store, bucket, progress=sys.stderr):
    root = Path(root).resolve()
    catalog = {"format": "zhiya-knowledge-object-catalog-v1", "files": []}
    seen = set()
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Symbolic links are not supported: {path.relative_to(root)}")
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part in {".cache", "__pycache__", ".git", ".DS_Store"} for part in relative.parts):
            continue
        digest = file_sha256(path)
        key = "blobs/sha256/" + digest
        size = path.stat().st_size
        if key not in seen:
            try:
                head = store.head_object(Bucket=bucket, Key=key)
            except Exception as error:
                code = getattr(error, "response", {}).get("Error", {}).get("Code")
                if code not in {"404", "NoSuchKey", "NotFound"}:
                    raise
                with path.open("rb") as body:
                    store.put_object(Bucket=bucket, Key=key, Body=body,
                                     ContentType=mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            else:
                if head["ContentLength"] != size:
                    raise ValueError(f"Existing object size mismatch: {relative}")
            seen.add(key)
        catalog["files"].append({"path": "knowledge/" + relative.as_posix(),
                                 "key": key, "sha256": digest, "size": size})
        if len(catalog["files"]) % 100 == 0:
            print(f"Cataloged {len(catalog['files'])} files, {len(seen)} unique objects", file=progress)
    return catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--catalog-out", required=True, type=Path)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--region", default="us-east-1")
    args = parser.parse_args()
    if not args.data_dir.is_dir():
        parser.error("--data-dir must be an existing corpus directory")
    if args.catalog_out.resolve().is_relative_to(args.data_dir.resolve()):
        parser.error("--catalog-out must be outside --data-dir")
    for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        if not os.environ.get(name):
            parser.error(f"Set {name} for the destination bucket")
    import boto3
    from botocore.config import Config
    store = boto3.client("s3", endpoint_url=args.endpoint, region_name=args.region,
                         config=Config(s3={"addressing_style": "path"}))
    catalog = upload(args.data_dir, store, args.bucket)
    args.catalog_out.parent.mkdir(parents=True, exist_ok=True)
    with args.catalog_out.open("w") as output:
        json.dump(catalog, output, ensure_ascii=False, indent=2)
    print(f"Saved import catalog for {len(catalog['files'])} files: {args.catalog_out}")


if __name__ == "__main__":
    main()
