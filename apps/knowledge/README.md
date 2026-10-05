# 教学知识库数据管线

准备并验证 Hugging Face Datasets 可读取的教学资料集。代码维护在此目录；本地资料默认位于仓库根目录的 `data/knowledge/`，整个 `data/` 已被 Git 忽略。数据后续可以在 Hugging Face Dataset 仓库独立维护。

本工具处理平台预备的教学资料，支持预处理和自部署模型的离线 embedding，不改变学生上传材料的格式支持，也不负责学生长期记忆、数据库导入或在线检索。

每套向量产物记录模型、版本和维度。查询必须使用对应模型和配置生成向量；不同模型的检索结果需按排名融合或统一重排。

## 导入交接资料

`handoff_package.zip` 中的 `metadata/rag_documents_manifest.json` 用于选择资料，`data/` 提供原文件。导入按 SHA-256 复用已有文档和稳定 ID；Notebook 读取已有单元格和输出，不执行代码；教材 JSONL 保留记录 ID。隐藏缓存和配置路径排除，缺文件和提取错误写入报告。文档引用的本地图片保留为独立视觉输入，外部或无法解析的图片写入 `linked-image-report.json`，不会自动联网下载。

```sh
uv run --project apps/knowledge --with cairosvg python -m preparation.handoff --archive /path/to/handoff_package.zip --data-dir /path/to/knowledge
uv run --project apps/knowledge python -m preparation.prepare pages --data-dir /path/to/knowledge
uv run --project apps/knowledge python -m preparation.ready --data-dir /path/to/knowledge
uv run --project apps/knowledge python -m preparation.export_parquet --external-media --data-dir /path/to/knowledge
```

已有 Office 文档复用已校验的页面；新增 DOCX 提取正文、表格和内嵌图片。新加入的 PPTX 仍需按下方流程渲染并校验页码。图片选择为结构规则处理，不能代替内容审核。导出前检查导入报告和图片缺失报告；导入和导出均不调用模型 API。

SVG 转换使用 CairoSVG，需要系统 Cairo 库。路径失效时只接受同一来源中同名且唯一或内容一致的本地资源；未能对应的引用继续列入报告。

交接数据推荐 `--external-media`：Parquet 保存 `asset_path` 和 `asset_sha256`，媒体作为共享文件存放，避免逐块内嵌相同图片造成空间膨胀。Embedding 脚本直接读取相对路径并验证哈希；迁移时传输整个数据目录。默认导出仍支持内嵌媒体，供需要单独分发 Parquet 的场景使用。

## 目录结构

```text
apps/knowledge/
├── pyproject.toml
├── uv.lock
├── README.md
├── configs/                  # 模型及处理参数
├── src/
│   ├── preparation/          # 数据准备、导出与校验
│   └── embedding/            # 离线向量生成
├── scripts/                  # 计算云启动脚本
└── tests/                    # 行为与回归测试
```

`uv` 将 `src/` 下的 Python 包安装到项目虚拟环境；命令通过 `python -m` 调用，不直接执行源码文件。默认数据路径与配置路径按项目位置确定，不依赖当前工作目录。

## 环境

从项目根目录运行。Python 3.12 和依赖由 `uv` 管理：

```sh
uv sync --locked --project apps/knowledge
```

Office 页面转换还需要 LibreOffice，视频处理需要 PATH 中的 `ffmpeg` 和 `ffprobe`。它们不是 Python 依赖。`--soffice` 可指定 LibreOffice 的可执行文件；省略时从 PATH 查找。字体安装和 LibreOffice 版本会影响排版，批量 embedding 前应抽查页面。

## 使用现有数据

```sh
uv run --locked --project apps/knowledge python -m preparation.validate
```

默认读取 `data/knowledge/`。所有命令支持 `--data-dir /absolute/path/to/dataset`，可以直接操作仓库外的数据目录。

## 从原始资料重新生成

输入与输出目录应分开。处理不会修改输入资料；输出目录属于本工具的工作目录，其中的派生文件会被更新。

```sh
uv run --locked --project apps/knowledge python -m preparation.prepare prepare --source-dir /absolute/path/to/extracted
uv run --locked --project apps/knowledge python -m preparation.prepare render --soffice /absolute/path/to/soffice
uv run --locked --project apps/knowledge python -m preparation.prepare repair-slides --soffice /absolute/path/to/soffice
uv run --locked --project apps/knowledge python -m preparation.prepare pages
uv run --locked --project apps/knowledge python -m preparation.prepare consolidate
uv run --locked --project apps/knowledge python -m preparation.export_parquet
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

数据集默认采用文本优先的两路处理。`embedding_route = "text"` 选择可提取的正文、段落和表格；`visual` 选择独立图片及缺少提取文本的页面。纯文字页面不重复作为图片输入；隐藏幻灯片及其文本默认跳过。原文件、页面图片和所有 block 仍保留，稳定标识不变。

包含较大图片或复杂图形且已有文本的页面标为 `review`，避免将背景、装饰图片自动送到 VL 模型；视频也默认待选择。PDF 对象分析只是一项启发式检查，不能证明文本已完整表达图表、阅读顺序或布局含义。没有可靠布局信息的页面同样待检查。DOCX 文本按标题组织，不伪造渲染页面与段落的对应关系。

`report.json` 列出两路候选数量、选择原因、文本字符数及 `visual_review_chunk_ids`。检查待选内容后，用 JSON 对象指定 block 的 `text`、`visual` 或 `none` 路由，例如 `{"document-page-0002":"visual","document-page-0003":"none"}`：

```sh
uv run --locked --project apps/knowledge python -m preparation.prepare consolidate \
  --data-dir /path/to/knowledge --embedding-overrides /path/to/selection.json
