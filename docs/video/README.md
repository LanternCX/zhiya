# 知芽视频工程

本目录保存教师版和学生版演示视频的 Remotion 源码、原生页面回放和制作素材。它是独立 npm 包，不属于产品应用 workspace。普通预览与渲染使用已保存的采样数据、Mock 适配器和配音，无需实时后端。

## 安装与运行

需要 Node.js 22.19 或更高版本。先安装主仓库依赖，再安装本目录的独立依赖。以下命令从主仓库根目录执行：

```sh
npm ci
cd docs/video
npm ci
npm run check
npm run build:replay
npm run dev
```

Remotion Studio 地址为 <http://localhost:3100>。主要 Composition 是教师版 `TeacherFilm` 和学生版 `StudentFilm`，均为 1920 × 1080、30 fps。后文所有命令均在 `docs/video` 执行。修改客户端、回放适配器或采样数据后，应重新构建回放网页。

## 目录与产物

| 路径 | 用途 |
| --- | --- |
| `src/student/` | 学生版画面、旁白、语音问答与时间线 |
| `src/real/` | 教师版画面、旁白、时间线与回放嵌入 |
| `src/full/`、`src/demo/` | 概念版与样片 |
| `replay/` | 回放入口、适配器、采样与 Mock 数据 |
| `replay/public/` | Word、图片和知识库示例资料 |
| `public/` | 配音、背景音与录制片段 |
| `scripts/` | 配音生成、数据采样与行为检查 |
| `public/replay/` | 自动生成的回放网页，Git 忽略 |
| `out/` | 成片、检查截图与其他输出，Git 忽略 |

本地保留的最终成片为 `out/zhiya-teacher-final-2026-10-09.mp4` 和 `out/zhiya-student-final-2026-10-09.mp4`，不随 Git 分发。重新渲染可执行：

```sh
npm run render:full
npm run render:student
```

输出分别为 `out/zhiya-teacher-introduction.mp4` 和 `out/zhiya-student-introduction.mp4`。这些命令使用缓存配音，不调用语音合成服务。浏览器检查与渲染首次运行时，Remotion 会下载适合当前平台的 Chrome Headless Shell。

## 学生版审阅

Remotion 的 `StudentFilm` 是独立学生版，配音与时间线分别位于 `public/voice-student` 和 `src/student`。使用同一个原生 React 回放页面，查询参数 `audience=student` 选择学生身份、建档内容、对话与学习笔记。老师版仍为 `TeacherFilm`。

学生版展示建档、学段表达对比、连续语音对话、课程小节、文档与图片解析、知识库引用、课件生成与修改、分步动画、插图、代码报错与修正、选择题反馈、学习笔记、加入班级、教师分享阅读、学生分享、Word/PPT 导出入口。没有使用录屏；视频生成、B站播放、完整多页绘本与独立游戏关卡没有加入，不以单张插图或选择题冒充这些功能。

`replay/student-data.ts` 和 `replay/student-content.ts` 中的学生对话、档案、学段对比和学习笔记是人工编写的 Mock 数据；课堂图示、插图和基本练习沿用老师版的实际生成素材。长回复按场景进度持续生成，笔记包含分步实验、排错与复习。代码错误与成功状态用于驱动原生编程组件，不代表本次调用了后端执行器。

语音段使用原生语音对话入口，按时间线回放两轮提问、停顿自动分段、语音回答和追问；这段旁白结束后由问答音频接替。问答文本在 `src/student/dialogue.json`，豆包合成音频由 Remotion 播放，识别与回复状态用 Mock 驱动，不在渲染时连接麦克风、语音服务或模型。此回放展示已有交互，不代表端到端实时语音延迟测量。`node scripts/check-student-content.mjs` 检查长内容持续生成、语音对话不重挂载、两轮记录保留以及不连接外部服务。

知识库段使用 `replay/public/student-reference.md` 的自编基础资料以及 Mock 检索结果，演示现有 `KnowledgeSearchProgress` 和 `KnowledgeCitation` 组件，包括搜索进度、结果、引用段落与原文件入口。此段是前端功能演示，不是生产知识库召回、模型依据引用或嵌入服务的成功验证。跨学段和反馈后的讲法调整也属于代表性回放，尚未用学生账号完成本轮真实模型效果验证。提交比赛前应据实际联调结果确认这些效果，不把 Mock 回放当作模型评测证据。

生成或更新配音：`uv run scripts/produce-student.py`。连续原生页面检查：`node scripts/check-student.mjs`。学生内容检查：`node scripts/check-student-content.mjs`。运行这两项浏览器检查前，须在另一个终端启动 `npm run dev:replay`（端口 3102）。Remotion 帧检查：`node scripts/check-student-film.mjs`。视频工程不改变产品功能、学习档案和学生建档提示词。

## 老师版审阅

TeacherFilm 为约 4 分 45 秒审阅版：浅色 MG 讲解、原生 React 页面数据回放与实际 Office 导出文件展示。

演示顺序：开场、建档、备课任务、语音输入、材料解析、生成、修改、分步动画、代码练习、选择题、插图、教案、创建班级与邀请、班级分享、学生阅读、导出。网页使用 React 数据回放；Office 展示使用用户提供的真实录制。ArchivedRecordedFilm 保留十分钟录屏版，ArchivedConcept 为早期概念版。

