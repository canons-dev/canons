---
paths:
  - "src/canon/**"
---

# Shipped rule content

- English under `src/canon/core/locales/en/` is the source of truth; every other locale mirrors its files, `paths`, ids and heading levels (`src/test/locales.test.ts`).
- Ids (`**C1**`, `**L1**`, `**V1**`) are stable and run 1..n per prefix; renumbering or tightening a red line is a breaking change. State the semver level in the PR (see [CONTRIBUTING.md](../../.github/CONTRIBUTING.md)).
- Write for any repository: no product names, brands, internal tools or stack-specific advice in `core`.
