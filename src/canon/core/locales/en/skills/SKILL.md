---
name: canons
description: Upgrade canons (the shared agent conventions in AGENTS.md and .agents/) to a newer version once the user agrees. Use when a canons command reports a newer version, or when the user asks to update canons.
---

# Upgrade canons

Outcome: the repository runs the newer canons, the upgrade lands as its own reviewable change, and nothing happens without the user's consent.

- **Consent.** Start only after the user agrees. A breaking upgrade (as `npx canons latest` reports it) needs a second yes after the user has seen the CHANGELOG entries between the two versions. If the user declines, run `npx canons latest --decline <version>` so that version is not raised again.
- **A separate change.** Keep the upgrade out of the current task's diff: use a separate session or worktree when your client offers one (for example a new Claude Code session, or a sub-agent in its own worktree); otherwise do it after the current task, on a new branch from the latest upstream (C9).
- **Steps**, for example:
  1. `npx canons latest` shows the installed and latest versions, whether the upgrade is breaking, and where the changelog is.
  2. With a package.json: `npm install --save-dev @canons-dev/canons@<version>`. Without one, run the next commands as `npx -y @canons-dev/canons@<version>`.
  3. `update` (with `--accept-major` only after the second yes), then `verify --strict` and the project's own checks.
- **When blocked** (no network, or a sandbox that protects `.agents/`, as Codex's does): say what blocked you and what the user can do, then stop. The current task is not affected.
- **Git** follows C8; agreeing to the upgrade is not agreeing to commit.
- **Report** per C14, with the versions, `git diff --stat` and the verification results.
