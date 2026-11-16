# canons

One source of truth for the instructions your coding agents follow — `AGENTS.md`, path-scoped rules and skills — shared by Codex, Claude Code and other clients, and kept honest by deterministic checks.

[简体中文](README.zh-CN.md)

## Why

Teams that use more than one coding agent end up with `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` and friends drifting apart, rules that only one client loads, and red lines that quietly disappear when someone trims a file. canons gives every repository the same layout and a small CLI that enforces it:

- **One copy of every instruction.** `AGENTS.md`, `.agents/rules/` and `.agents/skills/` are the only real files; client entry points are relative symlinks.
- **Path-scoped rules for every client.** Rules declare `paths` in frontmatter. Claude Code loads them natively; for every other client the root instructions require `canons scopes <path>` before editing and `canons scopes --changed` before finishing.
- **A shared baseline.** A managed block in `AGENTS.md` carries agent conventions (Git authority, verification, handoffs, documentation hygiene). Your project rules live outside the block.
- **Deterministic guards.** `canons verify` catches hand-edited managed content, copies instead of links, broken rule links, an `AGENTS.override.md` that would make Codex skip `AGENTS.md`, and instruction chains over the 32 KiB Codex reads.

## Set up with your coding agent

Paste this into Codex, Claude Code or any other coding agent, from the root of your repository. Paste it again later to update: the same steps install canons the first time and update it afterwards.

```text
Install or update canons (https://github.com/canons-dev/canons) in this repository. canons keeps coding-agent instructions in one place: AGENTS.md, .agents/rules/ and .agents/skills/.

1. Run `git status`. If there are uncommitted changes, list them and ask me before going on.
2. Check that Node 22 or newer is available.
3. If the repository has a package.json, run `npm install --save-dev @canons-dev/canons@latest`. If it has none, do not create one: use `npx -y @canons-dev/canons@latest` wherever the steps below say `npx canons`.
4. If canons.json does not exist, run `npx canons create` (add `--locale zh-CN` only if I ask for Chinese rules). Otherwise run `npx canons update`.
5. If the command stops:
   - On a breaking upgrade: show me the entries between the old and new versions in node_modules/@canons-dev/canons/doc/CHANGELOG.md (without a local install: https://github.com/canons-dev/canons/blob/main/doc/CHANGELOG.md), and run `npx canons update --accept-major` only after I agree.
   - On hand edits to managed content: show me the edits. Do not pass `--force` unless I say so.
   - Because CLAUDE.md, .claude/rules or .claude/skills is a real file or directory: move its content into AGENTS.md (outside the canons block), .agents/rules/ or .agents/skills/, then rerun. Ask me before deleting anything.
   - Because your sandbox may not write to .agents/ (the Codex sandbox protects it): ask me to approve running the command outside the sandbox, or to run it myself.
6. Run `npx canons verify` and fix what it reports.
7. Read the canons block in AGENTS.md and follow it from now on. If AGENTS.md has no project settings yet (UI language, developer language, directory layout), ask me for the UI language and record all three outside the block.
8. Change nothing beyond what these steps need. Summarize what changed (`git diff --stat`) and anything you need from me. Do not commit unless I ask.
```

## Quick start

Requires Node 22 or newer and a git repository.

```sh
npm install --save-dev @canons-dev/canons
npx canons create               # or: npx canons create --locale zh-CN
npx canons verify
```

The package installs a `canons` command; install it as a dev dependency so that `npx canons`, which the managed rules tell agents to run, resolves to the pinned local copy. In a repository without `package.json`, run `npx -y @canons-dev/canons@latest create` instead: `create` then picks the `npx` runner, and the managed rules name the exact published version (see `runner` below). `create` creates `canons.json`, inserts the managed block into `AGENTS.md` (creating it if needed), writes the managed rules to `.agents/rules/canons/`, links the Claude Code entry points and writes `canons.lock.json`. Commit all of them.

