# Billing, entitlements, and storage rollout checklist

This document reflects the implemented billing contract. Polar is the only
payment target. `paystack` may remain in persisted legacy enums so old records
can still be read, but no Paystack checkout, portal, webhook, or invoice flow is
part of this rollout.

## Implemented contract

- [x] Polar checkout, portal, cancellation, resumption, invoices, and receipts.
- [x] Standard Webhooks signature verification and transactional replay safety.
- [x] Product-ID-based entitlement mapping with explicit configured products.
- [x] Stable subscription and feature-denial response contracts.
- [x] Atomic free-tier beneficiary and scheduled-capsule limits.
- [x] Per-plan storage limits, upload reservations, idempotent replay, and cleanup.
- [x] Usage reconciliation and stale-reservation background jobs.
- [x] Additive web and mobile usage metadata support.

## Production rollout order

Storage limits are enforced unless `STORAGE_QUOTA_ENFORCEMENT_ENABLED=false` is
set; an unset value means enforced, and any value other than `true` or `false`
stops the API at startup. (The old default switched enforcement off whenever
`NODE_ENV=production`, which both deployments use, so it was never on.) To stage
the rollout, set it to `false` on a server before deploying this version there.

1. Deploy with `STORAGE_QUOTA_ENFORCEMENT_ENABLED=false`.
2. Configure Polar product IDs, API token, and webhook secret. Do not configure
   Paystack as a target provider.
3. Let the billing usage reconciliation worker complete at least one full pass;
   compare `usage.storage_used_bytes` with active stored file totals and inspect
   accounts where `over_limit` would be true. `GET /staff/operations` reports
   their number as `storage_over_limit`.
4. Confirm web and mobile display `storage_reserved_bytes`, `remaining_bytes`,
   `percent_used`, and `over_limit` while continuing to accept older responses.
5. Enable `STORAGE_QUOTA_ENFORCEMENT_ENABLED=true` in one API deployment,
   monitor quota denials and upload cleanup, then roll it out to the remainder.
6. Keep legacy file URLs available during the separate signed-file migration;
   storage enforcement does not require changing attachment URLs.

## Required operational checks

- [ ] A reconciliation pass completes without a growing retry backlog.
- [ ] Stale reservations return to zero after their TTL.
- [ ] Concurrent uploads cannot exceed the configured plan limit.
- [ ] Failed provider or database writes remove uploaded objects and release quota.
- [ ] Polar duplicate deliveries are acknowledged without applying state twice.
- [ ] Unknown Polar product IDs do not grant paid entitlements in production.
- [ ] Free and paid over-limit clients show warnings without crashing on old API
  responses.

## Default limits

- Free: 200 MiB.
- Pro and legacy: 10 GiB.
- An admin `storage_limit_override_bytes` value takes precedence.

All values are configurable through the storage quota environment variables.
