# Changelog

## 0.2.3 (2026-11-18)

Breaking for `canons.json` and `canons.lock.json`, published as a patch; there is no automatic migration. Rename the keys below in both files, then run `canons update`.

- `canons.json` keys have six lowercase letters: `version` → `format`, `clients` → `agents`, `sourceDirs` → `source`, `docDirs` → `docset`, `budgetBytes` → `budget`, `ruleNamePattern` → `naming`, `updateCheck` → `notify`. `rulesDir`, `skillsDir`, `presets` and `hooks` are removed: rules and skills always live in `.agents/rules/` and `.agents/skills/`. Old keys are rejected as unknown.
- `canons.lock.json` keys likewise: `lockfileVersion` → `format`, `block` → `digest`, `files` → `hashes`. A lock with the old keys is reported as invalid; rename its keys by hand.

## 0.2.2 (2026-11-18)

This release changes the managed rules (new items C22–C28, tightened C6, C8, C10, C11, C15, C20) and the `CLAUDE.md` adapter, but is published as a patch, so `update` applies it without `--accept-major`. Review the new block after upgrading, and check that the root `AGENTS.md` still fits its budget.

- New C22: do what was asked, at the scope asked. A one-off request is not a standing rule, a decision needs no guard against its reversal, and extras wait until the user asks. C22 also asks for surgical changes (every changed line traces to the request, the surrounding style kept, only the change's own leftovers removed) and for stated assumptions and simpler alternatives, with no speculative abstraction, configuration or error handling.
- C15: decide before starting which checks will show the change works, and run them before finishing. `AGENTS.md` records the exact build, test and lint commands and how to run one test; a new `AGENTS.md` gets a Verification line under Project settings.
- C6: one term per concept; leave out what agents can infer; a rule that allows no exception becomes a deterministic check instead of louder wording.
- New C23: long or complex work that would crowd or steer the main conversation goes to a sub-agent or separate session when the client offers one; take back the result, then close or archive it and say so in the settlement.
- New C24: replies lead with results, key conclusions and the user's decisions; repeated explanations, needless disclaimers, generic reminders and unrelated alternatives are left out, and supplements worth keeping go in a file. Unverified marks (C11) and the settlement (C14) stay.
- C8: `AGENTS.md` records the Git flow (base branch, PR target, branch prefix, who merges). C10: when the sound long-term solution costs clearly more than a shortcut, present both instead of taking the shortcut. C11: never invent results; numbers and conclusions cite their source. C20: refer to another repository's file as `repo:path`.
- New section "Data and operation": C25 failures reach a person (log-only handling and user-input failures count); C26 tests and verification use only designated test data and accounts, named in `AGENTS.md`; C27 changes stay compatible with what is already running (shared databases, interfaces and configuration change by addition); C28 secrets stay out of code, docs and instruction files, and only values that differ between environments go into environment variables.
- A new `AGENTS.md` gets Git flow and Test data lines under Project settings.
- `verify` also warns, in project instruction text, about citing `CLAUDE.md` as a source and about dated history (a date next to words such as "renamed", "formerly", "曾", "改为").
- Condensed without changing meaning: C8 and C16 list representative examples, C13 says "the temporary directory" (C7) instead of `tmp/`, L2 no longer repeats C2, and the managed skill refers to C8 and C14 instead of restating them.
- Fixes: `verify` reports a corrupt `canons.lock.json` instead of crashing; a `CLAUDE.md` directory is refused before anything is written; npm flags before a script name (`npm run -s build`) are not taken for the script; a quoted skill `description` containing ` #` is read whole.
- The new and extended items are worded tightly so the zh-CN block grows by about 2.3 KB in total; check that your root `AGENTS.md` still fits its budget after upgrading.
- `CLAUDE.md` is now a one-line file importing `AGENTS.md` (`@AGENTS.md`) instead of a symlink. `update` replaces the old symlink; `verify` reports a symlink or any other content. `.claude/rules` and `.claude/skills` stay symlinks.
- `verify` checks skills against the Agent Skills format (errors: frontmatter, `name` matching its directory and its character rules, `description` length) and warns about rules and `SKILL.md` over 500 lines, bundled skill files linking more than one level deep, and, in project instruction text, `npm run` scripts missing from the nearest `package.json` and code-span paths that no longer exist.
- `scopes --effective` lists every instruction file loaded for the given paths (the `AGENTS.md` chain and matched rules) with byte counts.

## 0.2.1 (2026-11-17)

This release changes the managed rules (C3) and adds a managed skill, but is published as a patch, so `update` applies it without `--accept-major`. Review the new block and `.agents/skills/canons/SKILL.md` after upgrading.

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