A newly created `AGENTS.md` also gets a **Project settings** section. The managed rules read it: the UI language (agents confirm it with you before writing user-facing text if it is missing), the developer language (otherwise the system language) and the directory layout (otherwise `src/`, `doc/`, `tmp/` and other three-letter names). In an existing `AGENTS.md`, add the same section outside the canons block.

Then add your own rules:

```md
<!-- .agents/rules/apis.md -->
---
paths:
  - "src/api/**"
anchors:              # optional: code symbols this rule pins
  - parseRequest
---

# API handlers

- Validate every request body at the boundary with `parseRequest`.
```

`verify` fails when an anchor no longer appears in `sourceDirs`, so a rename cannot silently leave a rule pointing at nothing.

```sh
npx canons scopes src/api/users.ts   # which rules apply here?
npx canons scopes --changed          # which rules apply to my diff?
```

## Commands

| Command | What it does |
| --- | --- |
| `canons create [--locale <code>] [--runner local\|npx]` | Create `canons.json` and run `update`. Writes `canons.json` last, so a refused run leaves nothing behind. |
| `canons update [--accept-major] [--force]` | Rewrite, from the installed version (it does not upgrade the package), the managed block, managed rules, client links and lock. Refuses to overwrite hand edits unless `--force`; refuses breaking rule upgrades unless `--accept-major`. Every refusal, including client files in the way and directories it cannot write, comes before the first write. |
| `canons verify [--strict]` | Deterministic checks; exit code 1 on errors (or on warnings with `--strict`). |
| `canons scopes [--changed] [--json] <path>...` | List the rules whose `paths` match. Rules without `paths` are global and always listed. |
| `canons doctor` | Environment hints (symlink support, Codex hooks, other clients). |

## Configuration

`canons.json` (all keys except `version` are optional):

```json
{
  "version": 1,
  "locale": "en",
  "clients": ["codex", "claude"],
  "runner": "local",
  "rulesDir": ".agents/rules",
  "skillsDir": ".agents/skills",
  "sourceDirs": ["src"],
  "budgetBytes": 24576,
  "ruleNamePattern": "^[a-z-]+$"
}
```

- `runner` sets the command the managed rules tell agents to run. `local` (the default when `package.json` exists) writes `npx canons` and needs the package as a dev dependency; `verify` warns when it is missing. `npx` (the default without `package.json`) writes `npx -y @canons-dev/canons@<version>`, pinned to the version that last ran `update`.
- `sourceDirs` lists where rule `anchors` must still appear (default `["src"]`; Markdown files are not searched).
- `budgetBytes` limits the root `AGENTS.md` alone (default 24 KiB, at most 32 KiB) so nested instruction files still fit in what Codex loads.
- `ruleNamePattern` optionally constrains the names of your own top-level rule files.
- `presets` and `hooks` are reserved for later versions and must stay empty / `false`.

## Clients

| Client | How it sees the instructions |
| --- | --- |
| Codex | Reads `AGENTS.md` from the repository root down to the working directory and `.agents/skills/` natively. The interactive client asks you to trust the folder before it starts. |
| Claude Code | `CLAUDE.md -> AGENTS.md`, `.claude/rules -> ../.agents/rules`, `.claude/skills -> ../.agents/skills`; rules load natively by `paths`. |
| Cursor, GitHub Copilot | Read `AGENTS.md` natively. |
| Gemini CLI | Set `context.fileName` to `["AGENTS.md"]`. |

On Windows enable symlinks (`git config core.symlinks true` with Developer Mode) before cloning; canons never falls back to copies.

## Versioning

Rule content follows semver. A **major** release adds or tightens a red line, or changes what consumers must do; while in `0.x`, a minor release counts as major. `canons update` stops on a breaking upgrade until you pass `--accept-major`, so rule changes get the same review as code.

## Security

canons never fetches rules at run time: `update` copies files from the installed package only, and nothing it writes is executed. Releases are published from GitHub Actions with npm provenance. See [SECURITY.md](.github/SECURITY.md).

## License

[Apache-2.0](LICENSE)
