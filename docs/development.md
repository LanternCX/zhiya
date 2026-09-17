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
