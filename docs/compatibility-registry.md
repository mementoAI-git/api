# API Compatibility Registry

This registry lists temporary compatibility behavior that may be removed only
after its removal gate is satisfied. New code must use the canonical behavior.

## Active shims

### `FILES_LEGACY_BARE_URL`

| Field | Contract |
| --- | --- |
| Status | Active, temporary |
| Legacy behavior | A bare `GET /files/:name` remains readable only when the existing file record has `access_mode: legacy_public`. |
| Canonical behavior | Clients use the HMAC capability URL returned in attachment metadata, or refresh it with authenticated `POST /files/:id/access`. |
| Telemetry | Structured event `compat.files.legacy_bare_url`, including `fileId` but no capability or secret. |
| Removal gate | Every supported web and mobile version consumes signed attachment URLs, and legacy bare accesses remain below the product-approved threshold for the complete observation window. |
| Rollback restriction | Files created as `signed_only` must never become bare-public, including during rollback. Roll back application releases, not the authorization state of stored files. |

Owner: API/platform team.

Review the event volume at every supported-client release and record the
threshold, observation window, client-version evidence, and removal approval in
the release ticket. Removing this shim requires a security test proving that all
bare requests are rejected.
