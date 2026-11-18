# Canons

为 coding agent 的指令（`AGENTS.md`、按路径生效的规则、技能）提供唯一真源，Codex、Claude Code 等客户端共用同一份内容，并由确定性检查守住。

[English](README.md)

## 为什么需要它

同时用多个 coding agent 的团队，常常遇到 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules` 各自漂移，规则只有某一个客户端会加载，红线在有人精简文件时悄悄消失。canons 给每个仓库同一套布局，并用一个小 CLI 守住它：

- **每条指令只有一份。** 只有 `AGENTS.md`、`.agents/rules/`、`.agents/skills/` 是实体文件；客户端入口是薄适配：`CLAUDE.md` 只有一行导入 `@AGENTS.md`，`.claude/rules`、`.claude/skills` 是相对软链接。
- **路径级规则对所有客户端生效。** 规则在 frontmatter 里声明 `paths`。Claude Code 原生加载；其他客户端由根指令要求修改前跑 `canons scopes <路径>`、完成前跑 `canons scopes --changed`。
- **共享基线。** `AGENTS.md` 里的托管区块承载通用的 agent 约定（Git 授权、验证、交接、文档卫生）。项目自己的规则写在区块之外。
- **确定性守护。** `canons verify` 能发现：托管内容被手改、用复制代替适配、`AGENTS.md`、规则和技能里的死链、会让 Codex 跳过 `AGENTS.md` 的 `AGENTS.override.md`、超出 Codex 读取上限（32 KiB）的指令链、不符合 [Agent Skills](https://agentskills.io/specification) 格式的技能，以及项目指令里已经不存在的 npm script 和路径。

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

包会安装一个 `canons` 命令。请把它装成 dev dependency，这样托管规则要求 agent 运行的 `npx canons` 会解析到锁定版本的本地副本。没有 `package.json` 的仓库改为运行 `npx -y @canons-dev/canons@latest create --locale zh-CN`：`create` 会选用 `npx` runner，托管规则里写的是带确切版本号的命令（见下文 `runner`）。`create` 会创建 `canons.json`，在 `AGENTS.md` 里插入托管区块（文件不存在就新建），把托管规则写进 `.agents/rules/canons/`，写好 Claude Code 的入口（导入 `AGENTS.md` 的 `CLAUDE.md`，以及 `.claude/rules`、`.claude/skills` 软链接），并写出 `canons.lock.json`。这些文件都要提交。

新建的 `AGENTS.md` 还会带一节**项目设定**，托管规则会读取它：UI 语言（没写时 agent 会在写面向用户的文字前先和你确认）、开发语言（没写时用系统语言）、Git 流程、验证命令、agent 可以使用的测试数据、目录结构（没写时用 `src/`、`doc/`、`tmp/`，其他目录也用三个字母的名字）。已有的 `AGENTS.md` 请在 canons 区块之外补上同样一节。

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

某个 anchor 在 `source` 里找不到时 `verify` 会报错，这样改名后规则不会悄悄指向不存在的东西。

```sh
npx canons scopes src/api/users.ts   # 这个路径适用哪些规则？
npx canons scopes --changed          # 我的改动适用哪些规则？
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `canons create [--locale <code>] [--runner local\|npx] [--adopt]` | 创建 `canons.json` 并执行 `update`。`canons.json` 最后才写，被拒绝时不留下任何文件。 |
| `canons update [--accept-major] [--force] [--adopt]` | 用已安装的版本重写托管区块、托管规则、客户端适配和 lock（不会升级 npm 包）；旧版本留下的 `CLAUDE.md` 软链接会换成导入。默认拒绝覆盖手工修改（`--force` 才覆盖），拒绝破坏性的规则升级（`--accept-major` 才放行）。所有拒绝（包括客户端文件挡路、目录不可写）都发生在写第一个文件之前。`--adopt` 把实体的 `CLAUDE.md`、`.claude/rules`、`.claude/skills` 搬进 `AGENTS.md` / `.agents/` 并换成适配；会覆盖或需要合并不同内容时拒绝。 |
| `canons verify [--strict]` | 确定性检查；有 error 时退出码为 1（`--strict` 下 warning 也算失败）。error：托管内容、适配、字节预算、`AGENTS.md` 和规则里的链接、规则语法和 anchors，以及 Agent Skills 格式（`name` 与目录名一致、小写字母数字加单个连字符、不超过 64 字符；`description` 不超过 1024 字符）。warning：规则或 `SKILL.md` 超过 500 行、技能自带文件的引用超过一层、技能里的死链，以及托管内容之外 `npm run` 的 script 在最近的 `package.json` 里不存在、代码片段里的路径第一层目录存在但后面不存在（跳过 git 忽略的路径、`./`、`../` 开头的路径和 `仓库名:路径` 形式的跨仓引用）、把 `CLAUDE.md` 当作出处引用，以及带日期的历史叙述（日期旁出现"改名""曾"等词）。 |
| `canons scopes [--changed] [--effective] [--json] <路径>...` | 列出 `paths` 命中的规则。没有 `paths` 的规则是全局规则，始终列出。`--effective` 另外列出这些路径实际加载的全部指令文件（从根往下的 `AGENTS.md` 链和命中的规则）及字节数。 |
| `canons latest [--json] [--decline <版本>]` | 对比本仓库用的版本和最新发布的版本（联网）：是否破坏性升级、CHANGELOG 在哪。有新版时退出码为 10。`--decline` 让更新提示不再提该版本。 |
| `canons doctor` | 环境提示（软链接支持、Codex hooks、其他客户端）。 |

