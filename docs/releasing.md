# 官网与桌面版本发布

本指南供维护者发布官网和桌面安装包使用。后端部署见[开发指南](development.md)。

## 首次设置

维护者在仓库中配置：

1. **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
2. 需要覆盖客户端 API 地址时，在 **Settings → Secrets and variables → Actions → Variables** 设置 `ZHIYA_API_ORIGIN`，例如 `https://api.example.com`。必须是公开 HTTPS 域名，不含路径、凭据或末尾斜杠。
3. 若 `github-pages` environment 限制部署来源，允许 `main`。

未设置 `ZHIYA_API_ORIGIN` 时，使用 [apps/client/config.json](../apps/client/config.json) 中的地址。API 地址在构建时写入客户端，修改后需要重新发布。

## 发布步骤

1. 将审核通过的改动合入 `main`，从该提交创建并推送版本 tag，例如 `v1.2.3` 或 `v1.2.3-alpha.1`。不要移动已发布的 tag。
2. 在 **Actions → Release draft** 等待检查通过，并在 **Releases** 中打开生成的草稿。
3. 核对更新说明、客户端 API 地址和后端可用情况。注册、登录和课堂功能需要可用后端；若后端尚未上线，在版本说明中明确告知。
4. 点击 **Publish release**，等待 **Release installers** 和 **Website deployment** 成功。
5. 检查官网的下载链接，并在 Windows x64 和 macOS Apple Silicon 上验证安装及后端连接。

发布后安装包仍需等待构建完成。官网改动合入 `main` 后自动部署，无需发布新版本。

工作流细节见 [Release draft](../.github/workflows/release-draft.yml)、[Release installers](../.github/workflows/release-publish.yml) 和 [Website deployment](../.github/workflows/website-pages.yml)。

## 失败重试

| 情况 | 处理方式 |
| --- | --- |
| Release draft 失败 | 查看失败日志，排除环境问题后重试；需要修改源码时创建新 tag |
| 安装包构建或上传失败 | 重试失败的 Actions，或在 Release installers 中点击 Run workflow，选择 `main` 并填写已发布的 tag |
| 官网部署失败 | 修复失败原因后，在 Website deployment 中点击 Run workflow，选择 `main`；无需重新打包 |
