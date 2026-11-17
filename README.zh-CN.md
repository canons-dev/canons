# canons

为 coding agent 的指令（`AGENTS.md`、按路径生效的规则、技能）提供唯一真源，Codex、Claude Code 等客户端共用同一份内容，并由确定性检查守住。

[English](README.md)

## 为什么需要它

同时用多个 coding agent 的团队，常常遇到 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules` 各自漂移，规则只有某一个客户端会加载，红线在有人精简文件时悄悄消失。canons 给每个仓库同一套布局，并用一个小 CLI 守住它：

- **每条指令只有一份。** 只有 `AGENTS.md`、`.agents/rules/`、`.agents/skills/` 是实体文件；客户端入口都是相对软链接。
- **路径级规则对所有客户端生效。** 规则在 frontmatter 里声明 `paths`。Claude Code 原生加载；其他客户端由根指令要求修改前跑 `canons scopes <路径>`、完成前跑 `canons scopes --changed`。
- **共享基线。** `AGENTS.md` 里的托管区块承载通用的 agent 约定（Git 授权、验证、交接、文档卫生）。项目自己的规则写在区块之外。
- **确定性守护。** `canons verify` 能发现：托管内容被手改、用复制代替软链接、`AGENTS.md`、规则和技能里的死链、会让 Codex 跳过 `AGENTS.md` 的 `AGENTS.override.md`，以及超出 Codex 读取上限（32 KiB）的指令链。

## 交给 coding agent 安装

在仓库根目录把下面这段粘贴给 Codex、Claude Code 或其他 coding agent。以后再粘贴一次就是更新。

```text
在这个仓库里安装或更新 canons（https://github.com/canons-dev/canons），之后按 AGENTS.md 里的 canons 区块执行。

- 命令：有 package.json 就把 @canons-dev/canons@latest 装成 dev dependency，用 `npx canons`；没有就用 `npx -y @canons-dev/canons@latest`。需要 Node 22+。
- 第一次运行 `create --locale zh-CN --adopt`（会把已有的 CLAUDE.md、.claude/rules、.claude/skills 搬到位），以后运行 `update`。然后运行 `verify`，修好它报告的问题。
- 以下情况先问我：要在我未提交的改动上继续、接受破坏性升级（把 CHANGELOG 里的相关条目给我看）、丢弃托管内容的手工修改、删除任何东西、在沙箱外运行（Codex 沙箱保护 .agents/）。
- AGENTS.md 里还没有项目设定时，问我 UI 语言，然后把 UI 语言、开发语言和目录结构记在 canons 区块之外。
- 不改其他东西，不提交。最后告诉我改了什么、需要我做什么。
```

## 快速开始

需要 Node 22 及以上，并且在 git 仓库里运行。

```sh
npm install --save-dev @canons-dev/canons
npx canons create --locale zh-CN
npx canons verify
```

包会安装一个 `canons` 命令。请把它装成 dev dependency，这样托管规则要求 agent 运行的 `npx canons` 会解析到锁定版本的本地副本。没有 `package.json` 的仓库改为运行 `npx -y @canons-dev/canons@latest create --locale zh-CN`：`create` 会选用 `npx` runner，托管规则里写的是带确切版本号的命令（见下文 `runner`）。`create` 会创建 `canons.json`，在 `AGENTS.md` 里插入托管区块（文件不存在就新建），把托管规则写进 `.agents/rules/canons/`，为 Claude Code 建好软链接，并写出 `canons.lock.json`。这些文件都要提交。

新建的 `AGENTS.md` 还会带一节**项目设定**，托管规则会读取它：UI 语言（没写时 agent 会在写面向用户的文字前先和你确认）、开发语言（没写时用系统语言）、目录结构（没写时用 `src/`、`doc/`、`tmp/`，其他目录也用三个字母的名字）。已有的 `AGENTS.md` 请在 canons 区块之外补上同样一节。

然后添加项目自己的规则：

```md
<!-- .agents/rules/apis.md -->
---
paths:
  - "src/api/**"
anchors:              # 可选：这条规则钉住的代码符号
  - parseRequest
---

# API 处理器