uv run --locked --project apps/knowledge python -m preparation.export_parquet \
  --data-dir /path/to/knowledge
```

不传覆盖文件时使用自动规则。`review` 不进入任何 embedding 任务，因此未检查的资料集不能宣称内容覆盖完整。先检查报告和抽样来源，再运行模型。文本切分目标为 2400 字符，不是 token 上限；长句可能超出目标，运行 embedding 前需按模型检查长度。字符统计不是 API token 计费估算。

准备可直接在计算云运行的版本时，`ready` 使用 PPT 原文件中的实际图片、图表及连接结构排除背景和装饰，补回遗漏的标题文本；DOCX/PDF 使用提取文本和页面对象结构选择必要的视觉输入。隐藏页仍跳过，两个短视频保留。完全相同的输入只选择一个代表块，其余记录通过 `embedding_duplicate_of` 复用代表块向量，所有来源标识仍保留。该选择过程不代表逐页人工语义审核。

```sh
uv run --locked --project apps/knowledge python -m preparation.ready --data-dir /path/to/knowledge
uv run --locked --project apps/knowledge python -m preparation.export_parquet --data-dir /path/to/knowledge
uv run --locked --project apps/knowledge python -m preparation.bundle \
  --data-dir /path/to/knowledge --output-dir /path/to/upload-ready
```

上传完整 `upload-ready` 目录后，执行 `bash run-embeddings.sh check` 检查两路输入，再执行 `bash run-embeddings.sh run`。上传包包含完整数据字节、模型配置、代码和 `uv.lock`，不依赖主仓库、Office、源资料目录或 API Key。两路顺序运行，输出独立保存并支持恢复中断。真正运行前仍需要云端检查显存及样本检索效果。

向量结果以 `chunk_id` 关联，另存 Parquet，并记录实际模型版本、向量维度、输入处理和归一化约定。资料仍需内容审核；格式验证不代表知识已审核。

## 测试

```sh
uv run --locked --project apps/knowledge python -m unittest discover -s apps/knowledge/tests
```

## 计算云上运行千问 embedding

视觉候选采用 [Qwen3-VL-Embedding-8B](https://huggingface.co/Qwen/Qwen3-VL-Embedding-8B)，文本候选可以使用独立的 [Qwen3-Embedding](https://github.com/QwenLM/Qwen3-Embedding) 纯文本模型，以 [Sentence Transformers](https://sbert.net/docs/input_formats.html) 在自有 GPU 上离线推理。模型文件从 Hugging Face 下载，推理不调用托管模型 API，也无需启动 HTTP 服务。

视觉配置位于 [`configs/embedding.toml`](configs/embedding.toml)，使用 Qwen3-VL-Embedding-8B。文本配置 [`configs/embedding-text.toml`](configs/embedding-text.toml) 使用 Qwen3-Embedding-8B。两路均保留原生 4096 维，分别记录 Hugging Face commit，输出 L2 归一化向量，默认使用单张 NVIDIA GPU、bfloat16、SDPA、batch size 1。依赖锁定在 `uv.lock`，embedding 依赖是可选项，普通数据预处理无需安装 PyTorch。

先准备 Linux NVIDIA GPU 实例及兼容的驱动、`uv`、当前仓库代码与数据。锁定的 PyTorch 2.8.0 Linux wheel 使用 CUDA 12.8；CUDA 运行库由 Python 依赖安装，宿主机仍需要兼容的 NVIDIA 驱动。不要求另外编译 Flash Attention。视觉配置已在 24 GB 显存的 RTX 4090 上完成图片和视频推理；其他设备或数据集仍应先试跑并观察实际占用，再调整批量大小。

仅做输入检查时，不下载模型，也不需要 GPU：

```sh
uv run --locked --project apps/knowledge python -m embedding.embed check
```

在计算云上，从仓库根目录执行：

```sh
# 自动安装锁定的 embedding 依赖，检查 GPU 与 bfloat16 支持。
bash apps/knowledge/scripts/cloud.sh doctor

# 下载固定版本模型，缓存到 data/models/。
bash apps/knowledge/scripts/cloud.sh download-model

# 先试跑三个候选，使用独立输出目录。
bash apps/knowledge/scripts/cloud.sh run --limit 3 --output-dir data/embeddings/smoke

