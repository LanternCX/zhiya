<div align="center">

<img src="apps/client/src-tauri/icons/icon.svg" alt="知芽图标" width="128" height="128">

# 知芽 Zhiya

面向小学至高中学生的个性化 AI 学习搭子

让 AI 先认识学生，再用适合他的方式讲解编程与人工智能。

[![License](https://img.shields.io/badge/License-AGPL--3.0-22c55e?style=flat-square)](LICENSE)

[参与贡献](CONTRIBUTING.md) · [本地开发](docs/development.md)

</div>

## 认识知芽

知芽希望成为陪伴学生长期学习的 AI 搭子。它不只回答眼前的问题，还会通过自然对话了解学生的年级、知识基础、兴趣和学习偏好，并根据后续表现持续调整讲解方式与学习内容。

学生只需说出想学什么，知芽便可以一边交流，一边组织图文课件，把一次提问逐步展开成适合当前学生的课堂。

## 学习体验

| 先认识学生 | 动态组织课堂 | 记住学习情况 |
| --- | --- | --- |
| 通过轻量对话了解基础、兴趣与学习偏好，无需填写冗长表单。 | 教学 Agent 负责讲解和节奏，课件 Agent 同时逐页生成内容，第一页准备好即可开始学习。 | 保存学生档案、课程和课堂状态，让后续交流建立在已经发生的学习之上。 |

知芽围绕一个持续循环工作：

> 了解学生 → 组织教学 → 观察反馈 → 更新认识 → 调整下一步学习

## 系统架构

主／子 Agent 统一在服务端运行；Go 分别向客户端和 Agent 提供 API，共用业务与持久化能力。客户端断开连接不取消生成，重新进入后恢复已保存的内容与运行状态。

![知芽技术架构：客户端、Go 双 API 入口与服务端 Pi 运行时](docs/assets/zhiya-architecture.svg)

图中合并展示服务间通信，不单独绘制响应回路。Go 向 Pi 下发执行指令，Pi 通过内部 API 调用工具、回传生成事件；客户端 API 使用用户身份，内部 API 使用服务身份与本次执行授权，两者共用业务层。

Go 按接入层、应用层和基础设施层组织。

## 本地运行

准备 Node.js 22.19+、npm、Go 1.26+ 和 Docker，然后在仓库根目录执行：

```sh
npm install
npm run dev:services
```

再分别启动服务端和浏览器客户端：

```sh
npm run dev:server
npm run dev
```

打开 <http://127.0.0.1:1420> 使用知芽；本地验证邮件可在 <http://127.0.0.1:8025> 查看。模型连接、桌面端运行、配置方式和测试命令见[开发指南](docs/development.md)。

## 参与贡献

欢迎通过 Issue 和 Pull Request 一起完善知芽。开始前请阅读[贡献指南](CONTRIBUTING.md)，了解项目的协作方式、人工审核要求和提交流程；项目目标、范围和验收场景见[产品需求 Issue #3](https://github.com/LanternCX/zhiya/issues/3)。

## License

知芽采用 [GNU Affero General Public License v3.0](LICENSE) 开源。
