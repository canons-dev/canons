# Changelog

## Unreleased

- Update notice: `scopes` and `doctor` mention a newer canons version on stderr, at most once a day per version. They only read a local cache; a detached background process refreshes it daily from the npm registry, and every failure is silent. Off in CI, with `CANONS_NO_UPDATE_CHECK=1` or with the new `canons.json` key `updateCheck: false`.
- New command `canons latest [--json] [--decline <version>]`.
- canons now manages a skill, `.agents/skills/canons/SKILL.md`: how an agent upgrades canons once the user agrees, as a separate change and without committing unasked. Managed skills are locked and verified like managed rules.
- C3: when `scopes` mentions a newer version, finish the current task and ask the user; on consent follow the `canons` skill, on refusal run `canons latest --decline <version>`.

## 0.2.0 (2026-11-17)

Rule content changes: upgrade with `canons update --accept-major` and review the new block.

- The managed rules state outcomes instead of steps: each item says what it wants and why, and any method it names (`git status`, the option count, the settlement table, the handoff fields) is a reference an agent may improve on. Boundaries that are the user's or the project's call (C8, C20, C21) now say so and why. Rule ids and scope are unchanged.
- C9 asks agents to start from the latest upstream code (fetch, then fast-forward or branch from the fresh base) and to ask the user when that would need a merge or rebase or touch someone else's changes. C8 no longer lists `fetch`, and exempts this sync.
- The managed block is condensed: with outcomes and reasons it is still slightly smaller than in 0.1.5, leaving room in the root budget.
- `create` and `update` take `--adopt`: a real `CLAUDE.md`, `.claude/rules` or `.claude/skills` is moved into `AGENTS.md` / `.agents/` and replaced by its link. It refuses when that would overwrite or merge differing content. `doctor` points at it.
- `verify` checks links in every `AGENTS.md` (errors) and in skills (warnings), not only in rules; links inside code are ignored. New `canons.json` key `docDirs` adds directories to check.
- C14 asks for an explicit settlement verdict at the end of every stage, non-interactive runs included, and counts uncommitted changes and an unsynced upstream as open. In acceptance runs Codex had stated no status at all; with this wording it states done or pending, what remains and who acts next.
- Repository: npm scripts and GitHub workflows use six-letter names (`bundle`, `typing`, `checks`; workflow `checks.yml`; the publish workflow keeps `release.yml` until the npm trusted publisher can be switched to `upload.yml`); `tsconfig.json` extends `@tsconfig/node22` and `@tsconfig/node-ts`.

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
