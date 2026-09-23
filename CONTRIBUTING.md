# 贡献指南

## 核心原则

**你必须理解自己提交的代码。** 你需要说清楚改了什么、代码是怎么工作的，以及这些改动会如何影响项目的其他部分。如果说不清楚，我们会关闭你的 PR。

可以让 AI 帮你写代码，但不能把自己都没看懂的生成结果直接交上来。

使用编码 Agent 时，请在 知芽 根目录下启动，并确保它读取并遵守 `AGENTS.md` 中的项目约定。

## 通过编码 Agent 协作

知芽 使用面向 AI 的协作环境（Harness）。[AGENTS.md](AGENTS.md) 和 [.agents/](.agents/) 为编码 Agent 提供项目规则、技能和上下文入口。

建议以项目根目录作为工作目录，在 Codex 等编码 Agent 中打开项目，通过 Agent 讨论需求、完成实现和验证。开始前，让 Agent 阅读并遵守 `AGENTS.md`。

**参与开发必须安装并使用 [mattpocock/skills](https://github.com/mattpocock/skills)。** 请按照其 [安装说明](https://github.com/mattpocock/skills#installation-30-second-setup) 为所用的编码 Agent 安装技能，并确认当前会话能够使用。项目内的 `.agents/` 不能替代这套技能的安装；项目的技能协作约定见 `AGENTS.md`。

## 理解改动，并由人类授权

**人类授权之前，Agent 禁止对本地仓库或 GitHub 仓库进行任何写操作。** 这包括修改文件、暂存、提交、推送，以及创建或修改 Issue、PR、评论、标签和仓库设置等操作。

授权前，Agent 应说明准备执行哪些操作、影响哪些范围，以及大致如何实现。贡献者需要先理解这些内容，再允许 Agent 动手。只读调查可以先进行；讨论想法不代表允许写入，允许修改文件也不代表允许提交、推送或操作 GitHub。授权在约定范围内有效，超出范围时必须重新确认，技能或自动化流程不能代替人类授权。

## 通过 Issue 跟踪贡献

所有改动必须先创建或认领对应的 Issue。Issue 用于记录改动目的、范围、验收条件和相关讨论，一个分支原则上只处理一个 Issue。

需要讨论的功能或问题，可以使用 [Issue 模板](https://github.com/LanternCX/zhiya/issues/new/choose) 发起讨论。模板提供简短的用途说明，内容以把事情说清楚为准。由 Agent 发布或更新这些内容时，同样必须先获得人类授权。

使用对应模板的标题前缀和类型标签。需求与技术依据、开发和提交约定统一见 [AGENTS.md](AGENTS.md)。

## 从 main 创建 Issue 分支

`main` 是唯一的长期分支。开始开发前，先同步最新的 `main`，再从 `main` 创建与 Issue 对应的任务分支。不要直接向 `main` 推送提交，也不要使用 `dev` 作为开发或集成分支。

分支名称统一使用以下格式：

```text
<type>/issue-<number>-<description>
```

可用类型如下：

| 类型 | 用途 | 示例 |
| --- | --- | --- |
| `feat` | 新功能 | `feat/issue-24-lesson-animation` |
| `fix` | Bug 修复 | `fix/issue-45-reasoning-display` |
| `refactor` | 不改变外部行为的重构 | `refactor/issue-38-server-layers` |
| `docs` | 文档 | `docs/issue-56-branch-rules` |
| `test` | 测试 | `test/issue-60-course-api` |
| `chore` | 依赖、构建、工具和配置维护 | `chore/issue-61-update-dependencies` |
| `ci` | CI 工作流 | `ci/issue-62-pr-checks` |

类型和描述使用小写英文，描述中的单词用连字符分隔。有对应 Issue 时必须包含 Issue 编号。紧急修复同样先创建 Issue，并使用 `fix` 类型。

一个 Issue 确实需要多个分支时，应在描述中明确区分各分支的工作范围。不要在同一个分支或 PR 中混入无关 Issue。

## 完成实现后提交 PR

完成约定范围的实现和验证后，向 `main` 提交 PR，并按 [PR 模板](.github/pull_request_template.md) 填写内容。PR 正文使用 `Closes #<issue-number>` 关联并在合并后关闭对应 Issue。

PR 标题和英文 Commit 信息使用 Conventional Commits 格式，例如 `feat: add student onboarding`、`fix(classroom): restore lesson position` 或 `docs: define branch rules`。Commit 信息无需重复填写 Issue 编号。

- **说明**由人类撰写。
- **概要**可以由 AI 生成，但必须由人类核对。
- 提交者需要人工审核 PR 涉及的所有变更文件，并同步更新受影响的文档。
- 根据实际完成情况勾选检查清单，再交由维护者审核。

`PR template check` 会检查标题格式、模板必需章节、说明和概要是否填写，以及三个必选项是否全部勾选。自动检查只能确认填写情况，不能代替人工审核。

PR 审核通过后使用 Squash merge 合入 `main`，随后删除任务分支。编码 Agent 可以协助完成贡献，提交者仍需理解并对提交内容负责。
