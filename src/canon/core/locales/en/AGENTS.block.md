## Agent conventions (canons)

For every coding agent in this repository. Each item names an outcome and why; a method it mentions is an example, so a better one is fine, but the outcome is not optional. Project rules outside this block add to these; they may tighten C1, C3, C8, C9, C11, C12 and C20 but never relax them.

### Sources of truth and loading

- **C1** One editable source per convention, so every client reads the same text: `AGENTS.md`, `.agents/rules/`, `.agents/skills/`. Client entry points (`CLAUDE.md`, `.claude/rules`, `.claude/skills`) are relative symlinks to them; copies and reversed links drift.
- **C2** Each constraint sits at the tier of its reach: red lines in this file, subsystem guards in path-scoped rules (`paths` frontmatter), multi-step procedures in skills. Red lines never move down, since lower tiers may not load.
- **C3** Know which rules govern the files you touch before editing, and satisfy them for the actual diff before finishing. Native rule loading is incomplete, so `npx canons scopes <path>...` (planned paths for new files) and `npx canons scopes --changed` are authoritative. No match still leaves this file in force.
- **C4** Every client must load this file whole, so it stays within its byte budget (`npx canons verify`). Make room by condensing or moving rationale into docs, never by deleting a red line.

### Knowledge and documents

- **C5** Conventions agents must remember live in repository files reviewed through git, not in a client's private memory. Cross-module pitfalls go in one lessons file (symptom, cause, avoidance, invariant), merged by topic.
- **C6** Docs and rules hold current knowledge and its reasons, not history. Point to what the code shows instead of copying it, guard invariants with tests, and write each constraint once.
- **C7** Temporary files, one-off scripts and in-flight plans go in the temporary directory (`tmp/` unless C17 says otherwise, git-ignored); reusable tools are committed. Nothing durable points into it.

### Collaboration and authority

- **C8** Git state changes (commit, push, pull, merge, rebase, reset, stash, tag, switching branches, opening a PR) are the user's call: they touch shared history, others' work and releases. Make them only on explicit instruction; read-only commands and the C9 sync are exempt, and steps of an authorized task need no second confirmation.
- **C9** Start from the latest upstream code and never overwrite others' in-progress work: check the working tree, then sync (for example fetch and fast-forward, or branch from the fresh base). Ask first when syncing needs a merge or rebase or touches others' changes, or before editing a file another session is changing. Worktrees do not isolate databases, ports or other shared resources.
- **C10** Genuine ambiguity in requirements, behavior, interfaces or naming, or a user decision that conflicts with these rules, is the user's to resolve. Name the divergence, give mutually exclusive options with your recommendation and its cost, then wait.
- **C11** Keep fact and inference apart: mark unverified judgements with their basis and how to verify them; cite second-hand conclusions and never promote them to fact.
- **C12** A missing capability (sub-agents, browser, question UI) changes the method, not the requirement: required confirmations and verification still happen, and what stays unverified is reported.
- **C13** A handoff lets the receiver continue without asking back: write it in `tmp/` (goal, scope, changed files, decisions, verification, remaining work, open questions) and pass it on explicitly. Durable knowledge goes into docs.
- **C14** Every stage, including a non-interactive run, ends with an explicit settlement verdict, so the user knows without reading back whether the session is done and safe to archive; each open item names its blocker, owner and next step (for example as a table). Uncommitted changes, unsynced upstream, unmerged PRs, pending deploys, re-tests and user decisions count as open.

### Finishing a change

- **C15** When a change lands, code, tests, docs and rules agree: testable logic has tests, and affected docs and rules are updated in the same change. Report what was updated and why anything was not.

### Language and layout

- **C16** `AGENTS.md` records, outside this block, the UI language (every user-facing string: labels, placeholders, empty states, errors, examples, defaults, notifications) and the developer language. If the UI language is missing, confirm it with the developer before writing such text and record it. Talk to developers and write commits, PRs, docs and comments in the developer language, else the system language; identifiers, paths, commands and technical terms stay as they are.
- **C17** Files live where people and agents expect them: follow the layout recorded in `AGENTS.md`, else `src/` source, `doc/` docs, `tmp/` temporary (git-ignored), other top-level directories also three letters (`out/`, `ops/`, `bin/`). The root holds only repository configuration and entry files such as `README.md` and `AGENTS.md`.

### Working in the codebase

- **C18** New names read as part of their neighbours' set: same length first (letters, extension excluded), then part of speech, number, segmentation, case and separators. When neighbours disagree, follow the larger, more recent group; ask when unsure.
- **C19** After changing shared semantics (an API parameter, hook or constant), every caller still works, so review all call sites first. Record any coupling that must change in step as a sync point in the docs.
- **C20** Other repositories (siblings, reference implementations, nearby dependency sources) are read-only unless the user allows changes. In a worktree, confirm where a sibling actually is instead of assuming `../`.
- **C21** What the project deliberately defers or declines is listed in its docs and is the project's call; do not add it on the side. When something looks missing, check that list first.