## 配置

`canons.json`（每个 key 都是 6 个小写字母；除 `format` 外都是可选项）：

```json
{
  "format": 1,
  "locale": "zh-CN",
  "agents": ["codex", "claude"],
  "runner": "local",
  "source": ["src"],
  "docset": ["doc"],
  "budget": 24576,
  "naming": "^[a-z]{6}$",
  "notify": true
}
```

- `runner` 决定托管规则让 agent 运行什么命令。`local`（有 `package.json` 时的默认值）写 `npx canons`，要求把包装成 dev dependency，缺了 `verify` 会警告。`npx`（没有 `package.json` 时的默认值）写 `npx -y @canons-dev/canons@<版本>`，固定为最近一次运行 `update` 的版本。
- `format` 是 `canons.json` 自身格式的版本。`agents` 列出要接适配的 coding agent（`codex`、`claude`）。规则和技能固定放在 `.agents/rules/`、`.agents/skills/`（C1）。
- `source` 列出规则 `anchors` 必须仍能找到的目录（默认 `["src"]`，不搜索 Markdown 文件）。
- `docset` 追加需要 `verify` 检查 Markdown 链接的目录。`AGENTS.md` 和规则始终检查（报 error），技能也检查（报 warning，因为可能是 vendor 进来的上游原文）。代码里的链接不检查。
- `budget` 只限制根 `AGENTS.md`（默认 24 KiB，最多 32 KiB），给嵌套的指令文件留出 Codex 能加载的空间。
- `naming` 可选，用来约束项目自己的顶层规则文件名。
- `notify: false` 为整个仓库关闭更新提示（见「更新」）。

## 更新

`canons scopes` 和 `canons doctor` 会在 stderr 用一行提示 canons 有新版本，同一版本每天最多一次。agent 每个任务都会跑 `scopes`，所以在用的仓库都能看到；C3 要求 agent 先完成当前任务再问你，你同意后按托管的 `canons` 技能（`.agents/skills/canons/SKILL.md`）升级：升级是独立的改动，没有你的话不提交。

提示不会拖慢或打断命令：命令只读 `~/.cache/canons`（或 `$XDG_CACHE_HOME`、`CANONS_CACHE_DIR`）里的一个小缓存。缓存超过一天时，起一个脱离的后台进程向 npm registry 查 `latest`（遵循 `npm_config_registry`）然后退出；失败（断网、沙箱、代理）就什么也不显示，第二天再试。stdout 和退出码不变，`verify` 从不联网。设置了 `CI`、`CANONS_NO_UPDATE_CHECK=1` 或 `"notify": false` 时关闭。

## 客户端

| 客户端 | 如何读到指令 |
| --- | --- |
| Codex | 原生从仓库根往下读到工作目录的各级 `AGENTS.md`，并读取 `.agents/skills/`。交互式客户端启动前会要求你信任该目录。 |
| Claude Code | `CLAUDE.md` 内容是 `@AGENTS.md`（导入）；`.claude/rules -> ../.agents/rules`、`.claude/skills -> ../.agents/skills`；规则按 `paths` 原生加载。 |
| Cursor、GitHub Copilot | 原生读取 `AGENTS.md`。 |
| Gemini CLI | 把 `context.fileName` 设为 `["AGENTS.md"]`。 |

Windows 用户在 clone 前先启用软链接（开启开发者模式后执行 `git config core.symlinks true`），供 `.claude/rules`、`.claude/skills` 使用；canons 不会退化成复制文件。

## 版本

规则内容遵循 semver。**major** 版本会新增或收紧红线，或改变使用方必须做的事；`0.x` 期间 minor 版本按 major 对待。遇到破坏性升级时 `canons update` 会停下，直到你加上 `--accept-major`，让规则变更和代码一样经过 review。

## 安全

canons 运行时从不联网拉取规则：`update` 只从已安装的包里复制文件，写出的内容也不会被执行。发布只经 GitHub Actions 进行，并附带 npm provenance。详见 [SECURITY.md](.github/SECURITY.md)。

## 协议

[Apache-2.0](LICENSE)
