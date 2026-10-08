# 官网与桌面版本发布

官网是 `apps/website` 中的纯静态 React 应用，包含滚动视差、预设交互课堂演示和下载入口。演示不调用模型、不连接业务后端，也不要求登录。网页自身使用仓库内资源；下载信息来自随站点部署的 `downloads.json`，浏览器不查询 GitHub API。

演示窗口加载同站点的 `product-demo/index.html`，直接使用 `apps/client` 的 App、路由、组件和样式。客户端视觉改动会同步进入官网演示。官网专用的内存适配器在这个独立文档里接管请求和状态通知，提供示例账户、课堂、档案与班级；数据刷新后重置，文件不会上传，语音不采集麦克风。B 站播放器使用本地预设画面，客户端正式版本仍使用官方播放器。演示的场景选择与重置按钮位于官网外框，不改变产品界面。

官网使用一个页面滚动位置推进演示。演示窗口在当前章节停留，滚动进度带动较长的对话、档案、文档或班级内容，并推进图文课件的预设页面；当前章节完成后，页面继续进入下一段。嵌入窗口及其中的课件、视频窗口不独立响应滚轮，内部滚动条隐藏。按钮和输入仍可操作；点击“展开体验”进入独立页面后，可以自由滚动产品界面。

官网部署目标为 GitHub Pages，默认地址为 <https://lanterncx.github.io/zhiya/>。首次部署需要先完成下方仓库设置。安装包由 GitHub Releases 分发，支持 Windows x64 和 macOS Apple Silicon（M 系列芯片）。产品后端须另行部署；GitHub Pages 和 Releases 不提供 AI 服务。

## 仓库设置

维护者在 GitHub 仓库中完成以下设置：

1. 在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
2. 在 **Settings → Secrets and variables → Actions → Variables** 设置 `ZHIYA_API_ORIGIN`，值为产品 API 的 HTTPS origin，例如 `https://api.example.com`。它不能包含路径、凭据或末尾斜杠；示例地址不能用于实际发布。
3. 若 `github-pages` environment 限制部署来源，允许 `main`。Pages 工作流始终构建最新 `main`，即使由安装包工作流完成事件触发。

API 地址是客户端的公开构建配置，不是密钥。它在构建时嵌入安装包；变更地址需要发布新客户端。地址未配置时，官网仍可部署，但安装包工作流会停止，不会将本地开发地址带入正式发布。

## 发布步骤

1. 将经过审核的改动合入 `main`。从该提交创建并 push 版本 tag，如 `v1.2.3` 或 `v1.2.3-alpha.1`；还支持 `beta.N` 和 `rc.N`。每个 tag 固定一次版本，不移动已发布的 tag。
2. **Release draft** 工作流校验 tag 属于 `main`，运行客户端、服务端、Agent 和官网检查。通过后创建 Draft Release，生成更新说明，尚不构建安装包。带预发布后缀的 tag 默认标记为 prerelease。
3. 人工审核并完善 Draft 的更新说明。确认产品 API 已就绪且构建地址正确后，点击 **Publish release**。
4. **Release installers** 工作流确认同一 tag 的 CI 成功和 API 地址有效，再并行生成两个安装包。版本号由 tag 决定，通过 Tauri 构建配置传入，不需要在 CI 中修改源码版本文件。Windows 使用 NSIS，附带 WebView2 bootstrapper；缺少 WebView2 时，安装仍需联网下载运行时。macOS 使用 DMG 与 ad-hoc 临时签名，不使用 Developer ID 或 Apple 公证。
5. 所有构建成功后，上传安装包和 `SHA256SUMS.txt`，最后上传 `downloads.json` 作为完整发布标记。正式 Release 在这段构建期间暂时没有安装包。
6. **Website deployment** 接到成功完成事件后，从最新 `main` 构建并测试 `/zhiya/` 路径的官网，再部署 Pages。它检查清单、附件大小与可用的 GitHub SHA-256 digest，不将不完整版本设为下载版本。完整稳定版本优先；没有完整稳定版本时使用完整预发布版本。同类版本按发布时间选择。

官网改动合入 `main` 后也会独立部署，复用最近完整版本的下载信息。没有完整版本时显示“安装包准备中”。读取 GitHub 失败会让部署停止，保留已上线页面。API 可用性与真实账号/课堂的上线验收属于后端部署工作，不能通过官网 demo 或打包成功推断。

## 重试与维护

- Tag CI 失败：修复原因后对原工作流重试；若需要修改源码，应创建新 tag。
- 安装包失败：在 Actions 重试工作流，或从 `main` 手工运行 **Release installers** 并填写已正式发布的 tag。它仍要求该 tag 的 Draft CI 成功；手工运行不会创建或发布 Release。
- 附件上传失败：重试后覆盖同名附件，完整清单最后上传。不要手工把不完整清单标记为就绪。
- Pages 部署失败：修复设置或失败原因后，从 `main` 手工运行 **Website deployment**，不必重新打包。
- 撤回版本：删除或撤回有问题的 Release 后，手工运行官网部署以重新选择完整版本。已下载的客户端不会自动回滚。

`SHA256SUMS.txt` 验证文件内容是否与发布附件一致，不代替发布者身份认证。Windows 安装包没有受信任的代码签名，可能出现未知发布者、SmartScreen 或设备策略拦截。macOS 首次打开可能需要在“隐私与安全性”中选择“仍要打开”；确认下载来源和校验值后，必要时可以仅移除该应用的隔离属性：

```sh
xattr -dr com.apple.quarantine "/Applications/Zhiya.app"
```

不要求用户关闭系统安全保护，也不向用户分发自签根证书。尚未提供自动更新；用户通过官网下载安装新版本。

## 本地验证

```sh
npm ci
node --test scripts/release.test.mjs
npm run test:website
npm run test:website:pages
```

官网预览使用 `npm run dev:website`。本地完整 Release 清单可通过 `gh` 登录后执行以下命令生成到忽略目录，再查看内容：

```sh
node scripts/website-downloads.mjs dist/downloads.json
```

本机打包须安装 Tauri 对应平台的系统依赖及 Rust target。命令会从现有 SVG 自动生成原生图标到忽略目录 `apps/client/src-tauri/gen/icons`：

```sh
ZHIYA_CLIENT_API_ORIGIN=https://your-api-domain.example npm run build:desktop -- --bundles dmg --config '{"version":"1.2.3"}' -- --locked
```

Windows 在本机或 Windows Actions runner 上使用 `--bundles nsis`。先检查生成的安装包，再决定是否发布；不要分发连接占位地址的本地验证包。
