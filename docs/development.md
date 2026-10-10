# 知芽开发与部署指南

这份指南帮助你在本地运行知芽，配置教学服务，并部署到自己的环境。所有命令都在仓库根目录执行。

## 本地运行

### 1. 准备环境

安装 Node.js 22.19+、npm、Go 1.26+ 和 Docker，然后安装项目依赖：

```sh
npm install
```

如果要开发桌面版，另外准备 Rust 和对应系统的 [Tauri 开发环境](https://v2.tauri.app/start/prerequisites/)。

### 2. 启动配套服务

```sh
npm run dev:services
```

该命令启动数据库、文件存储、邮件收件箱、材料解析和代码运行服务。首次运行需要下载镜像，并构建部分容器。

默认配置可以直接用于本地开发。端口被占用时，按[修改本地配置](#修改本地配置)调整。

### 3. 配置教学模型

在 `apps/server/config.local.yaml` 中填写模型连接：

```yaml
model:
  endpoint: "https://your-model-service.example/v1/chat/completions"
  id: "your-model-id"
  api_key: "your-api-key"
```

这里需要支持 OpenAI-compatible Chat Completions 的模型服务。`endpoint` 填写完整接口地址，包括 `/v1/chat/completions`。

接着按[接入教学知识库](#接入教学知识库)准备教材和检索服务。模型和知识库都配置完成后，才能体验完整教学。

只想先查看账号页面时，可以暂时跳过这一步。

### 4. 打开知芽

在一个终端启动后端：

```sh
npm run dev:server
```

在另一个终端启动客户端：

```sh
npm run dev
```

打开 <http://127.0.0.1:1420>。注册时可使用测试邮箱，在 <http://127.0.0.1:8025> 查看验证码；本地邮件不会发往真实邮箱。

桌面版使用 `npm run dev:desktop` 代替 `npm run dev`。Linux 桌面版需要已解锁的 Secret Service 保存登录凭据。

结束开发后，关闭上述终端进程，再运行 `npm run stop:services` 停止配套服务。数据会保留。

## 接入教学知识库

知芽通过知识库查阅教材和教学资料。可以直接导入已发布的资料与向量，不需要重新生成 Embedding。

在 `apps/server/config.local.yaml` 中填写查询凭据：

```yaml
knowledge_text_model:
  api_key: "文本 Embedding API Key"
knowledge_visual_model:
  api_key: "视觉 Embedding API Key"
```

两路查询使用硅基流动的 `Qwen/Qwen3-Embedding-8B` 和 `Qwen/Qwen3-VL-Embedding-8B`。凭据分别填写，不会自动共用。

安装 `hf` 和 `uv` 后，按[知识库说明](../apps/knowledge/README.md#接入知识库)下载并导入。导入会写入独立的知识库数据库和存储桶。

## 使用语音、插图和材料识别

需要这些能力时，在服务端本地配置中填写相应凭据：

| 能力 | 配置项 |
| --- | --- |
| 听写和语音对话 | `speech.asr_api_key`、`speech.tts_api_key` |
| 教学插图 | `image_model.api_key` |
| 图片及文档内图片识别 | `vision_model.api_key`，使用百炼北京地域凭据 |

默认服务地址和模型见 [apps/server/config.yaml](../apps/server/config.yaml)。修改配置后重启后端。

浏览器使用麦克风需要本地地址或 HTTPS。

## 修改本地配置

默认配置分为三处：

| 文件 | 管理内容 |
| --- | --- |
| [apps/server/config.yaml](../apps/server/config.yaml) | 后端服务、模型、存储和邮件连接 |
| [apps/client/config.json](../apps/client/config.json) | 客户端连接地址与请求超时 |
| [dev-services.env](../dev-services.env) | Docker 服务端口与开发凭据 |

**后端**：将需要覆盖的字段写入 `apps/server/config.local.yaml`。这个文件不会进入版本库。也可用 `ZHIYA_SERVER_<SECTION>_<KEY>` 环境变量覆盖，例如 `ZHIYA_SERVER_MODEL_API_KEY`。

**客户端**：复制默认配置为 `apps/client/config.local.json`，修改后显式选择它：

```sh
ZHIYA_CLIENT_CONFIG=config.local.json npm run dev
```

**Docker 服务**：复制 `dev-services.env` 为 `dev-services.local.env`，修改后运行：

```sh
ZHIYA_SERVICES_ENV=dev-services.local.env npm run dev:services
```

修改端口或凭据时，同时更新后端的连接配置。修改客户端地址后，需要重启开发服务或重新构建客户端。真实密钥只放在本地配置或部署环境中。

## 部署学习应用

学习应用需要 Go 后端、Agent 服务和配套容器。浏览器页面由 Go 提供，教学生成由 Agent 服务执行。

### 1. 准备运行环境

准备 Node.js、PostgreSQL（支持 pgvector）、RustFS、真实 SMTP，以及材料解析和 go-judge 容器。容器配置可参考 [compose.yaml](../compose.yaml)。

业务与知识库分别使用独立数据库和存储桶。启动时会初始化数据表，数据库账号需要相应权限。

### 2. 构建应用

```sh
npm run build
npm run build:server
npm run build:agent
```

部署时保留以下文件，以及 Agent 运行所需的 Node.js 依赖：

| 文件或目录 | 用途 |
| --- | --- |
| `apps/client/dist` | 浏览器页面 |
| `dist/server` | Go 后端 |
| `apps/agent/dist` | Agent 服务 |

### 3. 准备部署配置

以 [apps/server/config.yaml](../apps/server/config.yaml) 为基础，创建完整部署配置，例如 `/etc/zhiya/server.yaml`。本地开发凭据需要替换。

| 配置 | 需要填写的内容 |
| --- | --- |
| `development` | `false` |
| `http.listen` | Go 监听地址 |
| `http.origin` | 用户访问学习应用的 HTTPS 地址 |
| `http.web_dir` | 客户端构建产物的绝对路径 |
| `database`、`knowledge_database` | 两个数据库的连接 |
| `storage`、`knowledge_storage` | 两个存储桶的连接与凭据 |
| `smtp` | 邮件服务连接与发件人 |
| `material_parser.endpoint`、`runner.endpoint` | Go 可访问的材料解析和代码运行地址 |
| `agent.secret` | 至少 32 个字符的密钥，Go 与 Agent 使用同一个值 |

模型配置与本地运行相同。存储的服务地址和公开地址都需要 HTTPS；公开地址必须能由客户端访问。RustFS 的 CORS 设置需要允许学习应用域名。

使用 `-config` 指定文件时，后端只读取该完整配置，不再合并默认和本地文件。可通过环境变量覆盖其中的密钥。

### 4. 启动后端与 Agent

启动 Go：

```sh
./dist/server -config /etc/zhiya/server.yaml
```

另一个进程启动 Agent，替换示例中的密钥和保存目录：

```sh
ZHIYA_AGENT_SECRET='与 Go agent.secret 一致的密钥' \
ZHIYA_AGENT_API=http://127.0.0.1:8081 \
ZHIYA_AGENT_LISTEN=127.0.0.1:8082 \
ZHIYA_AGENT_WORKSPACES=/var/lib/zhiya/workspaces \
node apps/agent/dist/server.mjs
```

以上示例将两个进程放在同一台机器。Go 的 `agent.internal_listen` 应为 `127.0.0.1:8081`，`agent.endpoint` 应为 `http://127.0.0.1:8082`。分开部署时改为彼此可访问的内部地址。

配置 HTTPS 反向代理，将页面和 API 转发给 Go。代理需要支持 WebSocket。Agent、数据库、材料解析和代码运行服务只在内部网络开放。

### 5. 保存数据并检查运行

持久化并备份以下三处：

- PostgreSQL 数据。
- RustFS 中的材料和素材。
- `ZHIYA_AGENT_WORKSPACES` 指定的目录，其中保存 Agent 会话。

Agent 保存目录使用固定绝对路径。默认目录随进程工作目录变化，容易在部署时遗漏。

先检查 `/health`，再实际完成注册、建档和教学检索。需要语音、材料识别或编程时，也逐项试用。客户端退出后生成可以继续，但 Agent 进程故障后不保证自动续跑。

Go 日志输出到标准错误。集中采集时设置 `logging.format: json`；页面中的错误编号可用于查找对应请求日志。

## 官网与桌面版

本地查看官网：

```sh
npm run dev:website
```

打开 <http://127.0.0.1:4174>。官网使用预设演示，不需要业务后端。

桌面安装包构建使用 `npm run build:desktop`。官网部署、版本发布和客户端连接地址的设置见[发布指南](releasing.md)。

## 开发验证

| 命令 | 用途 |
| --- | --- |
| `npm run check:client-config` | 检查客户端配置 |
| `npm run check:server-config` | 检查后端配置 |
| `npm run check` | TypeScript 类型检查 |
| `npm test` | Go 与仓库规则测试 |
| `npm run test:agent` | Agent 测试 |
| `npm run test:accounts` | 数据库行为测试 |
| `npm run test:e2e` | 浏览器测试 |
| `npm run test:desktop` | 桌面请求测试 |

完整部署配置可用 `./dist/server -config /etc/zhiya/server.yaml -check-config` 检查。配置通过不表示外部服务已经连通。

首次运行浏览器测试前，安装 Chromium：

```sh
npx --workspace @zhiya/client playwright install chromium
```

自动化测试中的模型响应是模拟数据。教学效果需要使用真实模型另行验证。
