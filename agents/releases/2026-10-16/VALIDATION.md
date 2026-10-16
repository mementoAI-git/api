# Branch validation — 16 October 2026

Checks run in isolated preparation worktrees, not the original browser-serving checkouts. No deployment, live database migration, external email, payment or production-storage test was performed during branch preparation.

## API

Validated second-pass application tip: `1e2fa9f`, rebuilt on API dev `53e240c`. The customer flag endpoint/contract are now upstream; the last layer adds only isolation/authentication tests. First-pass reports are archived in `first-pass/`.

| Check | Result |
|---|---|
| Dependency installation | Matching dev dependencies installed with frozen Yarn lockfile; original checkout dependencies unchanged |
| `npm run lint` | Passed; 0 errors, 143 warnings |
| `npm run build` | Passed (TypeScript compilation) |
| `npm run contracts:check` | Passed; OpenAPI artifacts current |
| `npm test -- --maxWorkers=2` | Passed; 143 suites passed, 3 skipped; 763 tests passed, 4 skipped |
| About boundary checks | 6 focused tests passed on the rebuilt branch |
| Spoken reply checks | 9 focused tests passed on the rebuilt branch |
| Memory recovery checks | 47 focused recovery/voice-content/Undo tests passed on the rebuilt branch |
| Customer evaluation checks | 2 tests passed: customer authentication and per-account isolation; no admin-management test in this layer |

The initial combined API run exposed an unhandled cache invalidation rejection. A new regression also caught draft deletions creating activity. The fix is retained in rebuilt commit `5eeea64`; the final combined run above has no unhandled errors. An API baseline full run was canceled, so this report does not claim a completed baseline API suite. No broad formatter rewrite was performed; the repository's `bun run fix` gate remains required before pushing, with any resulting changes reviewed and retested.

## Web

Baseline `db8952b1`: 249 suites passed; 1,285 tests passed, 10 skipped. Baseline lint: 0 errors, 174 warnings.

| Layer/check | Result |
|---|---|
| Session/shared UI | 35 suites, 139 tests passed; production build passed |
| Profile/billing | 36 suites, 152 tests passed; production build passed |
| People | 17 suites, 51 tests passed; production build passed |
| Chat | 40 suites, 200 tests passed; production build passed |
| Stories/capture/search | 34 suites passed in focused run; 2 editor suites timed out under concurrent load, then passed serially (90 passed, 10 skipped); production build passed |
| Dashboard/utilities | 18 suites, 136 tests passed; production build passed |
| Local preview | 4 suites, 27 tests passed; production build passed |
| Customer flags | 2 suites, 3 tests passed; production build passed |
| Final lint | Passed; 0 errors, 139 warnings |
| Final complete unit suite | Passed; 323 suites, 1708 tests passed, 10 skipped; `npm test -- --maxWorkers=1` on application tip `59131b43` |

The production build reports large chunks, a stale browser-baseline mapping and a mixed static/dynamic PDF import. Build completion is not a performance guarantee. No standalone Web TypeScript gate is claimed: this repository's build script is Vite. Development-preview marker checks found no fixture/transport markers in generated production JavaScript.

## Second-pass Web checks

The application source is unchanged from the 323-suite / 1,708-test full run. The second pass ran four focused suites covering customer flags, the real dashboard layout, continuous Chat entry and capture save transport: **23 tests passed**. Every prepared Web branch was scanned for new missing relative/alias import targets; none were found. Snapshot differences were inspected and match exclusions, integration wiring or whitespace normalization. Two stray backslashes in a documentation CSS sample were corrected. No browser or live-service rerun is claimed.

## Preservation checks

- Original Web/API working-file hashes match the frozen manifests after extraction.
- Existing Web admin components/pages/provider match the Web baseline; API flag/staff services/routes, middleware and central route registry match the new API baseline. Admin management is outside this review.
- Remote API environment loader, embeddings, voice tools, metrics and context-cache changes are retained.
- All branches are local; no remote branch or deployed application was changed.

## Required release checks

Re-fetch and resolve any new collaborator changes, run project push gates on the actual final PR tips, and verify deployed SHA/configuration before promotion. In staging, exercise API + worker memory recovery/purge with disposable files, Web read-aloud, customer flags/account isolation, People sharing/blocking and the existing mobile client. Historical live/manual checks are documented in the original audit; they do not prove this newly rebased assembly has passed a fresh browser or device run.
