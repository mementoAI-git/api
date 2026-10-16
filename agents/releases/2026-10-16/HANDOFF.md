# Memento Web and API release handoff — 16 October 2026

This handoff separates customer-facing work from the mixed local checkouts. Staff/admin dashboard implementation is excluded. Nothing has been pushed or deployed by this preparation task. Original working directories remain on `feature/web-edge-cases` with their changes intact.

## Baselines and production safety

Fetched remote refs: API `origin/dev` = `53e240c` (second pass; first pass used `6c5dedc`); API `origin/main` = `6bc857b`; Web `origin/dev` = `db8952b1`; Web `origin/main` = `3a4fa029`. Web main/dev have the same application tree. API dev advanced during the second pass with the separately merged staff-console PR #86. The rebuilt API branches inherit that upstream work unchanged; no new staff/admin implementation is included in their diffs. These refs do not establish the SHA currently running on either server; verify that before promoting a release.

**Do not merge the original API checkout wholesale.** It predates newer dev voice tools, embeddings, context-cache and environment-loading fixes. Copying its files over dev would remove those changes. People was merged in API PR #60 (`69c2747`); description search in PR #72 (`35eaf10`), with subsequent remote improvements. These are not new API changes to push again.

See `FEATURES.md` for the single collaborator feature table and `EXCLUSIONS.md` for preserved/superseded work.

## Review structure

The feature branches form **ordered stacks**, not interchangeable independent releases. Each row's diff should be reviewed against its previous branch; the first branch targets dev. A later branch includes earlier commits. After merging an earlier PR, retarget the next PR to dev and verify its diff; if squash-merging, rebase the remaining stack carefully. Avoid merging every branch as an unrelated PR against dev at the same time.

| Order | API branch | Incremental scope | Web dependency |
|---|---|---|---|
| A1 | `feat/api-about-limit-20261016` | Increase About/onboarding self-description limit to 2,000 characters; regenerate contract and add boundary test | Web onboarding/profile |
| A2 | `feat/api-spoken-replies-20261016` | Authenticated exact-text narration in the saved voice; bounded payload/rate limit, cancellation, audio errors, contract/tests | Web Chat read-aloud |
| A3 | `feat/api-memory-recovery-20261016` | 30-day recovery timestamps, stable legacy backfill, restore, durable purge claims, protected shared files, scheduler/worker, migration/tests | Web Stories deleted/Undo flows |
| A4 | `test/api-customer-flags-20261016` | Customer evaluation authentication/isolation regression tests only; endpoint and contract are already in API dev | No new runtime dependency; Web uses the upstream endpoint |

| Order | Web branch | Incremental scope | Prerequisites |
|---|---|---|---|
| W1 | `feat/web-session-ui-20261016` | Shared error/retry/UI/motion foundations; auth/session and privacy recovery; email/2FA; onboarding save/skip/draft isolation | API A1 before using expanded About input |
| W2 | `feat/web-profile-billing-20261016` | Avatar/banner/About/security settings recovery; billing/pricing/storage/cancellation handling | W1 |
| W3 | `feat/web-people-20261016` | People, connections/blocked recovery, shared spaces/media/contributions, activation, private Talk; beneficiary/group recovery | W2; People API already on dev, verify target environment |
| W4 | `feat/web-chat-recovery-20261016` | Continuous Chat lifecycle/send/history recovery; live settings drawer; voices, files and spoken replies | W3; API A2 |
| W5 | `feat/web-stories-recovery-search-20261016` | Story lists/details/composer/drafts, capture/upload/media recovery, search and deleted-memory Undo/restore | W4; API A3; description-search endpoint or documented keyword fallback |
| W6 | `feat/web-dashboard-utilities-20261016` | Overview capture, Explore, navigation/themes, quick tools/music/streak, public links, invitations, feedback and Insights recovery | W5 |
| W7 | `feat/web-local-preview-20261016` | Development-only state preview fixtures/transport and tooling, excluded from production bundle by DEV guard | W6; optional development tooling |
| W8 | `feat/web-customer-flags-20261016` | Use customer evaluation endpoint without migrating/removing the existing admin UI | W7; target API must include `/feature-flags/evaluated` (already in dev `53e240c`) |
| W9 | `feat/web-handoff-docs-20261016` | Audit, implementation plans and local project guidance | W8; documentation only |

`release/api-review-20261016` and `release/web-review-20261016` are combined validation tips, not automatic production release branches. API handoff documentation is a final docs-only branch, `docs/api-release-handoff-20261016`, based on A4.

W7 is optional by product scope, but the prepared W8/W9 branches include it through their ancestry. To omit local-preview tooling, create a separate review branch from W6 and cherry-pick only the W8 customer-flags commit and desired documentation, then rerun the combined checks. Do not merge the original W8 tip while assuming W7 is excluded.

## Portable review files

`api-review.bundle` and `web-review.bundle` contain only the prepared feature branch histories relative to the fetched dev baselines. Both bundles were verified. The `first-pass/` archive preserves the superseded first-pass bundles and manifests; use the current top-level bundles for review. They require the baseline history, so the collaborator should first fetch the repository's origin. Share the handoff Markdown files and relevant bundle; the full backup/snapshot directories are not needed for routine review.

