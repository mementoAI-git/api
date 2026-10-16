# Staff console operations

## Architecture and access

`memento-admin` is deployed separately from `memento-web`. `/staff` uses dedicated staff identities, mandatory password + TOTP and opaque server sessions. Customer JWTs and FEATURE_FLAGS_ADMIN_EMAILS grant no staff access. Host-only cookies are HttpOnly, SameSite=Strict, scoped to /staff and Secure in production. Sessions expire absolutely after 30 minutes; sign in again after expiry. Each request rechecks enabled status, credential version and permissions. Staff cookies cannot authorize customer APIs.

Permissions are explicit: `flags:read`, `flags:write`, `operations:read`. Flag writers require flags:read. No general customer-data browsing or impersonation is implemented.

Feature management is at `/staff/feature-flags`, aggregate metrics at `/staff/metrics`. Raw Bull Board is disabled even if the legacy BULL_BOARD_ENABLED setting is true because its job payloads contain private conversation text. The old management URLs are removed. Customer flag evaluation remains at `/feature-flags/evaluate/:key` and `/feature-flags/evaluated`; the latter returns only per-customer values and sources. Existing feature mutation audit records identify staff as `staff:<id>`. Staff lifecycle audit records are in `staff_audits`.

## Environment and deployment

1. Generate a dedicated random 32-byte key in your secret manager. Set `STAFF_TOTP_KEY` to its 64-character hexadecimal encoding on the API; never place it in frontend config. Back up the key securely. Changing it requires re-enrolling staff authenticators.
2. Set `STAFF_ORIGIN` to the exact console origin, with no trailing slash. Use HTTPS in production. Add the same origin to `CORS_ALLOWED_ORIGINS` alongside existing customer origins. Missing staff config fails closed; existing customer operations can run without staff config.
3. Run the existing migration command to create staff identity/session indexes. The provisioning CLI also creates these indexes. Mongo TTL deletion is cleanup only; requests enforce expiry independently.
4. Deploy the separate `mementoAI-git/admin` repository independently using its Dockerfile/Nginx template or an equivalent host. Preserve `/staff` when reverse-proxying it to the API. Configure `STAFF_API_UPSTREAM` as the backend URL without a trailing slash. Set `STAFF_TRUSTED_INGRESS_CIDR` to the exact trusted HTTPS ingress IP/CIDR (never 0.0.0.0/0), and make the ingress overwrite or sanitize X-Forwarded-For. Nginx resolves the trusted client IP and forwards a single sanitized value so the API’s existing one-hop trust and login throttling remain correct. Direct untrusted requests cannot supply their own client IP. Do not cache API responses, strip Origin, or broaden cookie Domain.
5. Provision staff before enabling the new frontend. Deploy API and customer frontend together: the new customer evaluation endpoint is required by the new client. The old customer admin page will stop working after API cutover. Verify MFA login, read/write permissions, audit attribution and logout on the real hostname.

No production credentials, DNS, hosting resources, or staff accounts are created automatically by this implementation.

## Provisioning and recovery

Use the trusted API operator environment with database access and the encryption key. There is deliberately no public staff registration/reset endpoint.

`npm run staff:account` reads a single JSON object from **stdin**. Supply it from a secure password-manager/tool pipe or a protected temporary file outside the repository; never put passwords or secrets into command arguments, shell history, source files, or shared logs. The CLI prints only success/failure.

Create input fields:

- `operation`: `create`
- `email`: staff email
- `password`: unique password of at least 15 characters and at most 72 UTF-8 bytes
- `totpSecret`: independently generated Base32 authenticator secret (32–128 characters)
- `code`: current six-digit code, proving the authenticator has been enrolled
- `permissions`: explicit array, usually `["flags:read", "flags:write"]`

Generate/enroll the secret in the staff member's authenticator over a trusted channel. Never reuse the test fixture secret. The enrollment code is consumed: wait for the next authenticator code before logging in. Password hashes use bcrypt cost 12; TOTP secrets use AES-256-GCM with the dedicated server key.

`reset` accepts the same fields and replaces credentials/permissions, increments the credential version, and revokes existing sessions. Use this for verified account recovery or permission changes; it enables the account. `disable` needs only operation and email, immediately disables access and revokes sessions. Operator identity/access auditing is also required in the environment running the CLI; application records label provisioning as operator-cli.

Login uses IP rate limiting, a persistent limit of five account attempts per 15-minute window, and atomic TOTP replay prevention. Multiple instances share account throttling through MongoDB. If credentials are correct but login is refused, wait for a fresh code or the attempt window; do not weaken MFA or promote a customer account.

## Verification

Run `npm exec -- vitest run test/staff/access.test.ts test/security/admin-middleware.test.ts test/config/runtime-config.test.ts test/smoke/readiness.test.ts test/contracts/openapi.contract.test.ts` and `npm run compile`. In memento-admin run `npm test` and `npm run build`. The disposable browser server is under test/staff/preview.ts and never connects to the configured application database.

Legacy customer admin component source and its fixture tests are retained because they contain pre-existing uncommitted work. They have no customer route, page export, provider mount or navigation entry, and management APIs reject customer sessions. Remove those files in a later cleanup after the owner reconciles that work.

## Current operations and support endpoints

- `GET /staff/operations` (`operations:read`): `{ collected_at, counts }` across customer accounts, subscription records, memory enrichment/recovery, media processing, shared spaces, capsule delivery and archive exports. Each count is an integer or `null` when its bounded database query fails. Zero and unavailable are distinct.
- `GET /staff/metrics` (`operations:read`): existing sanitized queue, purge, storage reconciliation and store-notification signals. Registered inside the staff router.
- `GET /staff/accounts?search=&page=1` (`accounts:read`): `{ items, total, page, limit: 25 }`, newest first. Search is exact lowercased email or ObjectId; pages are limited to 1–1000. Empty search lists the directory.
- `GET /staff/accounts/:id` (`accounts:read`): `{ account, subscription, usage, processing }`. Explicit field projections exclude credentials, private content, asset links and provider tokens. Missing usage stays `null`. Effective tier uses the billing access resolver, including staging entitlement rules. Related IDs normalize to the canonical stored ObjectId string.

`accounts:read` is a new explicit permission; existing staff accounts receive no automatic grant. Use the documented provisioning/reset command with a complete desired permissions list. Access remains read-only for account diagnostics. The console does not alter subscription or customer state.

The memory-recovery count is `null` until the deployed Memory schema includes `delete_after`; memory recovery is a separate rollout. Do not interpret an unavailable count as zero.
