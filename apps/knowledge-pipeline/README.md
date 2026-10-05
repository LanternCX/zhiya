# 教学知识库数据管线

准备并验证 Hugging Face Datasets 可读取的教学资料集。代码维护在此目录；本地资料默认位于仓库根目录的 `data/knowledge/`，整个 `data/` 已被 Git 忽略。数据后续可以在 Hugging Face Dataset 仓库独立维护。

本工具处理平台预备的教学资料，支持预处理和自部署模型的离线 embedding，不改变学生上传材料的格式支持，也不负责学生长期记忆、数据库导入或在线检索。

## 环境

从项目根目录运行。Python 3.12 和依赖由 `uv` 管理：

```sh
uv sync --locked --project apps/knowledge-pipeline
```

Office 页面转换还需要 LibreOffice，视频处理需要 PATH 中的 `ffmpeg` 和 `ffprobe`。它们不是 Python 依赖。`--soffice` 可指定 LibreOffice 的可执行文件；省略时从 PATH 查找。字体安装和 LibreOffice 版本会影响排版，批量 embedding 前应抽查页面。

## 使用现有数据

```sh
uv run --locked --project apps/knowledge-pipeline python apps/knowledge-pipeline/validate.py
```

默认读取 `data/knowledge/`。所有命令支持 `--data-dir /absolute/path/to/dataset`，可以直接操作仓库外的数据目录。

## 从原始资料重新生成

输入与输出目录应分开。处理不会修改输入资料；输出目录属于本工具的工作目录，其中的派生文件会被更新。

```sh
uv run --locked --project apps/knowledge-pipeline python apps/knowledge-pipeline/prepare.py prepare --source-dir /absolute/path/to/extracted
uv run --locked --project apps/knowledge-pipeline python apps/knowledge-pipeline/prepare.py render --soffice /absolute/path/to/soffice
uv run --locked --project apps/knowledge-pipeline python apps/knowledge-pipeline/prepare.py repair-slides --soffice /absolute/path/to/soffice
uv run --locked --project apps/knowledge-pipeline python apps/knowledge-pipeline/prepare.py pages
uv run --locked --project apps/knowledge-pipeline python apps/knowledge-pipeline/prepare.py consolidate
uv run --locked --project apps/knowledge-pipeline python apps/knowledge-pipeline/export_parquet.py
```

按上述顺序执行：提取与去重、Office 转换、隐藏幻灯片校正、页面渲染、内容块汇总、Parquet 导出与验证。恢复中断处理时，先检查报告；部分步骤复用已有输出。重新生成不同来源的资料集应使用新的输出目录，避免混入旧文档。

`consolidate` 生成中间 JSONL 和 manifest，`export_parquet.py` 将 manifest 更新为 Parquet 文件路径和校验值。最终导出后运行 `validate.py`，会检查素材字节、原文件指纹、块引用及 PPT 页面关联。验证失败的资料集不应作为完成版本上传。

## Hugging Face Dataset 格式

最终数据集结构：

```text
data/knowledge/
├── README.md                    # Dataset Card，声明 chunks/documents 配置
├── manifest.json                # 数据版本、处理约定、Parquet 校验值
├── data/
│   ├── chunks.parquet
│   └── documents.parquet
├── documents/                   # 原文件、提取文本、页面和视频预览帧
├── chunks.jsonl                 # 本地处理的中间结果
├── documents.jsonl
└── parquet-validation.json
```

Dataset Card 随数据维护；新建资料集时按实际来源、许可和处理结果编写，工具不会自动生成来源声明。上述中间 JSONL、日志和缓存无需上传 Hugging Face。

`chunks` 中的图片和视频以 `datasets.Image` / `datasets.Video` 类型嵌入字节，计算云读取这些内容无需依赖本地绝对路径。视频预览帧只有相对路径；使用预览帧时还需上传对应素材。

```python
from datasets import Image, Video, load_dataset

chunks = load_dataset(
    "parquet", data_files="data/knowledge/data/chunks.parquet", split="train"
)
chunks = chunks.cast_column("image", Image(decode=False))
chunks = chunks.cast_column("video", Video(decode=False))
```

发布后可通过 `load_dataset("owner/dataset", name="chunks", revision="固定版本", split="train")` 加载。`train` 是集合名称，不表示它是模型训练数据。

文本和页面图片是不同视图。`default_embedding_candidate` 默认选择非隐藏页面、独立图片和完整视频；纯文本模型应按 `modality == "text"` 选择输入。视频是否参与取决于模型能力。文本切分目标为 2400 字符，不是 token 上限；长句可能超出目标，运行 embedding 前需按模型检查长度。