# 全量处理；重复此命令可恢复中断的任务。
bash apps/knowledge/scripts/cloud.sh run
```

`cloud.sh` 可从任意目录调用，配置中的相对路径按仓库根目录解析。`--data-dir`、`--output-dir` 覆盖目录时，相对路径按调用者当前目录解析。用 `--config /path/to/config.toml` 指定另一份配置。

实际输入读取 `data/chunks.parquet` 中的文本、内嵌媒体字节或 `asset_path` 指向的媒体文件；计算云无需 Office。使用 `--external-media` 导出的数据集必须同时传输对应媒体，并保持相对目录结构。建议同时上传 Dataset Card、manifest 和两个 Parquet，保留来源信息。

`view = "visual"` 只读取已选中的图片和视频，`view = "text"` 只读取已选中的文本，两个任务分别运行并保存到不同目录：

```sh
bash apps/knowledge/scripts/cloud.sh check --config apps/knowledge/configs/embedding-text.toml
bash apps/knowledge/scripts/cloud.sh run --config apps/knowledge/configs/embedding-text.toml
bash apps/knowledge/scripts/cloud.sh check --config apps/knowledge/configs/embedding.toml
bash apps/knowledge/scripts/cloud.sh run --config apps/knowledge/configs/embedding.toml
```

运行前必须重新 `consolidate` 和导出文本优先的 Parquet，旧视觉清单会被拒绝。文本资料不添加查询指令；线上查询需要核对同一个模型版本、维度、归一化、查询指令及 token 处理约定，并先做小样本一致性与检索验证。本工具只提供离线推理，硅基流动 API 接入和线上查询路由需要另行实现。同名模型本身不是跨部署结果一致性的证明。

文本和视觉使用不同模型时，应维护独立向量索引，用各自模型生成查询向量，分别检索后合并排名并按来源去重；不能直接比较跨模型向量或原始相似度。当前服务端的单模型索引需要另行调整后才能接入这两路结果。视频被明确选中后才从内嵌 MP4 均匀采样最多 16 帧，保留时间元数据，每个视频生成一个向量，不处理音频。

图片和视频像素预算、视频采样帧数、输入 token 上限均在配置中显式记录。输入超过 token 上限时停止并报错，不静默截断。正式执行前应抽查页面可读性和检索效果；降低像素预算、输出维度或换用 8B 模型都会改变结果，应另建输出目录。切换模型时同时修改 `model_id` 和该模型的固定 `model_revision`；维度不能超过模型的原始维度。

默认输出位置：

```text
data/embeddings/qwen3-vl-8b-visual/
├── run.json          # 模型、数据指纹、预处理、依赖锁指纹和完成状态
└── part-*.parquet    # chunk_id、document_id、modality、embedding
```

每批成功后原子保存一个 Parquet 分片，重启时跳过已经完成的块。中断留下的 `.tmp` 文件不会被当作完成结果。输出目录只允许一个任务同时使用；恢复时允许调整批量大小和设备，模型、输入数据、指令、精度、预处理或代码版本不一致则拒绝混用。`run.json` 中 `status = "complete"` 表示选定输入全部完成。少量试跑与全量任务使用不同目录。

读取输出：

```python
from datasets import load_dataset

vectors = load_dataset(
    "parquet", data_files="data/embeddings/qwen3-vl-8b-visual/part-*.parquet", split="train"
)
```

分片名称不表示文档顺序；始终用 `chunk_id` 与原数据关联。查询向量应使用同一模型版本、维度和归一化约定，并遵循该模型的查询指令约定。视觉配置保留完整 4096 维向量，后续 pgvector 入库时需确认列类型和索引的维度限制。

本地测试通过可控的推理边界验证输入选择、断点续跑和向量保存，不替代云端真实模型试跑。

## 独立计算工作空间

代码、Python 环境、模型和数据分别存放，不把某份数据集固定进运行环境：

```text
zhiya-embedding/
├── code/apps/knowledge/   # 本目录的代码、配置及 uv.lock
├── bin/                   # 持久保存的 uv 启动工具
├── python/                # 持久保存的托管 Python
├── env/                   # 两路模型共享的推理依赖
├── models/                # 固定模型版本缓存
├── datasets/<数据集名>/   # 后续独立上传的数据集
└── results/<数据集名>/    # 每份数据集的独立结果目录
```

在该布局下运行 `scripts/workspace.sh`，每次明确指定数据集和结果目录；脚本自动复用持久 Python、环境和模型缓存：

```sh
bash code/apps/knowledge/scripts/workspace.sh text check --data-dir "$PWD/datasets/example"
bash code/apps/knowledge/scripts/workspace.sh text run \
  --data-dir "$PWD/datasets/example" --output-dir "$PWD/results/example/text"
bash code/apps/knowledge/scripts/workspace.sh visual run \
  --data-dir "$PWD/datasets/example" --output-dir "$PWD/results/example/visual"
```

`--model-cache` 也可以直接传给 `python -m embedding.embed`，与 `--data-dir`、`--output-dir` 独立。只下载权重时，`scripts/download-models.py --model-cache /path/to/models` 不读取数据集、不加载模型。迁移机器时保留整个工作目录及相同路径；当前 bfloat16 配置要求 GPU 支持该精度，准备环境不等于已经验证完整模型推理。
