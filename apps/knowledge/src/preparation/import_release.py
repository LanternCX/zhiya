"""Confirm, download, validate and import a complete public knowledge release."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

from preparation.validate import file_sha256

PROJECT_ROOT = Path(__file__).resolve().parents[4]
REPOSITORY = "LanternCX/zhiya-knowledge"


def execute(command):
    subprocess.run(command, cwd=PROJECT_ROOT, check=True)


def inside(root, name):
    if not isinstance(name, str) or not name:
        raise ValueError("Invalid release path")
    path = (root / name).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Release path escapes data directory")
    return path


def confirm(data_dir, revision=None, skip_download=False, yes=False, input_stream=None, targets=None):
    target_description = ""
    if targets:
        target_description = (f"\n数据库目标：{targets['database_host']} / {targets['database_name']}"
                              f"\n对象存储目标：{targets['object_endpoint']} / {targets['object_bucket']}")
    print(f"""知识库导入操作说明

来源：Hugging Face https://huggingface.co/datasets/{REPOSITORY}
版本：{revision or 'main（当前发布版本）'}
本地目录：{data_dir.resolve()}
{target_description}
下载：{'跳过下载，校验本地资料与向量' if skip_download else '下载完整资料和两路已有向量，逻辑文件总量约 12 GB；硬链接展开和缓存需要额外空间'}
写入：按 knowledge_storage 配置上传到 RustFS / S3 对象桶；按 knowledge_database 配置创建或初始化 PostgreSQL 知识库并导入文档、block 和文本／视觉索引，完成后激活该资料版本。
配置：apps/server/config.yaml、config.local.yaml 和 ZHIYA_SERVER_* 字段环境变量。请确认目标为专用知识库，勿指向业务数据库。
现有对象按内容指纹复用；重复执行不会重新生成 Embedding。本脚本不会修改业务表、删除旧资料或调用模型 API。

这些操作会占用磁盘、网络并写入数据库和对象存储。Agent 必须先获得操作者授权，再用 --yes 表示已确认。
""")
    if yes:
        return True
    stream = input_stream or sys.stdin
    if not stream.isatty():
        print("未获得确认，未执行下载或写入。请审核上述操作后显式传入 --yes。")
        return False
    print("确认目标和操作后请输入 IMPORT；其他输入取消：", end="", flush=True)
    return stream.readline().strip() == "IMPORT"


def import_release(data_dir, revision=None, skip_download=False, execute=execute):
    root = Path(data_dir).resolve()
    if not skip_download:
        print("下载公开知识库资料与已有向量……", flush=True)
        execute(["hf", "download", REPOSITORY, "--type", "dataset", "--local-dir", str(root)]
                + (["--revision", revision] if revision else []))
    manifest = json.loads((root / "manifest.json").read_text())
    profiles = manifest.get("embeddings", [])
    if (manifest.get("format") != "zhiya-knowledge-release-v1" or len(profiles) != 2
            or {item["route"] for item in profiles} != {"text", "visual"}):
        raise ValueError("Expected a complete text and visual knowledge release")
    corpus = inside(root, manifest["knowledge_directory"])
    print("校验完整资料、素材关联和最终向量指纹……", flush=True)
    execute([sys.executable, "-m", "preparation.validate", "--data-dir", str(corpus)])
    for profile in profiles:
        if file_sha256(inside(root, profile["file"])) != profile["sha256"]:
            raise ValueError(f"{profile['route']} embedding checksum mismatch")
    command = ["go", "-C", str(PROJECT_ROOT / "apps/server"), "run", "./cmd/knowledge",
               "--data-dir", str(corpus), "--catalog", str(root / "object-catalog.json")]
    print("上传资料到配置的 RustFS / S3 知识库桶……", flush=True)
    execute(command + ["--upload-objects"])
    print("将两路已完成向量导入 PostgreSQL……", flush=True)
    arguments = []
    for profile in profiles:
        arguments += ["--embedding-dir", str(inside(root, profile["directory"]))]
    execute(command + arguments)
    print("知识库导入完成，没有重新生成 Embedding。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=PROJECT_ROOT / "data")
    parser.add_argument("--revision", help="fixed Hugging Face commit or tag")
    parser.add_argument("--skip-download", action="store_true", help="validate and import existing local data")
    parser.add_argument("--yes", action="store_true", help="explicitly approve the displayed download and storage writes")
    args = parser.parse_args()
    print("知识库导入：先读取目标配置并说明操作，确认前不会下载资料或写入存储。", flush=True)
    try:
        targets = subprocess.run(["go", "-C", str(PROJECT_ROOT / "apps/server"), "run", "./cmd/knowledge", "--describe-targets"], cwd=PROJECT_ROOT, check=True, capture_output=True, text=True)
        targets = json.loads(targets.stdout)
    except (OSError, ValueError, subprocess.CalledProcessError):
        print("无法读取知识库目标配置，未执行下载或存储写入。请检查 Go 和服务端配置。", file=sys.stderr)
        return 1
    if not confirm(args.data_dir, args.revision, args.skip_download, args.yes, targets=targets):
        print("已取消导入。")
        return 2
    try:
        import_release(args.data_dir, args.revision, args.skip_download)
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError):
        print("导入已停止；请检查上一阶段错误、数据完整性及服务配置。不会继续执行后续步骤。", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
