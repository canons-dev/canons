## Agent conventions (canons)

These apply to every coding agent working in this repository (Codex, Claude Code, Cursor, Copilot and others). Project rules outside this block add to them; a project rule may tighten C1, C3, C8, C9, C11, C12 and C20 but never relax them.

### Sources of truth and loading

- **C1** Edit only the real sources: `AGENTS.md`, the rules directory (`.agents/rules/`) and the skills directory (`.agents/skills/`). Client entry points such as `CLAUDE.md`, `.claude/rules` and `.claude/skills` are relative symlinks to them. Never copy their content into a second file and never reverse a link.
- **C2** Three tiers: this root file holds global red lines; path-scoped rules in the rules directory hold subsystem guards (`paths` frontmatter); skills hold multi-step procedures loaded on demand. Global red lines never move down a tier.
- **C3** Before editing, run `npx canons scopes <file-or-dir>...` (pass the planned path for new files) and read every rule it lists. Before finishing, run `npx canons scopes --changed` against the actual diff. No match does not mean no constraints: this file still applies. A client loading rules natively is a convenience, not a substitute for the query.
- **C4** Keep this file within its byte budget (`npx canons verify` enforces it). To make room, condense wording or move rationale into docs; never delete a red line.

### Knowledge and documents

- **C5** Conventions an agent must remember go into repository files reviewed through git, never only into a client's private memory. Pitfalls that apply across modules go into one lessons file (symptom, cause, how to avoid, invariant), merged into an existing section when one fits.
- **C6** Docs and rules state current knowledge and its reasons, not history. Facts the code shows directly get a pointer, not a copy. Invariants that must hold are guarded by tests. Each constraint is written in exactly one place.
- **C7** Temporary files, one-off scripts and in-flight plans go in the temporary directory (`tmp/` unless C17 says otherwise; git-ignored). Reusable tools are committed. Docs and code never point at files there.

### Collaboration and authority

- **C8** Never change Git state (commit, push, pull, fetch, merge, rebase, reset, stash, tag, switching branches, opening a PR) without an explicit instruction from the user. Read-only commands are fine. Steps of an already authorized task need no second confirmation.
- **C9** Run `git status` before changing anything and never overwrite someone else's in-progress changes; ask before editing a file another session is changing. Prefer a separate worktree for parallel work; worktrees do not isolate databases, ports or other shared resources.
- **C10** When requirements, behavior, interfaces or naming are genuinely ambiguous, or a user decision conflicts with these rules, say so and wait for a decision. Offer 2–4 mutually exclusive options, the recommended one first with its cost.
- **C11** Mark unverified judgements as unverified, with their basis and how to verify them. Label second-hand conclusions with their source; never promote them to fact.
- **C12** A missing capability (no sub-agents, no browser, no question UI) changes how you work, not what is required: required confirmations and verification are never skipped, and anything left unverified is reported as such.
- **C13** When handing work to another agent, write down the goal, scope, changed files, decisions, verification results, remaining work and open decisions in `tmp/`, and pass it on explicitly. Durable knowledge goes back into docs.
- **C14** End every stage with a settlement verdict: is this session done and safe to archive? If not, list the open items as a table (item | status or blocker | owner | next step). Unmerged PRs, pending deploys, pending re-tests and pending user decisions all count as open.

### Finishing a change

- **C15** After changing code, update in the same change: tests for logic that can be tested automatically, docs, and any rule whose guarded invariant the change touches. Report what was updated and, for anything not updated, why not.

### Language and layout

- **C16** `AGENTS.md` records, outside this block, the project's UI language (every user-facing string: buttons, labels, placeholders, empty states, errors, examples, defaults and notifications) and its developer language. When the UI language is not recorded, confirm it with the developer before writing user-facing text, then record the answer. Talk with developers, and write commit messages, pull request descriptions, docs and code comments, in the recorded developer language; when none is recorded, use the system language. Identifiers, paths, commands and technical terms keep their original form.
- **C17** Follow the directory layout recorded in `AGENTS.md`. Without one, the default is: source in `src/`, docs in `doc/`, temporary files in `tmp/` (git-ignored), and every other top-level directory also gets a three-letter name (for example `out/`, `ops/`, `bin/`). The root holds only repository-level configuration and entry files such as `README.md` and `AGENTS.md`.

### Working in the codebase

- **C18** Name new files and directories after their neighbours: first match the length (the same number of letters, extension excluded), then part of speech, singular or plural, segmentation, case and separators. When neighbours disagree, follow the larger and more recent group; ask when genuinely unsure.
- **C19** Before changing shared semantics (an API parameter and its callers, a hook and its consumers, a constant and its uses), review every call site. When a change creates a coupling that must stay in step across several places, record it as a sync point in the docs.
- **C20** Other repositories (siblings, reference implementations, dependencies checked out nearby) may be read but not changed without the user's permission. In a worktree, do not assume `../` is a sibling repository; confirm the actual path.
- **C21** Capabilities the project has deliberately deferred or declined are listed in its docs; do not add them on the side. When something looks missing, check that list before adding it.