向量结果以 `chunk_id` 关联，另存 Parquet，并记录实际模型版本、向量维度、输入处理和归一化约定。资料仍需内容审核；格式验证不代表知识已审核。

## 测试

```sh
uv run --locked --project apps/knowledge-pipeline python -m unittest discover -s apps/knowledge-pipeline
```

## 计算云上运行千问 embedding

默认采用 [Qwen3-VL-Embedding-2B](https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B) 的多模态模型，以 [Sentence Transformers](https://sbert.net/docs/input_formats.html) 在自有 GPU 上离线推理。模型文件从 Hugging Face 下载，推理不调用托管模型 API，也无需启动 HTTP 服务。

所有设置位于 [`embedding.toml`](embedding.toml)：模型固定到 Hugging Face commit，输出 2048 维 L2 归一化向量，默认使用单张 NVIDIA GPU、bfloat16、SDPA、batch size 1。依赖锁定在 `uv.lock`，embedding 依赖是可选项，普通数据预处理无需安装 PyTorch。

先准备 Linux NVIDIA GPU 实例及兼容的驱动、`uv`、当前仓库代码与数据。锁定的 PyTorch 2.8.0 Linux wheel 使用 CUDA 12.8；CUDA 运行库由 Python 依赖安装，宿主机仍需要兼容的 NVIDIA 驱动。不要求另外编译 Flash Attention。显存需求尚未实测，应先试跑并观察实际占用，再调整批量大小。

仅做输入检查时，不下载模型，也不需要 GPU：

```sh
uv run --locked --project apps/knowledge-pipeline python apps/knowledge-pipeline/embed.py check
```

在计算云上，从仓库根目录执行：

```sh
# 自动安装锁定的 embedding 依赖，检查 GPU 与 bfloat16 支持。
bash apps/knowledge-pipeline/cloud.sh doctor

# 下载固定版本模型，缓存到 data/models/。
bash apps/knowledge-pipeline/cloud.sh download-model

# 先试跑三个候选，使用独立输出目录。
bash apps/knowledge-pipeline/cloud.sh run --limit 3 --output-dir data/embeddings/smoke

# 全量处理；重复此命令可恢复中断的任务。
bash apps/knowledge-pipeline/cloud.sh run
```

`cloud.sh` 可从任意目录调用，配置中的相对路径按仓库根目录解析。`--data-dir`、`--output-dir` 覆盖目录时，相对路径按调用者当前目录解析。用 `--config /path/to/config.toml` 指定另一份配置。

实际输入只读取 `data/chunks.parquet` 中的文本或内嵌媒体字节；计算云无需 Office、原文件副本或视频预览帧。建议同时上传 Dataset Card、manifest 和两个 Parquet，保留来源信息。Hugging Face 发布的数据下载后保持相同目录结构即可运行。

默认 `view = "visual"` 使用 `default_embedding_candidate`，视频从内嵌 MP4 均匀采样最多 16 帧，保留时间元数据，每个视频生成一个向量，不处理音频。不会把文本和页面图片重复作为两个必选输入。如果需要纯文本路线，设置 `view = "text"` 并使用新的输出目录。

图片和视频像素预算、视频采样帧数、输入 token 上限均在配置中显式记录。输入超过 token 上限时停止并报错，不静默截断。正式执行前应抽查页面可读性和检索效果；降低像素预算、输出维度或换用 8B 模型都会改变结果，应另建输出目录。切换模型时同时修改 `model_id` 和该模型的固定 `model_revision`；维度不能超过模型的原始维度。

默认输出位置：

```text
data/embeddings/qwen3-vl-2b/
├── run.json          # 模型、数据指纹、预处理、依赖锁指纹和完成状态
└── part-*.parquet    # chunk_id、document_id、modality、embedding
```

每批成功后原子保存一个 Parquet 分片，重启时跳过已经完成的块。中断留下的 `.tmp` 文件不会被当作完成结果。输出目录只允许一个任务同时使用；恢复时允许调整批量大小和设备，模型、输入数据、指令、精度、预处理或代码版本不一致则拒绝混用。`run.json` 中 `status = "complete"` 表示选定输入全部完成。少量试跑与全量任务使用不同目录。

读取输出：

```python
from datasets import load_dataset

vectors = load_dataset(
    "parquet", data_files="data/embeddings/qwen3-vl-2b/part-*.parquet", split="train"
)
```

分片名称不表示文档顺序；始终用 `chunk_id` 与原数据关联。查询向量应使用同一模型版本、指令、维度和归一化约定。本配置保留完整 2048 维向量，后续 pgvector 入库时需确认列类型和索引的维度限制。

本地测试通过可控的推理边界验证断点续跑和向量保存，不替代云端真实模型试跑。本任务没有改变教学能力或用户档案的用途，onboarding 提示词无需修改。
