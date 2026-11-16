# Changelog

## 0.1.5 (2026-11-16)

- `verify` resolves rule links whose path holds parentheses, such as framework route groups (`../../src/app/(app)/page.tsx`, bare or in `<...>`), and links with a title.

## 0.1.4 (2026-11-16)

This release changes the managed rules and renames commands, but is published as a patch, so `update` applies it without `--accept-major`. Review the new rules after upgrading.

- Commands renamed so every command has six letters: `init` → `create`, `sync` → `update`, `check` → `verify`. The old names stop with a message naming the new one.
- New managed rules: C16 language settings (UI language confirmed with the developer and recorded in `AGENTS.md`; developer language recorded there, else the system language), C17 directory layout (recorded in `AGENTS.md`, else `src/`, `doc/`, `tmp/` and other three-letter names), C18 naming after neighbours (length first), C19 call sites and sync points, C20 other repositories are read-only, C21 deliberate non-goals. C5 adds a shared lessons file; C7 follows the recorded temporary directory. C20 joins the clauses projects may tighten but not relax.
- `create` writes a "Project settings" section into a new `AGENTS.md`, in the chosen locale.
- Rule frontmatter accepts `anchors`: code symbols the rule pins. `verify` fails when one no longer appears in `sourceDirs` (new `canons.json` key, default `["src"]`).

## 0.1.3 (2026-11-16)

- `runner` in `canons.json`: `local` (`npx canons`, needs the dev dependency) or `npx` (`npx -y @canons-dev/canons@<version>`, no package.json needed). `init` picks `npx` when the repository has no package.json; `check` warns when the local runner's package is missing.
- `doctor` and the READMEs note that interactive Codex asks to trust the folder before it starts.
- `init` and `sync` find every refusal, including client files in the way and directories they cannot write, before writing anything; `init` writes `canons.json` last.

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
