# Design

Why canons is shaped the way it is. The README says what it does; this file records the reasons, so a change can be weighed against them.

## Goal

Every coding agent in a repository, whichever client runs it, follows the same instructions, and those instructions stay true over time. Two things break that in practice: copies that drift apart between clients, and text that quietly stops matching the code. canons answers the first with one source and symlinks, and the second with deterministic checks.

## How rule content is written: outcomes, not steps

Each item states the outcome it wants, then why, then — only when it helps — a method, marked as a reference ("for example"). An agent may use a better method; it may not lower the outcome or the criteria for meeting it.

**Why.** Agents keep getting more capable. A fixed procedure caps them at the method its author knew, and it hides the goal: an agent that only sees "run `git status`" cannot tell what to do when that command does not answer the real question. An agent that sees "never overwrite someone else's in-progress work" can pick the right check and notice the cases the step missed. Stating the goal also makes the text shorter, which matters under the byte budget.

Not everything in the canon is a method, though. Items fall into four kinds, and only the first is loosened by this style:

| Kind | Examples | How it is written | Why |
| --- | --- | --- | --- |
| Methods and formats | C3, C9, C10, C13, C14, C15 | Outcome and observable criteria; the method is an example | The method is a means; a stronger agent may find a better one |
| Authority boundaries | C8, C20, C21, V1, V2 | Hard, with who decides and why | They are about who decides, not about skill. A more capable, more proactive agent is more likely to overstep with good intentions, so these matter more as agents improve |
| Facts about the environment | L4, the Codex sandbox | Stated as facts | An agent cannot infer them; stating them adds information, not restriction |
| Arbitrary conventions | C17, C18 | A default with its purpose, overridable by the project | Taste and consistency cannot be derived from a goal; several agents sharing a repository need the same answer |

Two risks come with goal-only text, and the writing guards against both:

- **Drift between agents.** The more abstract a goal, the more Codex, Claude Code and Cursor diverge. Each outcome therefore comes with criteria someone else can observe ("the receiving agent can continue without coming back to ask"), not a bare aspiration.
- **Reasoned skipping.** A capable agent can talk itself out of a confirmation ("this is not really ambiguous"). Required confirmations and verification are written so their result is checkable (C11, C12), not left to the agent's own judgement.

## Text states the outcome, checks enforce it

Wherever an outcome can be checked mechanically — one source, symlinks, the byte budget, managed content left untouched, rule globs and links that resolve, anchors that still exist — `canons verify` checks it. The rule text then only needs the outcome and its reason; it does not need to describe the check. Checks stay deterministic (no network, no AI, no clock) so they give the same answer in every client and in CI.

## Other decisions

- **One source, symlinked entry points (C1).** Copies drift, and the drift is invisible until an agent acts on the stale copy.
- **Three tiers (C2).** Context is limited; a constraint lives where it is loaded exactly when it applies. Red lines stay in the root file because lower tiers are not guaranteed to load.
- **A query command instead of trusting native loading (C3).** Clients load path-scoped rules incompletely and differently; `canons scopes` gives every client the same answer.
- **A managed block with a lock.** The shared baseline must be replaceable as a whole on upgrade, so projects write outside it and `verify` rejects hand edits.
- **Stable ids.** Projects, rules and reviews cite items by id; renumbering silently breaks those references, so it is a breaking change.
- **Update notice without cost.** Agents run `scopes` on every task, which makes it the one place every repository in use can learn about a new version without adding files to it. The notice therefore only reads a local cache; a detached child refreshes it at most daily, and every failure is silent, so no conversation gets slower and no network problem reaches the user. `verify` stays offline so CI and pre-commit stay deterministic.
- **Upgrades need consent.** A new canons version changes the instructions agents follow, so it is a rule change: the notice only states a fact, C3 (reviewed repository text) says to ask the user, and the managed skill does the upgrade as its own change. Nothing upgrades or merges on its own.
