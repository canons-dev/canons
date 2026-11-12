---
paths:
  - "AGENTS.md"
  - "**/AGENTS.md"
  - "CLAUDE.md"
  - ".agents/**"
  - ".claude/**"
  - ".codex/**"
  - "canons.json"
  - "canons.lock.json"
---

# 指令布局（canons）

- **L1** `AGENTS.md` 里的区块和 `.agents/rules/canons/` 下的文件由 `canons sync` 生成。项目改动写在它们之外，或者向上游提议；`canons check` 会拒绝手工修改。
- **L2** 规则 frontmatter 用 YAML block list 声明 `paths`，支持 `*`、`?`、`**`（`**/` 也匹配零层目录）；圆括号和方括号按字面量处理。空列表或无法解析的列表报错。没有 `paths` 的规则是全局规则，但不能借此把红线移出 `AGENTS.md`。
- **L3** 规则里的链接从规则文件自己的目录解析（例如 `../../docs/x.md`），不是从仓库根解析。
- **L4** 仓库里不放 `AGENTS.override.md`：Codex 会读它而不读 `AGENTS.md`。允许嵌套的 `AGENTS.md`，但从根到任一目录的整条链合计必须低于 32 KiB，否则 Codex 会静默丢弃超出部分。
- **L5** 客户端配置与权限留在各自客户端的目录里；一个客户端的允许清单不构成对另一个客户端的授权。新客户端只接薄适配（相对软链接或一行指针），绝不复制内容。
- **L6** 技能用通用语言描述所需能力；客户端专属的参数、界面或委派要写明替代路径，必需的确认与验证仍然必须做。
