# Billing & Subscription Implementation Checklist (API)

This checklist is mapped to the current backend structure under `api/src/module/api/*` and `api/src/module/database/model/*`.

## 1) Create billing module (new files)

- [ ] `src/module/api/billing/routes.ts`
  - Add routes:
    - `GET /billing/subscription`
    - `GET /billing/usage` (optional but recommended)
    - `POST /billing/checkout`
    - `POST /billing/portal`
    - `POST /billing/promo/redeem`
    - `GET /billing/invoices`
    - `POST /billing/cancel`
    - `POST /billing/resume`
  - Add `export const name = 'billing';`
  - Protect all routes with `gaurd`.

- [ ] `src/module/api/billing/controller.ts`
  - Add handler per route; keep controller thin:
    - parse request
    - call service
    - return via `responsHandler`

- [ ] `src/module/api/billing/service.ts`
  - Add business logic:
    - fetch summary/usage
    - create checkout URL
    - open customer portal URL
    - redeem promo
    - list invoices
    - cancel/resume behavior

- [ ] `src/module/api/billing/dto.ts` (or `validator.ts`)
  - Validate checkout payload:
    - `tier`: `free|pro|legacy`
    - `interval`: `monthly|annual|lifetime`
    - `success_url`, `cancel_url`
  - Validate promo payload:
    - `code` required.

## 2) Add database models (new files)

- [ ] `src/module/database/model/subscription.ts`
  - Fields:
    - `user_id`
    - `tier` (`free|pro|legacy`)
    - `status` (`active|trialing|past_due|cancelled|paused`)
    - `billing_interval`
    - `current_period_start`, `current_period_end`
    - `trial_ends_at`, `has_used_trial`
    - `cancelled_at`
    - `payment_provider` (`paystack|polar`)
    - `provider_customer_id`, `provider_subscription_id`
    - `promo_code_used`, `promo_expires_at`
    - `currency`, `country`

- [ ] `src/module/database/model/usage.ts`
  - Fields:
    - `user_id`
    - `storage_used_bytes`
    - `storage_limit_bytes` (optional but useful for direct UI contract)
    - `beneficiary_count`
    - `timed_message_count`
    - `time_capsule_count`
    - `memory_integration_count`
    - `last_updated`

- [ ] `src/module/database/model/promo-code.ts`
  - Fields:
    - `code`
    - `grants_tier`
    - `duration_days`
    - `created_by`
    - `redeemed_by`
    - `redeemed_at`
    - `expires_at`
    - `campaign_tag`

## 3) Add subscription enforcement utility

- [ ] `src/module/api/billing/access.ts` (or `service.ts` export)
  - Implement:
    - `checkFeatureAccess(userId, feature): { allowed, requiredTier?, reason? }`
  - Rules:
    - resolve effective tier from subscription/status/trial/promo
    - enforce launch limits:
      - voice mode
      - storage/upload
      - time capsule window
      - beneficiaries count
      - timed messages count
      - supermemory writes

- [ ] Stable denied payload helper
  - Return a consistent payload used everywhere:
    - `error: "subscription_required"`
    - `feature`
    - `requiredTier`
    - `message`

## 4) Replace/augment feature-gate middleware for billing semantics

- [ ] Update `src/middleware/feature-gate.ts`
  - Current behavior returns 402 with `requiredTier: "admin_toggle"` based on feature flags.
  - Keep feature flags for rollout control, but for billing-gated flows:
    - evaluate feature flag (optional)
    - then call subscription access check
    - return stable subscription payload on deny.

- [ ] Ensure payload shape is frontend-compatible
  - Frontend currently parses gate payload from top-level body.
  - Use top-level `feature`, `requiredTier`, `message` for 402 responses.

## 5) Wire enforcement into existing gated routes

- [ ] `src/module/api/ai/routes.ts`
  - voice mode/live token paths should enforce subscription tier/feature.

- [ ] `src/module/api/file/routes.ts`
  - upload path should enforce storage limit and upload quality rules.

- [ ] `src/module/api/capsule/routes.ts`
  - capsule creation should enforce free time-window limit.

- [ ] `src/module/api/beneficiary/routes.ts`
  - beneficiary create should enforce free max count.

- [ ] Timed messages path
  - Identify endpoint in codebase where timed messages are created and enforce count limit.

## 6) Payment provider integration (Paystack-first)

- [ ] `src/module/api/billing/providers/paystack.ts`
  - methods:
    - initialize checkout
    - verify webhook signature
    - map events to subscription updates

- [ ] Optional: `src/module/api/billing/providers/polar.ts`
  - only if Polar retained.

- [ ] Environment variables in `api/.env` and config
  - Add keys for:
    - Paystack secret/public/webhook secret
    - plan codes per tier/interval
    - optional Polar keys.

## 7) Payment webhooks

- [ ] Extend existing webhook module or add payment webhook module
  - Option A (preferred for consistency): keep `webhooks` module and add:
    - `POST /webhooks/payments?provider=paystack`
    - `POST /webhooks/payments?provider=polar`
  - Option B: create dedicated `payments-webhook` module.

- [ ] Add idempotency store
  - e.g. `processed_webhook_event` collection/table with unique `event_id`.

- [ ] Make webhook handlers fast
  - verify signature -> enqueue job -> `200`.

## 8) Background jobs

- [ ] Add job runner integration (BullMQ/Inngest/other).
- [ ] Add jobs:
  - trial expiry
  - promo expiry
  - past_due grace downgrade
  - optional storage reconciliation

## 9) API contract alignment with frontend (critical)

- [ ] `GET /billing/subscription` response
  - Must include:
    - `tier`, `status`
    - `trial_ends_at`, `current_period_end`
    - `provider`, `currency`, `country`
    - optional `usage` object

- [ ] `POST /billing/checkout` response
  - Frontend currently expects: `data.checkout_url`
  - Standardize on this key and update docs/tests to match.

- [ ] `POST /billing/portal` response
  - Frontend expects: `data.portal_url`.

- [ ] `POST /billing/promo/redeem` response
  - Keep `{ success, message }` semantics.

- [ ] `GET /billing/invoices` response
  - Return array with `{ url?, label? }` or update frontend expectations.

## 10) Update tests (backend)

- [ ] Unit tests:
  - `checkFeatureAccess` matrix by feature x tier x status.
  - payload shape for denied gates.

- [ ] Integration tests:
  - billing routes happy/deny paths
  - checkout creation
  - promo redeem.

- [ ] Webhook tests:
  - signature rejection
  - idempotent replay.

## 11) Frontend-impact sanity checks after backend merge

- [ ] Verify `memento-web` can call all `/billing/*` endpoints without mock handlers.
- [ ] Verify 402 body shape triggers correct upgrade prompt copy (not fallback "storage").
- [ ] Verify voice, upload, beneficiary, capsule flows surface correct gate prompts.

## Suggested implementation order (fastest path)

1. Add models (`subscription`, `usage`, `promo-code`).
2. Add `billing` module with `GET /billing/subscription` and `POST /billing/checkout`.
3. Add `checkFeatureAccess` + wire to one route (`ai` voice) end-to-end.
4. Add paystack webhook endpoint + idempotency.
5. Wire remaining gated routes (file/capsule/beneficiary/timed message).
6. Add portal/promo/invoices endpoints.
7. Add scheduled jobs.
