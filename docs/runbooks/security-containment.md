# Security Containment Runbook

## Immediate containment

1. Identify the affected surface and release SHA. Preserve sanitized request,
   audit, and provider logs; never copy bearer tokens, file signatures, webhook
   secrets, or complete Sentry envelopes.
2. Disable optional exposed surfaces with their feature switches when relevant:
   `BULL_BOARD_ENABLED=false`, `SENTRY_TUNNEL_ENABLED=false`, or
   `TALLY_WEBHOOK_ENABLED=false`. Deploy through the normal atomic workflow.
3. Revoke active sessions or credentials only when the incident scope requires
   it. Rotate the narrowest affected secret and retain file-verification keys
   needed for the approved overlap window.
4. Confirm the health endpoint and core authenticated API remain available after
   containment.

## Surface-specific checks

### Authorization and attachments

- Reproduce with two unrelated accounts and confirm private memory/file reads and
  writes return a non-disclosing denial.
- Confirm public-memory and beneficiary/shared-reader access works only through
  the explicit policy.
- For a leaked file capability, rotate the signing key ring and shorten the
  overlap only after assessing already issued URL TTLs. Never make `signed_only`
  records public as a workaround.
- Follow [Private Files Runbook](private-files.md) for inventory, validation, and
  rollback.

### Bull Board

- Keep `BULL_BOARD_ENABLED=false` until both JWT authentication and
  `FEATURE_FLAGS_ADMIN_EMAILS` are validated.
- When enabled, test `/queues` with no token, a normal active user, an allowlisted
  inactive user, and an active allowlisted administrator. Only the last may
  access the dashboard.

### Sentry tunnel

- Keep the route disabled unless `SENTRY_TUNNEL_ALLOWED_HOSTS` and
  `SENTRY_TUNNEL_ALLOWED_PROJECT_IDS` contain exact approved values.
- Validate HTTPS-only forwarding to the configured host/project. Confirm HTTP,
  alternate ports, credentials, internal/loopback names, malformed/oversized
  envelopes, and unlisted projects are rejected.
- Review limiter rejections and upstream timeouts. The API must not return the
  upstream response body.

### Tally webhook

- Keep the route disabled unless `TALLY_WEBHOOK_SECRET` is present and at least
  32 characters.
- Send an exact raw-body HMAC fixture and confirm acceptance. Confirm missing,
  tampered, and reserialized-body signatures return `401`, and repeated attempts
  reach the dedicated rate limit.

## Staging release acceptance

Before production promotion, attach evidence for:

- private read/write denial and explicit public/beneficiary reads;
- signed image/audio/video/document delivery and range seeking;
- expired/tampered capability rejection and signature-free logs;
- Bull Board administrator-only access;
- Sentry forwarding only to the configured project;
- Tally rejection and valid raw-body acceptance;
- unchanged attachment response field names for supported web and mobile builds.

Use synthetic staging data only. Record status codes, resource IDs, client build
versions, release SHA, tester, and timestamp; redact all secrets and capability
query strings.

## Recovery and closure

The deployment workflows use immutable releases and atomic activation. Roll back
to the last verified artifact if containment configuration alone is insufficient.
Do not roll back database authorization fields or convert private files to public.

Close the incident only after credentials are rotated where necessary, tests and
build gates pass, staging acceptance is complete, monitoring is stable, and the
root cause plus preventive action are recorded.
