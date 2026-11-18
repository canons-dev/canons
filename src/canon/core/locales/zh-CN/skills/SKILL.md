---
name: canons
description: 用户同意后，把 canons（AGENTS.md 与 .agents/ 里的通用 agent 约定）升级到新版本。canons 命令提示有新版本，或用户要求更新 canons 时使用。
---

# 升级 canons

要达到的结果：仓库用上新版 canons，升级作为一个独立、可 review 的改动落地，并且没有用户同意什么都不做。

- **同意。** 用户同意后才开始。破坏性升级（以 `npx canons latest` 的判断为准）要先把新旧版本之间的 CHANGELOG 条目给用户看，再得到第二次同意。用户拒绝时运行 `npx canons latest --decline <版本>`，同一版本不再提起。
- **独立改动。** 升级不混进当前任务的 diff：客户端支持时用独立的 session 或 worktree（例如新开一个 Claude Code session，或在独立 worktree 里的子 agent）；不支持时等当前任务结束，从最新上游新开分支再做（C9）。
- **步骤**，例如：
  1. `npx canons latest` 显示已装版本、最新版本、是否破坏性升级以及 CHANGELOG 位置。
  2. 有 package.json：`npm install --save-dev @canons-dev/canons@<版本>`；没有就把后面的命令写成 `npx -y @canons-dev/canons@<版本>`。
  3. 运行 `update`（第二次同意后才加 `--accept-major`），再运行 `verify --strict` 和项目自己的检查。
- **被挡住时**（没有网络，或沙箱保护 `.agents/`，Codex 就是这样）：说明卡在哪、用户可以怎么做，然后停下。当前任务不受影响。
- **Git** 按 C8；同意升级不等于同意提交。
- **汇报**按 C14，附上版本、`git diff --stat` 和验证结果。