导出段使用用户提供的 `2026-10-09 09-57-25.mp4`（Word）和 `2026-10-09 09-56-31.mp4`（PowerPoint）。Word 保留前 11 秒并放缓到 14 秒，去掉末尾空白；PowerPoint 完整调整到 15 秒。成片素材位于 `public/office/user-word.mp4` 和 `public/office/user-ppt.mp4`，静音播放，配音分别对应浏览内容，不宣称录制展示了编辑操作。本目录保留处理后的素材，原始录制由提供者管理。

材料展示为连续的 28 秒镜头：4 秒选择附件与发送，6 秒依次展示 Word 和图片的上传、解析，再保留约 10 秒逐步生成回复，最后查看引用。`replay/material-playback.json` 单独配置演示事件时间，不修改 `material-timing.json` 中的实际采样耗时；视频中的等待经过压缩，不代表服务响应速度。回放课程目录合并全部采样对话，连续导航时不会因采样目录不完整而显示对话不存在。

班级与分享通过 scripts/capture-class-sharing.py 在本地演示服务实际验证：老师创建班级、学生凭邀请码加入、保存班级分享、学生列出并读取材料。replay/class-sharing.json 保存接口结果；replay/class-data.ts 将成员列表补成 25 人，其中 23 名学生为展示用 Mock 数据。产品源码和建档提示词没有修改，视频展示没有改变学生建档或教学能力。

## 原生页面回放

`replay/vite.config.mjs` 直接引用主仓库 `apps/client/src` 的原页面、组件与样式，只替换 API、会话状态与计时入口。构建产物放在 `public/replay`，通过 iframe 嵌入 Remotion。

replay/fixtures.json 来自本地演示账号的真实模型回复、课件、建档问题、档案、练习结果与教案。课件初版取自实际模型工具调用记录。演示动作与展开速度按视频节奏编排，不代表模型实际响应延迟。初次建档问题与已完成档案为两个实际演示账号的采样。账号密码和 API 密钥不进入回放包。

SourceReplay 在实时预览中传递最新目标时间，不逐帧阻塞播放；积压的请求只保留最新一个。停止播放或拖动 150 毫秒后，自动等待排版并精确对齐。正式渲染始终等待页面排版完成后才允许截帧。光标、滚动、计时和动画状态由时间控制。

TeacherFilm 的网页镜头共用一个持续挂载的 iframe。分享和班级操作向前播放时只执行新增点击，保留页面与弹窗；倒拖需要重建动作状态时才复位，老师与学生身份切换时重新初始化账户。原页面的过渡动画在预览中正常播放，逐帧渲染按动作开始时间定位；摄像机测量与变换在同一次同步更新中完成。`node scripts/check-click-continuity.mjs` 检查连续点击、跨场景导航和倒拖恢复（需要本地回放服务 3102）。

```sh
npm run build:replay
npm run check
npm run check:replay
npm run dev
```

独立调试与反向跳帧检查：

```sh
npm run dev:replay
```

服务启动后，在另一个终端执行：

```sh
node scripts/check-click-continuity.mjs
node scripts/check-replay-seek.mjs
node scripts/check-class-sharing.mjs
```

调试地址：http://127.0.0.1:3102。审阅帧位于 out/replay-qa。

## 配音与成片

生成配音需要 uv、FFmpeg 和语音服务凭据。教师旁白在 `src/real/compact.json`，缓存为 `public/voice-compact`；开场复用缓存配音。豆包语音合成 2.0 读取忽略的 `.env.local` 中的 `VOLCENGINE_TTS_API_KEY` 和 `VOLCENGINE_TTS_VOICE`，请自行配置，不提交密钥：

```sh
uv run scripts/produce-compact.py
```

其他 `produce-*` 脚本用于录屏版、概念版与样片。`narrate.py` 为 Qwen 样片配音，从主仓库 `apps/server/config.yaml` 与本地配置读取语音服务设置。

语音输入使用原生 ChatComposer 的麦克风、听写状态与可编辑输入框，由回放适配器注入实际 ASR 转写事件；识别音源是合成的教学需求样本，编辑与发送时点由视频编排。附件使用原生上传控件加载实际 Word 和图片，资料解析、引用及组合建议来自实际模型调用，保留 partial 解析提示。教师采样中的知识检索因查询 Embedding Key 缺失失败，未纳入成功演示。Web 分享按实际能力展示阅读与翻页，不宣称保留课堂全部动画按钮交互。

## 重新采集演示数据

`capture-*` 与 `register-demo.py` 用于重新采集本地服务数据，会创建账号、课程或分享，部分操作会调用模型。普通预览和渲染无需运行它们。重新采样需要本地 API（端口 8080）、注册邮件服务（端口 8025）、演示账号及各脚本所需的输出文件。账号凭据放在忽略的 `out/` 中；`capture-evidence.py` 还需要 `out/verified-teacher-plan.docx`，可从已验证的实际导出取得。采样结果保存在 `replay/`，提交前须检查内容与来源说明。
