# 知芽教学知识库

知芽在回答学习问题、组织教学内容时，会查阅知识库中的教材和教学资料，并在对话中给出来源引用。本目录提供知识库的下载、导入和数据准备工具。

完整资料及已生成的文本、视觉检索向量发布在 [Hugging Face：LanternCX/zhiya-knowledge](https://huggingface.co/datasets/LanternCX/zhiya-knowledge)。部署知芽时可以直接导入，不需要租 GPU 或重新跑 Embedding。

## 接入知识库

在知芽仓库根目录操作：

1. 按[本地开发指南](../../docs/development.md)准备项目环境，另外安装 `hf` 和 `uv`。
2. 启动项目已有的 PostgreSQL 和 RustFS。知识库使用其中独立的数据库和桶，无需另开服务。
3. 按[知识库配置说明](../../docs/development.md#教学知识库资料处理)配置存储连接和查询模型的 API Key。
4. 执行导入命令：

```sh
bash scripts/import-knowledge.sh
```

**脚本会下载约 12 GB 数据，并写入知识库数据库和对象存储桶。** 它会先显示保存目录和实际写入目标，输入 `IMPORT` 确认后才开始。请预留下载和缓存所需的磁盘空间。Agent 执行时也应先获得你的批准，再传入 `--yes`。

导入完成后，启动知芽服务，即可在教学对话中检索这些资料。查询需要使用与资料向量对应的模型；当前文本使用 Qwen3-Embedding-8B，视觉使用 Qwen3-VL-Embedding-8B。

## 已经下载了数据？

传入包含 `manifest.json`、`knowledge/` 和 `embeddings/` 的完整数据目录，跳过下载：

```sh
bash scripts/import-knowledge.sh --data-dir /path/to/data --skip-download
```

下载或导入中断后，可以重新执行原命令继续。需要固定数据版本时，添加 `--revision <Hugging-Face-commit>`。

## 只下载资料

```sh
hf download LanternCX/zhiya-knowledge --type dataset --local-dir data
```

数据集包含原始资料、图片和视频，请保留完整目录。资料来源和许可见 [Hugging Face 数据集首页](https://huggingface.co/datasets/LanternCX/zhiya-knowledge)及各原始文件。
