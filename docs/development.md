# 知芽开发指南

本文介绍本地启动、配置和验证知芽所需的信息。产品目标与功能范围以[产品需求 Issue #3](https://github.com/LanternCX/zhiya/issues/3)为准，已确认的技术选择见[技术选型 Issue #2](https://github.com/LanternCX/zhiya/issues/2)。

## 环境要求

- Node.js 22.19 或更高版本
- npm
- Go 1.26 或更高版本
- Docker
- Rust 与对应系统的 [Tauri 开发环境](https://v2.tauri.app/start/prerequisites/)，仅桌面端开发需要

在仓库根目录安装依赖：

```sh
npm install
```

## 启动本地环境

先启动 PostgreSQL 与 Mailpit：

```sh
npm run dev:services
```

再使用两个终端分别启动服务端和客户端：

```sh
npm run dev:server
npm run dev
```

| 服务 | 地址 |
| --- | --- |
| 浏览器客户端 | <http://127.0.0.1:1420> |
| 服务端健康检查 | <http://127.0.0.1:8080/health> |
| Mailpit 测试收件箱 | <http://127.0.0.1:8025> |

Mailpit 不会向真实邮箱发送邮件，可使用任意测试邮箱完成本地注册、密码找回和邮箱更换流程。运行 `npm run stop:services` 可以停止 Docker 服务并保留开发数据。

如需启动 Tauri 桌面窗口，使用下面的命令代替 `npm run dev`：

```sh
npm run dev:desktop
```

## 连接模型

主 Agent 与子 Agent 在服务端的 TypeScript 进程中运行，模型请求通过 Go 内部 API 转发。客户端只发送操作并订阅状态；关闭页面、退出客户端或退出登录不会终止已开始的执行，主动停止仍会取消执行。模型凭据只配置在 Go 服务端。

`npm run dev:server` 同时启动 Go 与 Pi 服务，并为本次开发进程生成共享认证密钥。默认的 Go 内部 API 监听 `127.0.0.1:8081`，Pi 监听 `127.0.0.1:8082`。内部端口不要作为客户端 API 暴露。

独立部署时，分别执行 `npm run build:server` 与 `npm run build:agent`，再运行 Go 二进制和 `node apps/agent/dist/server.mjs`。Go 的 `agent.secret`（或 `ZHIYA_SERVER_AGENT_SECRET`）与 Pi 的 `ZHIYA_AGENT_SECRET` 必须一致；Pi 使用 `ZHIYA_AGENT_API` 指定 Go 内部 API 地址，使用 `ZHIYA_AGENT_LISTEN` 指定监听地址。Go 的 `agent.endpoint` 指向 Pi，`agent.internal_listen` 指定工具 API 监听地址。生产密钥至少 32 个字符。

当前运行一个 Pi 服务进程，Go 实例共同向它下发指令。Pi 按会话实例化 Agent，同一会话的并发请求复用同一实例；执行和工具调用不依赖客户端连接。Pi 使用原生 `JsonlSessionRepo` 在每个用户的独立工作空间保存完整消息和工具记录；PostgreSQL 保存课程、权限、前端展示状态，以及建档问答和档案修改的事务状态。空闲实例会回收，再次实例化时读取 Pi 会话；服务进程故障后的自动续跑不在本功能范围内。

通过 `ZHIYA_AGENT_WORKSPACES` 指定工作空间根目录，默认是 Pi 进程工作目录下的 `.workspaces`。部署时应配置固定的绝对路径并挂载持久化磁盘，同时备份 Pi 会话与 PostgreSQL。

Agent 开发集中在 `apps/agent/src/pi`：`agent/` 定义各 Agent，`tools/` 定义工具，`sessions/` 保留教学与建档编排，`session.ts` 接入 Pi 原生会话。HTTP 入口在 `server.ts`，实例生命周期和状态同步在 `runtime/`，Go API 适配在 `adapters/`。`packages/learning` 只提供共享数据类型和展示转换。

当前使用 OpenAI-compatible Chat Completions 流式接口。可以在 [`apps/server/config.yaml`](../apps/server/config.yaml) 中配置，也可以使用环境变量覆盖：

| 配置 | 环境变量 | 说明 |
| --- | --- | --- |
| `model.endpoint` | `ZHIYA_SERVER_MODEL_ENDPOINT` | 包含 `/v1/chat/completions` 的完整接口地址 |
| `model.id` | `ZHIYA_SERVER_MODEL_ID` | 服务支持的模型 ID |
| `model.api_key` | `ZHIYA_SERVER_MODEL_API_KEY` | 服务端模型凭据 |

未配置模型时，账号服务仍可使用，学习页面会提示暂时无法交流。自动化测试使用模拟模型响应，不消耗真实模型额度，也不能代表真实模型的教学质量。

## 语音模式

实时语音和可编辑听写都由服务端代理语音供应商。ASR 和 TTS 使用独立凭据，浏览器不会接触任何供应商 API Key。可以在服务端本地配置中填写，或使用环境变量覆盖：

| 配置 | 环境变量 | 用途 |
| --- | --- | --- |
| `speech.endpoint` | `ZHIYA_SERVER_SPEECH_ENDPOINT` | DashScope WebSocket 地址 |
| `speech.asr_api_key` | `ZHIYA_SERVER_SPEECH_ASR_API_KEY` | 语音识别凭据 |
| `speech.tts_api_key` | `ZHIYA_SERVER_SPEECH_TTS_API_KEY` | 语音合成凭据 |
| `speech.asr_model` | `ZHIYA_SERVER_SPEECH_ASR_MODEL` | ASR 模型 ID |
| `speech.tts_model` | `ZHIYA_SERVER_SPEECH_TTS_MODEL` | TTS 模型 ID |
| `speech.tts_voice` | `ZHIYA_SERVER_SPEECH_TTS_VOICE` | TTS 音色 |

麦克风按钮用于可编辑听写：停止听写后，文字留在输入框，编辑后手动发送。语音对话入口开启持续监听、停顿断句后自动发送和回答播报，并隐藏键盘输入区；播报期间继续监听，新的一句话结束后打断当前回答。打断按钮和 Esc 停止回答，保留监听。退出语音对话恢复草稿和普通输入，不发送已有草稿。

用户菜单中的「语音播报」设置保存在当前浏览器，开启后普通文字或听写发送的课堂对话也会播报回答。语音对话始终播报，退出后恢复这个设置。听写需要麦克风权限。开发环境的 `localhost` 和 `127.0.0.1` 属于浏览器允许的安全上下文；部署到其他域名时应使用 HTTPS。拒绝麦克风权限不会影响文字聊天。识别断开时可重试麦克风或退出；播报失败时退出语音对话，保留文字聊天。

## 配置

客户端公开配置位于 [`apps/client/config.json`](../apps/client/config.json)：

| 字段 | 用途 |
| --- | --- |
| `api_origin` | 桌面端 API 地址和 Vite 开发代理目标 |
| `request_timeout_seconds` | 浏览器和桌面请求超时 |
| `dev_origin` | Vite 监听地址、Tauri 开发窗口和浏览器测试入口 |

本地覆盖可以写入已忽略的 `apps/client/config.local.json`，并通过 `ZHIYA_CLIENT_CONFIG` 选择。`ZHIYA_CLIENT_API_ORIGIN`、`ZHIYA_CLIENT_REQUEST_TIMEOUT_SECONDS` 和 `ZHIYA_CLIENT_DEV_ORIGIN` 的优先级高于配置文件。

服务端配置位于 [`apps/server/config.yaml`](../apps/server/config.yaml)。默认开发命令还会合并已忽略的 `apps/server/config.local.yaml`，环境变量最后覆盖合并结果。环境变量遵循 `ZHIYA_SERVER_<SECTION>_<KEY>` 格式，例如：

```sh
ZHIYA_SERVER_HTTP_LISTEN=127.0.0.1:18080 npm run dev:server
```

也可以使用 `ZHIYA_SERVER_CONFIG` 或 `-config` 选择仓库外的完整部署配置。显式指定配置文件时不会再合并默认和本地配置。服务端会拒绝未知字段和无效配置；修改后需要重启，不支持热重载。

### 服务端日志

Go 服务将结构化日志写入标准错误流。开发环境默认使用紧凑、按级别着色的文本格式；非交互输出会自动关闭颜色，也可以设置 `NO_COLOR` 强制关闭。由部署平台采集日志时可切换为逐行 JSON：

```yaml
logging:
  level: info
  format: json
```

`logging.level` 支持 `debug`、`info`、`warn` 和 `error`，`logging.format` 支持 `text` 和 `json`。也可以通过 `ZHIYA_SERVER_LOGGING_LEVEL` 与 `ZHIYA_SERVER_LOGGING_FORMAT` 覆盖。

每个 HTTP 响应都包含 `X-Request-ID`。客户端会在 `5xx` 服务端错误提示中显示该错误编号，并在开发者控制台记录不含请求正文的请求摘要，可用它关联请求完成日志和错误日志；可直接处理的 `4xx` 业务错误保持原有提示。WebSocket 操作同时记录连接请求 ID 与客户端操作 ID；模型流重试、最终中断、跨实例通知重连及后台资源清理失败也会单独记录。访问日志记录方法、路由模板、状态码与耗时，不记录查询参数、请求正文、Cookie、认证信息、教学内容或模型输出。日志采集、保存和轮转由运行环境负责。

Docker 基础设施配置由 [`dev-services.env`](../dev-services.env) 管理。若修改 PostgreSQL 或 Mailpit 的映射端口，需要同步调整服务端连接配置。

## 材料解析服务的启动与测试

`npm run dev:services` 会构建并启动 `material-parser`。在 `apps/server/config.local.yaml` 中设置 `vision_model.api_key`，或通过 `ZHIYA_SERVER_VISION_MODEL_API_KEY` 注入百炼北京地域凭证，然后重启 Go 服务。

独立部署时，构建 `apps/material-parser/Dockerfile` 并运行容器，将 Go 的 `material_parser.endpoint` 指向转换服务的 8090 端口。容器运行约束可参考 `compose.yaml` 中的 `material-parser` 服务；该端口只向 Go 服务开放。

完整转换测试（包括真实旧版 Office 转换）在容器中运行：

```sh
docker compose --env-file dev-services.env run --rm --no-deps material-parser uv run --no-sync python -m unittest -v
```

仅运行本机解析测试可使用 `uv run --directory apps/material-parser python -m unittest -v`，未安装 LibreOffice 时会跳过 Office 转换用例。Go 的材料行为测试包含在 `npm run test:accounts` 中。

运行 Go 上传接口到实际转换容器的集成测试（视觉供应商使用本地测试响应）：

```sh
ZHIYA_TEST_MATERIAL_PARSER=http://127.0.0.1:8090 npm run test:accounts -- -run TestImageUploadThroughConverterAndVisionBecomesReadable
```

已配置本地视觉凭证并启动转换服务后，可显式选择不含敏感信息的测试 PNG，验证真实千问调用。此命令会产生模型调用费用，并输出该测试图的识别文字和描述：

```sh
ZHIYA_TEST_VISION_IMAGE=/absolute/path/to/test.png go -C apps/server test ./internal/materialparse -run TestLiveVisionParsesSelectedImage -count=1 -v
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | TypeScript 类型检查 |
| `npm run test:agent` | 验证 Pi 后台执行、重复请求与主动停止 |
| `npm run check:client-config` | 校验客户端配置 |
| `npm run check:server-config` | 校验服务端配置，不连接数据库或发送邮件 |
| `npm test` | Go 行为测试和仓库规则测试 |
| `npm run test:accounts` | 使用 PostgreSQL 运行账号行为与并发测试 |
| `npm run test:e2e` | 使用本地数据库和 Mailpit 运行浏览器行为测试 |
| `npm run test:desktop` | 运行桌面请求行为测试 |
| `npm run build` | 构建浏览器客户端 |
| `npm run build:server` | 构建服务端到 `dist/server` |
| `npm run build:desktop` | 构建桌面可执行文件，不制作安装包 |

浏览器测试首次运行前需要安装 Chromium：

```sh
npx --workspace @zhiya/client playwright install chromium
```

端口被已有开发服务占用时，可以为端到端测试选择其他端口：

```sh
ZHIYA_CLIENT_API_ORIGIN=http://127.0.0.1:18080 \
ZHIYA_CLIENT_DEV_ORIGIN=http://127.0.0.1:11420 \
ZHIYA_SERVER_HTTP_LISTEN=127.0.0.1:18080 \
ZHIYA_SERVER_HTTP_ORIGIN=http://127.0.0.1:11420 npm run test:e2e
```

## 代码结构

```text
apps/
├─ client/                 React 与 Tauri 客户端
│  └─ src/
│     ├─ features/         账号、学生档案与课堂
│     └─ transport/        HTTP、状态订阅与身份状态
├─ agent/                  服务端 Pi 实例与执行管理
└─ server/                 Go 服务
   ├─ cmd/api/
   │  ├─ main.go          服务启动与依赖组装
   │  ├─ client/          客户端 HTTP 接口、用户认证与 WebSocket
   │  ├─ agent/           Agent HTTP 接口、服务认证与执行范围校验
   │  └─ transport/       共用 JSON、模型流与实时传输
   └─ internal/
      ├─ application/
      │  ├─ accounts/     账号与用户会话
      │  ├─ courses/      课程、对话归属与材料
      │  ├─ learning/     建档对话与学习状态
      │  ├─ illustrations/ 插图生成与素材
      │  ├─ execution/    Agent 执行凭证、状态保存与工具编排
      │  └─ identity/     业务事务内的显式身份校验
      ├─ data/             PostgreSQL 数据访问
      └─ mailer/           邮件投递
packages/
└─ learning/src/
   ├─ domain/              学习领域与同步状态类型
   └─ pi/                  Agent、工具和会话编排
```

客户端与 Agent API 使用独立的路由与监听端口，分别接受用户凭据和内部服务凭据；共同业务显式接收授权函数，并在事务内重新校验身份。Agent 创建课程及绑定原对话由执行模块在同一事务内完成。

教学与课件使用独立的模型流，可以并行工作。Agent 在服务端持续执行，生成状态保存后通过 WebSocket 同步到在线设备。首次发送时建立独立对话和固定入口，模型未调用课程工具时，消息仍会保存并出现在最近对话中。课程和章节是可选归属；归属操作保留原对话 ID 与消息。空白学习页不创建对话，筛选课程只改变展示范围。侧边栏独立订阅当前用户的对话与任务状态，优先展示正在生成的对话；离开会话不会停止任务。重新进入会话或断线重连时，客户端先恢复最新状态，再持续接收流式内容、工具调用和页面更新；生成和重新连接通过状态图标提示。

桌面端登录凭据通过 Tauri 原生层保存到系统安全存储。macOS 使用钥匙串，Windows 使用系统凭据存储，Linux 需要可用且已解锁的 Secret Service；各平台仍需在正式发布前完成实测。

## 协作入口

- [贡献指南](../CONTRIBUTING.md)
- [开发约定](../AGENTS.md)
- [产品需求 Issue #3](https://github.com/LanternCX/zhiya/issues/3)
- [技术选型 Issue #2](https://github.com/LanternCX/zhiya/issues/2)
- [赛事要求](competition.md)
