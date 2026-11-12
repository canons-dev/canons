---
paths:
  - ".agents/skills/**"
  - "skills-lock.json"
---

# Third-party skills (canons)

- **V1** A third-party skill is a supply-chain dependency: its body runs as instructions and its scripts may run as code. It gets no default trust.
- **V2** Bring it into `tmp/` first, not straight into the skills directory where clients may load it. Read `SKILL.md` and every script; reject network egress, running downloaded code, or reading secrets and environment variables without a clear need.
- **V3** Vendor the audited version, record its source and content hash in a lock (for example `skills-lock.json`), and narrow its `description` to the project's real triggers.
- **V4** Keep upstream text and local changes apart; never recompute the upstream hash to hide a local edit. Upgrades are deliberate and audited again.
