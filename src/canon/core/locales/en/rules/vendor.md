---
paths:
  - ".agents/skills/**"
  - "skills-lock.json"
---

# Third-party skills (canons)

- **V1** A third-party skill is a supply-chain dependency: its body runs as instructions and its scripts may run as code. It gets no default trust.
- **V2** No client may load a skill before it has been audited: keep it somewhere clients do not load automatically (for example `tmp/`). Read `SKILL.md` and every script; reject network egress, running downloaded code, or reading secrets and environment variables without a clear need.
- **V3** What enters the repository is exactly the audited version, and stays checkable later: vendor it and record its source and content hash in a lock (for example `skills-lock.json`). Narrow its `description` to the project's real triggers so it is not loaded for unrelated work.
- **V4** Keep upstream text and local changes apart; never recompute the upstream hash to hide a local edit. Upgrades are deliberate and audited again.
