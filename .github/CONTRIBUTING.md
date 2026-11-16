# Contributing

Thanks for helping. canons is small on purpose; please open an issue before large changes.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build && node out/cli.js verify
```

Node 22 or newer. Tests run the TypeScript sources directly with Node's type stripping; the published package ships compiled JavaScript because Node does not strip types inside `node_modules`.

## Changing rule content

Rule content lives in `src/canon/core/locales/<locale>/`. English is the source of truth.

- Every rule bullet starts with a stable id (`**C1**`, `**L1**`, `**V1**`). Ids run 1..n per prefix; renumbering is a breaking change.
- Every locale mirrors the English files, `paths`, ids and heading levels exactly; `src/test/locales.test.ts` enforces this. Update all locales in the same pull request, or mark the translation as pending in the PR so a native speaker can follow up before release.
- Shipped content must stay project-neutral: no product names, brands or internal tools.

In the pull request description, state the reason, who is affected, and the semver level:

| Level | When |
| --- | --- |
| major | adds or tightens a red line, renumbers ids, or changes what consumers must do (while `0.x`, use minor) |
| minor | new optional rule or command, new locale |
| patch | wording or translation fixes with no change in meaning |

## Code

- Zero runtime dependencies.
- Checks are deterministic: no network, no AI, no clock.
- New commands and checks come with tests; end-to-end behavior is tested against `src/test/fixtures/minimal`.
