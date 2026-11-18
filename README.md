# Canons

One source of truth for the instructions your coding agents follow — `AGENTS.md`, path-scoped rules and skills — shared by Codex, Claude Code and other clients, and kept honest by deterministic checks.

[简体中文](README.zh-CN.md)

## Why

Teams that use more than one coding agent end up with `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` and friends drifting apart, rules that only one client loads, and red lines that quietly disappear when someone trims a file. canons gives every repository the same layout and a small CLI that enforces it:

- **One copy of every instruction.** `AGENTS.md`, `.agents/rules/` and `.agents/skills/` are the only real files; client entry points are thin adapters (`CLAUDE.md` holds only the import `@AGENTS.md`; `.claude/rules` and `.claude/skills` are relative symlinks).
- **Path-scoped rules for every client.** Rules declare `paths` in frontmatter. Claude Code loads them natively; for every other client the root instructions require `canons scopes <path>` before editing and `canons scopes --changed` before finishing.
- **A shared baseline.** A managed block in `AGENTS.md` carries agent conventions (Git authority, verification, handoffs, documentation hygiene). Your project rules live outside the block.
- **Deterministic guards.** `canons verify` catches hand-edited managed content, copies instead of adapters, broken links in `AGENTS.md`, rules and skills, an `AGENTS.override.md` that would make Codex skip `AGENTS.md`, instruction chains over the 32 KiB Codex reads, skills that break the [Agent Skills](https://agentskills.io/specification) format, and project instructions that name npm scripts or paths that no longer exist.

## Set up with your coding agent

Paste this into Codex, Claude Code or any other coding agent at the root of your repository. Paste it again later to update.

```text
Install or update canons (https://github.com/canons-dev/canons) in this repository, then follow its block in AGENTS.md.

- Command: with a package.json, add @canons-dev/canons@latest as a dev dependency and use `npx canons`; without one, use `npx -y @canons-dev/canons@latest`. Needs Node 22+.
- First time: `create --adopt` (it moves an existing CLAUDE.md, .claude/rules or .claude/skills into place). Later: `update`. Then `verify`, and fix what it reports.
- Ask me first before you build on my uncommitted changes, accept a breaking upgrade (show me the CHANGELOG entries), discard hand edits to managed content, delete anything, or run outside your sandbox (the Codex sandbox protects .agents/).
- If AGENTS.md has no project settings yet, ask me for the UI language, then record UI language, developer language and directory layout outside the canons block.
- Change nothing else and do not commit. End with what changed and what you need from me.
```

## Quick start

Requires Node 22 or newer and a git repository.

```sh
npm install --save-dev @canons-dev/canons
npx canons create               # or: npx canons create --locale zh-CN
npx canons verify
```

The package installs a `canons` command; install it as a dev dependency so that `npx canons`, which the managed rules tell agents to run, resolves to the pinned local copy. In a repository without `package.json`, run `npx -y @canons-dev/canons@latest create` instead: `create` then picks the `npx` runner, and the managed rules name the exact published version (see `runner` below). `create` creates `canons.json`, inserts the managed block into `AGENTS.md` (creating it if needed), writes the managed rules to `.agents/rules/canons/`, writes the Claude Code entry points (`CLAUDE.md` importing `AGENTS.md`, and links for `.claude/rules` and `.claude/skills`) and writes `canons.lock.json`. Commit all of them.

A newly created `AGENTS.md` also gets a **Project settings** section. The managed rules read it: the UI language (agents confirm it with you before writing user-facing text if it is missing), the developer language (otherwise the system language), the Git flow, the verification commands, the test data agents may use, and the directory layout (otherwise `src/`, `doc/`, `tmp/` and other three-letter names). In an existing `AGENTS.md`, add the same section outside the canons block.

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

`verify` fails when an anchor no longer appears in `source`, so a rename cannot silently leave a rule pointing at nothing.

```sh
npx canons scopes src/api/users.ts   # which rules apply here?
npx canons scopes --changed          # which rules apply to my diff?
```

## Commands

| Command | What it does |
| --- | --- |
| `canons create [--locale <code>] [--runner local\|npx] [--adopt]` | Create `canons.json` and run `update`. Writes `canons.json` last, so a refused run leaves nothing behind. |
| `canons update [--accept-major] [--force] [--adopt]` | Rewrite, from the installed version (it does not upgrade the package), the managed block, managed rules, client adapters and lock. A `CLAUDE.md` symlink from earlier versions is replaced by the import. Refuses to overwrite hand edits unless `--force`; refuses breaking rule upgrades unless `--accept-major`. Every refusal, including client files in the way and directories it cannot write, comes before the first write. `--adopt` moves a real `CLAUDE.md`, `.claude/rules` or `.claude/skills` into `AGENTS.md` / `.agents/` and puts the adapter in its place; it refuses when that would overwrite or merge differing content. |
| `canons verify [--strict]` | Deterministic checks; exit code 1 on errors (or on warnings with `--strict`). Errors: managed content, adapters, budgets, links in `AGENTS.md` and rules, rule syntax and anchors, and the Agent Skills format (`name` matching its directory, lowercase with single hyphens, at most 64 characters; a `description` of at most 1024). Warnings: rules or `SKILL.md` over 500 lines, a skill's bundled files linking more than one level deep, broken links in skills, and, outside managed content, `npm run` scripts missing from the nearest `package.json` or code-span paths whose first directory exists but the rest does not (git-ignored paths, `./`, `../` and `repo:path` references are skipped), citations of `CLAUDE.md` as a source, and dated history (a date next to words such as "renamed" or "formerly"). |
| `canons scopes [--changed] [--effective] [--json] <path>...` | List the rules whose `paths` match. Rules without `paths` are global and always listed. `--effective` also lists every instruction file loaded for those paths, the `AGENTS.md` chain from the root down and the matched rules, with byte counts. |
| `canons latest [--json] [--decline <version>]` | Compare this repository's version with the newest published one (network): breaking or not, and where the changelog is. Exit code 10 when a newer version exists. `--decline` stops the update notice for that version. |
| `canons doctor` | Environment hints (symlink support, Codex hooks, other clients). |

## Configuration

`canons.json` (every key has six lowercase letters; all except `format` are optional):

```json
{
  "format": 1,
  "locale": "en",
  "agents": ["codex", "claude"],
  "runner": "local",
  "source": ["src"],
  "docset": ["doc"],
  "budget": 24576,
  "naming": "^[a-z-]+$",
  "notify": true
}
```

- `runner` sets the command the managed rules tell agents to run. `local` (the default when `package.json` exists) writes `npx canons` and needs the package as a dev dependency; `verify` warns when it is missing. `npx` (the default without `package.json`) writes `npx -y @canons-dev/canons@<version>`, pinned to the version that last ran `update`.
- `format` is the version of the `canons.json` format itself. `agents` lists the coding agents that get adapters (`codex`, `claude`). Rules and skills always live in `.agents/rules/` and `.agents/skills/` (C1).
- `source` lists where rule `anchors` must still appear (default `["src"]`; Markdown files are not searched).
- `docset` adds directories whose Markdown links `verify` checks. `AGENTS.md` files and rules are always checked (errors), skills too (warnings, since they may be vendored upstream text). Links inside code are ignored.
- `budget` limits the root `AGENTS.md` alone (default 24 KiB, at most 32 KiB) so nested instruction files still fit in what Codex loads.
- `naming` optionally constrains the names of your own top-level rule files.
- `notify: false` turns the update notice off for the repository (see Updates).

## Updates

`canons scopes` and `canons doctor` mention a newer canons version in one line on stderr, at most once a day per version. Agents run `scopes` on every task, so the notice reaches every repository in use; C3 tells them to finish the current task, ask you, and on your consent follow the managed `canons` skill (`.agents/skills/canons/SKILL.md`), which upgrades in a separate change and never commits without your say.

The notice never slows a command down or breaks it: the command only reads a small cache in `~/.cache/canons` (`$XDG_CACHE_HOME`, or `CANONS_CACHE_DIR`). When the cache is a day old, a detached background process asks the npm registry for the `latest` version (honoring `npm_config_registry`) and exits; if it fails (offline, a sandbox, a proxy), nothing is shown and it tries again the next day. Stdout and exit codes never change, and `verify` never touches the network. It is off when `CI` is set, with `CANONS_NO_UPDATE_CHECK=1`, or with `"notify": false`.

## Clients

| Client | How it sees the instructions |
| --- | --- |
| Codex | Reads `AGENTS.md` from the repository root down to the working directory and `.agents/skills/` natively. The interactive client asks you to trust the folder before it starts. |
| Claude Code | `CLAUDE.md` holds `@AGENTS.md` (an import); `.claude/rules -> ../.agents/rules`, `.claude/skills -> ../.agents/skills`; rules load natively by `paths`. |
| Cursor, GitHub Copilot | Read `AGENTS.md` natively. |
| Gemini CLI | Set `context.fileName` to `["AGENTS.md"]`. |

On Windows enable symlinks (`git config core.symlinks true` with Developer Mode) before cloning, for the `.claude/rules` and `.claude/skills` links; canons never falls back to copies.

## Versioning

Rule content follows semver. A **major** release adds or tightens a red line, or changes what consumers must do; while in `0.x`, a minor release counts as major. `canons update` stops on a breaking upgrade until you pass `--accept-major`, so rule changes get the same review as code.

## Security

canons never fetches rules at run time: `update` copies files from the installed package only, and nothing it writes is executed. Releases are published from GitHub Actions with npm provenance. See [SECURITY.md](.github/SECURITY.md).

## License

[Apache-2.0](LICENSE)
