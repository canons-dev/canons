# canons

为 coding agent 的指令（`AGENTS.md`、按路径生效的规则、技能）提供唯一真源，Codex、Claude Code 等客户端共用同一份内容，并由确定性检查守住。

[English](README.md)

## 为什么需要它

同时用多个 coding agent 的团队，常常遇到 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules` 各自漂移，规则只有某一个客户端会加载，红线在有人精简文件时悄悄消失。canons 给每个仓库同一套布局，并用一个小 CLI 守住它：

- **每条指令只有一份。** 只有 `AGENTS.md`、`.agents/rules/`、`.agents/skills/` 是实体文件；客户端入口都是相对软链接。
- **路径级规则对所有客户端生效。** 规则在 frontmatter 里声明 `paths`。Claude Code 原生加载；其他客户端由根指令要求修改前跑 `canons scopes <路径>`、完成前跑 `canons scopes --changed`。
- **共享基线。** `AGENTS.md` 里的托管区块承载通用的 agent 约定（Git 授权、验证、交接、文档卫生）。项目自己的规则写在区块之外。
- **确定性守护。** `canons check` 能发现：托管内容被手改、用复制代替软链接、规则里的死链、会让 Codex 跳过 `AGENTS.md` 的 `AGENTS.override.md`，以及超出 Codex 读取上限（32 KiB）的指令链。

## 交给 coding agent 安装

在仓库根目录，把下面这段粘贴给 Codex、Claude Code 或其他 coding agent。以后再粘贴一次就是更新：同一套步骤第一次是安装，之后是升级。

```text
在这个仓库里安装或更新 canons（https://github.com/canons-dev/canons）。canons 把 coding agent 的指令集中在一处：AGENTS.md、.agents/rules/ 和 .agents/skills/。

1. 运行 `git status`。如果有未提交的改动，列出来并先问我再继续。
2. 确认有 Node 22 或更高版本。如果仓库里没有 package.json，先问我再创建。
3. 运行 `npm install --save-dev @canons-dev/canons@latest`。
4. 如果没有 canons.json，运行 `npx canons init --locale zh-CN`；否则运行 `npx canons sync`。
5. 如果命令停下来：
   - 因为破坏性升级：把 node_modules/@canons-dev/canons/doc/CHANGELOG.md 里新旧版本之间的条目给我看，我同意后再运行 `npx canons sync --accept-major`。
   - 因为托管内容被手改：把改动给我看。除非我说可以，不要加 `--force`。
   - 因为 CLAUDE.md、.claude/rules 或 .claude/skills 是实体文件或目录：把内容移进 AGENTS.md（canons 区块之外）、.agents/rules/ 或 .agents/skills/，然后重跑。删除任何东西前先问我。
   - 因为沙箱不允许写 .agents/（Codex 的沙箱会保护这个目录）：请我批准在沙箱外运行该命令，或者由我自己运行。
6. 运行 `npx canons check`，修复它报告的问题。
7. 阅读 AGENTS.md 里的 canons 区块，此后照它执行。
8. 不要改动这些步骤以外的任何东西。总结改了什么（`git diff --stat`）以及需要我做什么。除非我要求，不要提交。
```

## 快速开始

需要 Node 22 及以上，并且在 git 仓库里运行。

```sh
npm install --save-dev @canons-dev/canons
npx canons init --locale zh-CN
npx canons check
```

包会安装一个 `canons` 命令。请把它装成 dev dependency，这样托管规则要求 agent 运行的 `npx canons` 会解析到锁定版本的本地副本。`init` 会创建 `canons.json`，在 `AGENTS.md` 里插入托管区块（文件不存在就新建），把托管规则写进 `.agents/rules/canons/`，为 Claude Code 建好软链接，并写出 `canons.lock.json`。这些文件都要提交。

然后添加项目自己的规则：

```md
<!-- .agents/rules/apis.md -->
---
paths:
  - "src/api/**"
---

# API 处理器

- 在边界处校验每个请求体。
```

```sh
npx canons scopes src/api/users.ts   # 这个路径适用哪些规则？
npx canons scopes --changed          # 我的改动适用哪些规则？
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `canons init [--locale <code>]` | 创建 `canons.json` 并执行 `sync`。 |
| `canons sync [--accept-major] [--force]` | 更新托管区块、托管规则、客户端软链接和 lock。默认拒绝覆盖手工修改（`--force` 才覆盖），拒绝破坏性的规则升级（`--accept-major` 才放行）。 |
| `canons check [--strict]` | 确定性检查；有 error 时退出码为 1（`--strict` 下 warning 也算失败）。 |
| `canons scopes [--changed] [--json] <路径>...` | 列出 `paths` 命中的规则。没有 `paths` 的规则是全局规则，始终列出。 |
| `canons doctor` | 环境提示（软链接支持、Codex hooks、其他客户端）。 |

## 配置

`canons.json`（除 `version` 外都是可选项）：

```json
{
  "version": 1,
  "locale": "zh-CN",
  "clients": ["codex", "claude"],
  "rulesDir": ".agents/rules",
  "skillsDir": ".agents/skills",
  "budgetBytes": 24576,
  "ruleNamePattern": "^[a-z]{6}$"
}
```

- `budgetBytes` 只限制根 `AGENTS.md`（默认 24 KiB，最多 32 KiB），给嵌套的指令文件留出 Codex 能加载的空间。
- `ruleNamePattern` 可选，用来约束项目自己的顶层规则文件名。
- `presets` 和 `hooks` 留给后续版本，目前必须保持为空 / `false`。

## 客户端

| 客户端 | 如何读到指令 |
| --- | --- |
| Codex | 原生从仓库根往下读到工作目录的各级 `AGENTS.md`，并读取 `.agents/skills/`。 |
| Claude Code | `CLAUDE.md -> AGENTS.md`、`.claude/rules -> ../.agents/rules`、`.claude/skills -> ../.agents/skills`；规则按 `paths` 原生加载。 |
| Cursor、GitHub Copilot | 原生读取 `AGENTS.md`。 |
| Gemini CLI | 把 `context.fileName` 设为 `["AGENTS.md"]`。 |

Windows 用户在 clone 前先启用软链接（开启开发者模式后执行 `git config core.symlinks true`）；canons 不会退化成复制文件。

## 版本

规则内容遵循 semver。**major** 版本会新增或收紧红线，或改变使用方必须做的事；`0.x` 期间 minor 版本按 major 对待。遇到破坏性升级时 `canons sync` 会停下，直到你加上 `--accept-major`，让规则变更和代码一样经过 review。

## 安全

canons 运行时从不联网拉取规则：`sync` 只从已安装的包里复制文件，写出的内容也不会被执行。发布只经 GitHub Actions 进行，并附带 npm provenance。详见 [SECURITY.md](.github/SECURITY.md)。

## 协议

[Apache-2.0](LICENSE)
