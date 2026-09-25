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

教学 Agent 在客户端运行，模型请求通过 Go 服务转发。模型凭据只配置在服务端，不要写入客户端配置或提交到版本库。

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

实时 Voice Mode 需要浏览器允许麦克风访问。开发环境的 `localhost` 和 `127.0.0.1` 属于浏览器允许的安全上下文；部署到其他域名时应使用 HTTPS。拒绝麦克风权限不会影响文字聊天和可编辑听写以外的文字输入。语音连接、ASR 和 TTS 出错时，客户端会保留文字聊天能力。

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

Docker 基础设施配置由 [`dev-services.env`](../dev-services.env) 管理。若修改 PostgreSQL 或 Mailpit 的映射端口，需要同步调整服务端连接配置。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | TypeScript 类型检查 |
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
├─ client/                 React、Tauri 与客户端 Agent
│  └─ src/
│     ├─ features/         账号、学生档案与课堂
│     ├─ pi/               Agent、工具和会话编排
│     ├─ domain/           学习领域类型
│     └─ transport/        HTTP、模型流与身份状态
└─ server/                 Go 服务
   ├─ cmd/api/             路由、中间件与请求处理
   └─ internal/
      ├─ data/             PostgreSQL 数据访问
      └─ mailer/           邮件投递
```

教学与课件使用独立的模型流，可以并行工作。会话操作与在线设备同步通过 WebSocket 完成，完整回复保存后才会出现在其他设备；生成中的文字只在执行设备显示。客户端退出时不会把 Agent 转移到云端继续运行。

桌面端登录凭据通过 Tauri 原生层保存到系统安全存储。macOS 使用钥匙串，Windows 使用系统凭据存储，Linux 需要可用且已解锁的 Secret Service；各平台仍需在正式发布前完成实测。

## 协作入口

- [贡献指南](../CONTRIBUTING.md)
- [开发约定](../AGENTS.md)
- [产品需求 Issue #3](https://github.com/LanternCX/zhiya/issues/3)
- [技术选型 Issue #2](https://github.com/LanternCX/zhiya/issues/2)
- [赛事要求](competition.md)
