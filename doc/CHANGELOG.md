# Changelog

## 0.1.2 (2026-11-16)

- READMEs: a prompt to paste into a coding agent that installs or updates canons.
- The package now ships `doc/CHANGELOG.md`, so agents can read upgrade notes offline.
- `doctor` and the READMEs no longer claim that Codex skips `AGENTS.md` in an untrusted project: `codex exec` reads it either way.

## 0.1.1 (2026-11-16)

- Released through npm trusted publishing (OIDC). No changes to the CLI or rules.

## 0.1.0 (2026-11-16)

- Published as `@canons-dev/canons`; the command is `canons`.

- `canons init`, `sync`, `check`, `scopes`, `doctor`.
- Core rules: managed `AGENTS.md` block (C1–C15), `layout` (L1–L6) and `vendor` (V1–V4) path-scoped rules, in English and Simplified Chinese.
- Client adapters for Codex (native) and Claude Code (relative symlinks).
