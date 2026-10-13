# 演示视频工程

知芽的演示视频工程使用 Remotion 制作教师版和学生版视频，结合原生客户端页面回放、配音、字幕和操作时间线展示产品使用流程。

教师版展示备课、资料解析、课件制作、班级分享与导出；学生版展示对话学习、互动课件、练习、学习笔记与分享。工程和两版成片可从 GitHub Release 下载。

## 下载

工程于 2026 年 10 月 13 日整理，发布在 [知芽 v1.0.1 Release](https://github.com/LanternCX/zhiya/releases/tag/v1.0.1) 的附件中：

- [制作工程与最终成片 ZIP](https://github.com/LanternCX/zhiya/releases/download/v1.0.1/zhiya-video-production-backup-2026-10-13.zip)，约 326 MiB。
- [SHA-256 校验文件](https://github.com/LanternCX/zhiya/releases/download/v1.0.1/zhiya-video-production-backup-2026-10-13.zip.sha256)。

压缩包包含 Remotion 源码、制作与验证脚本、旁白和时间线、回放采样数据、配音、录制与图文素材，以及教师版和学生版最终成片。运行依赖需自行安装，调用语音服务时需自行配置凭据。

## 校验与运行

将 ZIP 和校验文件下载到同一目录。在 macOS 或 Linux 上执行：

```sh
shasum -a 256 -c zhiya-video-production-backup-2026-10-13.zip.sha256
unzip -tq zhiya-video-production-backup-2026-10-13.zip
```

出现 `OK` 且压缩包检查无错误后即可解压。Windows 可用 PowerShell 的 `Get-FileHash -Algorithm SHA256` 计算 ZIP 摘要，与校验文件中的值比较。

工程回放依赖产品客户端源码。它对应的产品版本是 [112766b](https://github.com/LanternCX/zhiya/commit/112766b1320c182a574e2c99d8b8a54c62bf9036)，与承载附件的 Release 版本不同。先下载并解压[该版本源码快照](https://github.com/LanternCX/zhiya/archive/112766b1320c182a574e2c99d8b8a54c62bf9036.zip)，再将视频工程解压到这个源码目录的根部；工程路径为 `docs/video/`。

查看成片可直接打开 `docs/video/out/` 中的教师版和学生版 MP4。继续制作需要 Node.js 22.19 或更高版本，在解压后的产品源码根目录执行：

```sh
npm ci
cd docs/video
npm ci
npm run check
npm run build:replay
npm run dev
```

Remotion Studio 地址为 <http://localhost:3100>。完整的预览、渲染、配音和重新采样说明见压缩包内的 `docs/video/README.md`；需要调用语音服务时自行配置凭据。

## 演示范围

视频混合使用实际模型与接口采样、人工编写的学生档案和对话、合成语音及编排后的操作时点。它用于展示产品交互，不作为实时延迟、生产知识库召回或模型效果评测证据。具体素材来源和限制见工程 README。

工程已通过视频类型检查、回放构建、教师与学生回放行为检查及两版全部场景截帧检查。两版成片使用已导出的文件。后续产品页面变化可能需要重新适配回放。
