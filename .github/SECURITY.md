# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's "Report a vulnerability" button on this repository (Security → Advisories). Do not open a public issue. We aim to acknowledge reports within five working days.

## Scope

canons writes instruction files that coding agents read and act on, so content integrity matters as much as code:

- `canons sync` copies files only from the installed package. It never downloads content at run time and never executes what it writes.
- Releases are published only from this repository's GitHub Actions workflow, with npm provenance. Verify with `npm audit signatures`.
- Treat any change to shipped rule text with the same care as a code change: it alters what agents in every consuming repository are told to do.