- 在边界处用 `parseRequest` 校验每个请求体。
```

某个 anchor 在 `sourceDirs` 里找不到时 `verify` 会报错，这样改名后规则不会悄悄指向不存在的东西。

```sh
npx canons scopes src/api/users.ts   # 这个路径适用哪些规则？
npx canons scopes --changed          # 我的改动适用哪些规则？
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `canons create [--locale <code>] [--runner local\|npx] [--adopt]` | 创建 `canons.json` 并执行 `update`。`canons.json` 最后才写，被拒绝时不留下任何文件。 |
| `canons update [--accept-major] [--force] [--adopt]` | 用已安装的版本重写托管区块、托管规则、客户端软链接和 lock（不会升级 npm 包）。默认拒绝覆盖手工修改（`--force` 才覆盖），拒绝破坏性的规则升级（`--accept-major` 才放行）。所有拒绝（包括客户端文件挡路、目录不可写）都发生在写第一个文件之前。`--adopt` 把实体的 `CLAUDE.md`、`.claude/rules`、`.claude/skills` 搬进 `AGENTS.md` / `.agents/` 并建软链接；会覆盖或需要合并不同内容时拒绝。 |
| `canons verify [--strict]` | 确定性检查；有 error 时退出码为 1（`--strict` 下 warning 也算失败）。 |
| `canons scopes [--changed] [--json] <路径>...` | 列出 `paths` 命中的规则。没有 `paths` 的规则是全局规则，始终列出。 |
| `canons doctor` | 环境提示（软链接支持、Codex hooks、其他客户端）。 |

## 配置

`canons.json`（除 `version` 外都是可选项）：

```json
{
  "version": 1,
  "locale": "zh-CN",
  "clients": ["codex", "claude"],
  "runner": "local",
  "rulesDir": ".agents/rules",
  "skillsDir": ".agents/skills",
  "sourceDirs": ["src"],
  "docDirs": ["doc"],
  "budgetBytes": 24576,
  "ruleNamePattern": "^[a-z]{6}$"
}
```

- `runner` 决定托管规则让 agent 运行什么命令。`local`（有 `package.json` 时的默认值）写 `npx canons`，要求把包装成 dev dependency，缺了 `verify` 会警告。`npx`（没有 `package.json` 时的默认值）写 `npx -y @canons-dev/canons@<版本>`，固定为最近一次运行 `update` 的版本。
- `sourceDirs` 列出规则 `anchors` 必须仍能找到的目录（默认 `["src"]`，不搜索 Markdown 文件）。
- `docDirs` 追加需要 `verify` 检查 Markdown 链接的目录。`AGENTS.md` 和规则始终检查（报 error），技能也检查（报 warning，因为可能是 vendor 进来的上游原文）。代码里的链接不检查。
- `budgetBytes` 只限制根 `AGENTS.md`（默认 24 KiB，最多 32 KiB），给嵌套的指令文件留出 Codex 能加载的空间。
- `ruleNamePattern` 可选，用来约束项目自己的顶层规则文件名。
- `presets` 和 `hooks` 留给后续版本，目前必须保持为空 / `false`。

## 客户端

| 客户端 | 如何读到指令 |
| --- | --- |
| Codex | 原生从仓库根往下读到工作目录的各级 `AGENTS.md`，并读取 `.agents/skills/`。交互式客户端启动前会要求你信任该目录。 |
| Claude Code | `CLAUDE.md -> AGENTS.md`、`.claude/rules -> ../.agents/rules`、`.claude/skills -> ../.agents/skills`；规则按 `paths` 原生加载。 |
| Cursor、GitHub Copilot | 原生读取 `AGENTS.md`。 |
| Gemini CLI | 把 `context.fileName` 设为 `["AGENTS.md"]`。 |

Windows 用户在 clone 前先启用软链接（开启开发者模式后执行 `git config core.symlinks true`）；canons 不会退化成复制文件。

## 版本

规则内容遵循 semver。**major** 版本会新增或收紧红线，或改变使用方必须做的事；`0.x` 期间 minor 版本按 major 对待。遇到破坏性升级时 `canons update` 会停下，直到你加上 `--accept-major`，让规则变更和代码一样经过 review。

## 安全

canons 运行时从不联网拉取规则：`update` 只从已安装的包里复制文件，写出的内容也不会被执行。发布只经 GitHub Actions 进行，并附带 npm provenance。详见 [SECURITY.md](.github/SECURITY.md)。

## 协议

[Apache-2.0](LICENSE)
