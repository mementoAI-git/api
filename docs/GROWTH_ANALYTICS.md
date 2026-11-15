# Growth analytics v1

The six authoritative metrics use API events with stable MongoDB user IDs as `distinct_id`. Browser legacy events are excluded. All queries require `analytics_source='api'`, `analytics_schema_version=1`, `environment='production'`, and absent/false `is_test`. Events after the evaluation clock are excluded. Recipient identity is a server-side keyed hash; never send email addresses, titles, memory text, messages, or transcripts.

## Manifest

Import `growthDashboardManifest` or `buildGrowthManifest({asOf?: UTC_ISO_TIMESTAMP})` from `src/scripts/growth-analytics/manifest.ts`. Imports do not access the network, database, environment, or credentials. Each of the six `insights` has a stable `key`, name, definition, and PostHog `DataTableNode` query backed by `HogQLQuery`. The manifest version is 1. The default evaluation clock is `now()`; supply `asOf` for reproducible reviews.

Generate a reviewable JSON artifact using existing dependencies:

```sh
./node_modules/.bin/ts-node src/scripts/growth-analytics/manifest.ts > /tmp/memento-growth-v1.json
```

The JSON can be used to create six saved SQL insights and attach them to a dashboard. Dashboard management requires separate authorized PostHog management access; a project ingestion token cannot create insights. Creation and query execution are separate operations. All six queries were executed successfully in project 574943 on 2026-10-29. The live dashboard is [Memento — invitation growth & meaningful retention](https://us.posthog.com/project/574943/dashboard/2275577). No mature production cohorts were available: empty groups and null rates are expected until collection is deployed and observation windows mature. PostHog documents the [SQL query API and syntax](https://posthog.com/docs/sql) and [supported aggregations](https://posthog.com/docs/sql/aggregations).

Do not add `{filters}` or a dashboard date-range clause to the shared event source: clipping history can replace the actual first signup, first memory, or first invitation with a later event. These definitions intentionally include all observed signup cohorts to date. Introduce explicit signup-cohort bounds in a new version if a bounded reporting period is needed.

## Definitions

| Insight | Numerator | Denominator and maturity |
| --- | --- | --- |
| First memory activation | Accounts whose first persisted `growth_memory_captured` or `growth_reflection_added` after signup is before age 7 days | Observed accounts at least 7 days old; grouped into invited (invitation/referral) and organic |
| D30 retention | Accounts with `growth_user_active` at age >=28 and <35 days | Observed accounts at least 35 days old; same acquisition groups |
| Invitation conversion (addressed email only) | Unique recipient hashes with both actual `growth_invitation_converted` and matching new account signup within 30 days of first delivery | Unique first-delivered recipients at least 30 days old, excluding `existing_user=true`; resends never add denominators |
| 30-day cohort K-factor | Unique attributed new accounts created within the parent account's first 30 days | Observed parent accounts at least 30 days old; includes parents with no attributed signups |
| Invitee-to-inviter | Invited/referral accounts that deliver a direct invitation to a new recipient OR have a validated attributed new referral signup within their first 30 days | Invited/referral accounts at least 30 days old |
| Early connection retention association | D30 retained accounts in each early connection group | Accounts at least 35 days old; same connection accepted and shared engagement after signup and before age 7 days determines connected group |

All windows use elapsed time, inclusive start and exclusive end. Age exactly 7/30/35 days meets the corresponding observation maturity. Signup cohorts and attribution are taken from the earliest account-created event per user; duplicates cannot add accounts. Memory must occur after signup. Invitation conversion joins the sender-side recipient hash to the invitee-side conversion event and then to that invitee's account. Conversion and signup must both be in the first invitation's 30-day window, with invited/referral acquisition and a real delivery receipt matching the conversion’s sender, recipient hash, and invitation ID. That receipt must precede signup and conversion. The first delivery fixes the recipient observation window; a conversion through a later sender still counts once. Signup acquisition attribution may independently name another validated referrer. K-factor uses that authoritative signup attribution.

K-factor is a **cohort-based 30-day reproduction measure**, not all-time invitations/user and not a same-calendar-period ratio. The denominator includes all observed mature account-created users (including invited users), while only explicitly attributed new signup events supply offspring. A recipient created before its parent's signup, a self-attribution, a child at age 30 days, or a parent with no observed signup is excluded from offspring. Validated referral signups need not have an email invitation and still count in K-factor. A validated new referral signup within an invited parent’s first 30 days also proves that parent became an inviter; the invitee-to-inviter numerator unions this evidence with delivered direct invitations and counts each parent once. A child at age exactly 30 days does not qualify. Direct invitation conversion measures addressed email invitations only: unknown recipients of public/personal referral links cannot supply a conversion denominator.

`growth_user_active` represents qualifying persisted meaningful activity, including saved memory/reflection or at least three completed user/AI exchanges in a server-verified text conversation. The internal `Message.server_completed` marker is set only for a successfully persisted, completed API-owned provider reply with a persisted user message. Interrupted/partial streams, canned fallbacks, failed user saves, and client-asserted voice transcripts do not qualify. Voice-only conversation activity is not currently included: direct client-to-Gemini sessions need a trusted completion source before they can enter retention counts. It must be emitted for activity throughout the D30 window, rather than only once per lifetime. Connection engagement means a persisted explicit People share/contribution or saved memory share to an accepted, unblocked, available recipient. A share qualifies the connection for both participants and does not prove that the recipient viewed it; UI page views or connection acceptance alone do not qualify. Both connection events must use the same `connection_id` and participant `distinct_id`. Engagement must follow acceptance. Late connections cannot move users into an early cohort. Connection results expose both group denominators/numerators, retention percentages, percentage-point difference, and relative lift; they show association, **not causation**.

Counts remain available when a measured outcome is zero. Rates use `nullIf(denominator, 0)`, so missing/immature denominators produce null, not false 0% success. Grouped acquisition insights have no rows when no mature accounts exist; this is unavailable data. Relative connection lift is also null when baseline retention is zero. A real zero numerator with a nonzero mature denominator is a valid zero rate. This distinction must survive any downstream chart formatting.

## Instrumentation and operations

Deploy the API/worker collection code and verify outbox publishing using the repository's startup conventions. API request paths enqueue durable events; the publisher delivers asynchronously with deterministic event UUIDs. Preserve milestone idempotency across outbox cleanup. Configure ingestion token/host and the recipient HMAC secret only in server-side configuration. Keep the recipient key secret stable: rotating it changes identities, so resends before and after a rotation cannot be deduplicated without a planned migration. Do not attach management credentials to ingestion payloads or expose them to browser/mobile clients.

Before trusting a dashboard, check production source/schema/environment filters, publisher health, and event timestamps. Send any verification event with `is_test=true` so these metrics exclude it. Verify account attribution and invitation recipient joins using synthetic fixtures rather than real content. A newly created dashboard may legitimately be blank: collection cannot establish unobserved historical signups, and the first cohorts need 7 days for activation, 30 days for invitation/K-factor/invitee metrics, and 35 days for D30 results. Existing users with no observed account-created event do not enter account denominators. Their delivered invitations may enter invitation cohorts because that metric observes delivery directly. Avoid synthetic backfilled signup dates or historic zero rates.

Run targeted local checks from `api/`:

```sh
./node_modules/.bin/vitest run test/analytics/metrics.test.ts
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/eslint src/scripts/growth-analytics/manifest.ts test/analytics/metrics.test.ts
```

Fixtures calculate the reference metrics directly to exercise first occurrence, cross-person attribution, duplicate recipients/accounts, exact window boundaries, maturity, temporal connection assignment, excluded tests, and null denominators. They do not substitute for running HogQL in the target PostHog project after authorization.

## Deployment configuration

Set these on both API and worker processes before deploying the `analytics` branch:

- `POSTHOG_PROJECT_TOKEN`: the same public project token used by web.
- `POSTHOG_HOST`: the matching ingestion host (US: `https://us.i.posthog.com`).
- `POSTHOG_IDENTITY_SECRET`: a server-only random secret of at least 32 characters; generate with `openssl rand -hex 32`. Keep it stable and out of client builds.
- `POSTHOG_ENVIRONMENT`: `production` only for the real production deployment. Local configuration uses `development`. If omitted, `MEMENTO_ENV=dev` maps to `staging` and `MEMENTO_ENV=prod` maps to `production`, even when both use `NODE_ENV=production`.

Without ingestion configuration the adapters are no-ops; normal app behavior is preserved. The API and workers can publish concurrently using database leases. Requests do not make ingestion HTTP calls. Delivery receipts stay durable for retry and idempotency; include the new analytics collections in account erasure/retention planning before enabling any future automatic cleanup.

## Saved PostHog insights

| Metric | Insight ID |
| --- | --- |
| First memory activation | `YV1WkD8c` |
| Invited-user D30 retention | `CY4Jf9Mg` |
| Unique-recipient invite conversion | `6Qe3u1OX` |
| Invitation K-factor | `OzsBiQBL` |
| Invitee-to-inviter | `XvIWtZyB` |
| Connected-user retention association | `bTaCLDkZ` |

A synthetic `analytics_setup_verified` event received HTTP 200 from ingestion using the new publisher. It used `is_test=true` and `environment=development` and is excluded from the production metrics. This verifies ingestion connectivity, not production deployment or historical completeness.

## Checking the settings and recovering missed signups

Analytics switches itself off when any of the three settings above is missing or invalid, and records nothing while off. The API and worker now log one line at startup saying whether it is on, or which setting is wrong (names only, never values), and both deploy workflows print a GitHub warning after a release when it is off or when production events would be tagged with an environment other than `production`. Check a server by hand with:

```sh
DOTENV_CONFIG_PATH=/path/to/.env MEMENTO_ENV=prod NODE_ENV=production npm run growth:check-config:prod
```

Signups made while analytics was off can be recorded afterwards. The backfill sends `growth_account_created` dated with each account's real `created_at` (not a synthetic date), using the same event key and ID as the live event, so recorded accounts are skipped and reruns are safe. It refuses to run until the settings are valid. Start with a dry run, which also prints signups per UTC day:

```sh
DOTENV_CONFIG_PATH=/path/to/.env MEMENTO_ENV=prod NODE_ENV=production \
  npm run growth:backfill-signups:prod -- --dry-run --since=2026-10-30
```

Then run it without `--dry-run`. Invitation and referral attribution is worked out from records as they stand at backfill time, so it can differ slightly from what the live event would have recorded.