Inside the matching repository, import into review refs (this does not push or deploy):

```sh
git fetch origin
git bundle verify /path/to/api-review.bundle
git fetch /path/to/api-review.bundle 'refs/heads/*:refs/remotes/release-review/*'
```

Use `web-review.bundle` for Web. Inspect each branch against the parent listed above, then use a separate local worktree for review. `BRANCHES.json` alongside the bundles records exact branch tips and intended bases.

## Push and promotion sequence

1. Review the exact branch diffs, including intentional extraction adjustments recorded below. Re-fetch origin before pushing; do not force-push your collaborator's branches.
2. Re-run required gates on the intended branch tip. API project rule: `bun run fix`, then `npm run lint`, `npm run build`; also tests and `npm run contracts:check`. Review any formatter changes before committing. Web: `npm run lint`, tests, and `npm run build`. A successful focused suite does not replace full release validation.
3. Push only named feature branches, using `git push -u origin <feature-branch>`. Do not use `--all`, push the mixed working branch, or directly push dev/main. No push is part of this task.
4. Open dependency-ordered PRs, with base branches matching the stack. API dev merges automatically deploy development; Web dev also has deployment automation. Plan merges as development releases, not just repository housekeeping.
5. Validate API and worker together in development before dependent Web merges: About limits; read-aloud failure/cancel; delete/restore/counts/expiry; People access/blocking; flags per-account isolation. Test the existing mobile client against the API release too.
6. Confirm production's deployed SHA, database backup and required env/worker settings. Promote tested changes through the existing dev-to-main/production process with the collaborator. Feature branch creation is not proof of production readiness.
7. Monitor readiness, API errors, worker retries and storage cleanup. Ordinary UI/API regressions can roll back to the previous release. Memory objects physically purged cannot be recovered through a code rollback.

## Scope boundary

The admin panel and admin flag management belong to a separate repository/task and are excluded from this review. Existing upstream API code is inherited unchanged. Legacy Web admin compatibility is not a release requirement for this customer package. Only customer-facing `/feature-flags/evaluated` usage and authentication/account-isolation coverage are included. W1–W7 retain the baseline customer provider, so deploy through W8 before relying on the new evaluation route.

## Spoken replies configuration

The new narration path uses `GEMINI_TTS_MODEL_VERSION` and the configured Gemini credentials. Confirm the model selected in the target environment is available to that project and exercise a real audio response in staging; mocked provider tests do not verify entitlement, quotas or external model availability. Do not replace server environment files with local ones.

## Memory recovery rollout

Read API `agents/memory-recovery-rollout.md`. Migration `202610150001_memory_recovery_window` gives previously deleted memories a fresh 30-day recovery window. New delete timestamps are server-generated; restore is denied at the deadline or after a purge claim. Keep newer dev migration entries for memory embeddings and voice actions. The scheduler registers automatically at startup when the system queue is available; there is no separate rollout feature flag in this patch. It runs every minute, and API/worker must match. Treat deployment as activation, not as an inert code upload. Do not use a TTL index that deletes records before storage cleanup. Perform a disposable-memory storage/restore/expiry exercise before production activation; do not run tests against production data.

## Intentional extraction adjustments

- Retained newer remote API files, migrations, workers, voice tools, search/embedding services and context-cache invalidation. Local old search engine/config copies are superseded, not queued as another feature.
- Preserved current API dev exactly for staff/flag routes, management services, central routing and middleware. PR #86 already migrated management routes to `/staff`; the second pass does not restore removed legacy endpoints. Web admin route/provider/menu remain at the Web baseline because the separate Web staff migration is excluded.
- Removed the duplicate API flag endpoint implementation and contract from the prepared stack after discovering both were merged upstream. A4 now contains only two customer-authentication/isolation tests. The earlier management-route compatibility test was removed because it asserted the pre-migration API behavior.
- Included the embedded recorder with People, the updated sidebar-details caller with Chat, and the Overview capture editor/dictation dependencies with Stories; tests exposed these dependencies during separation.
- Kept the original administrative compatibility tests in Web `src/contexts/feature-flags.test.tsx`; the snapshot test that assumed removal of the old admin provider does not apply to this customer-only extraction.
- Added a memory-delete regression and guarded cache invalidation failures after the combined API suite exposed an unhandled rejection; draft deletion does not create user activity.
- Original Web/API checkouts and their Git indexes were not staged, reset or switched. Backups contain modified/untracked files and binary patches but omit ignored environment files and dependencies.

## Remaining review boundaries

- The old dirty `feature/memory-description-search` Web worktree overlaps the primary checkout. Its unique inactive composer change is preserved in `web-legacy-composer.patch`; it is not included in the active app. Keep that worktree until its remaining review is complete.
- Mobile is outside this preparation scope. Its existing uncommitted changes remain on main. The mobile account deletion flow was inspected read-only earlier.
- Original audit/manual checks apply to the original assembled app. New isolated branch verification is recorded separately below; no claim of a new production or live-device test is implied.
- Account deletion/recreation/logout manual actions changed test data; they do not represent new API account-deletion implementation in this pending batch.

## Validation

See `SECOND-PASS.md` for the second-pass findings and `VALIDATION.md` for exact branch results and unresolved gates. A branch is not push-ready until its required gates are green.
