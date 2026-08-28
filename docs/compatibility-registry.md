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

### `AUTH_LEGACY_RESPONSE`

| Field | Contract |
| --- | --- |
| Status | Active, temporary |
| Legacy behavior | Completed authentication responses retain top-level token, expiry, user, and onboarding fields. |
| Canonical behavior | Clients read the same values from `data.session`, including canonical expiry fields. |
| Telemetry | Compare request volume by client/version/build; never record tokens. |
| Removal gate | Every supported client reads `data.session` and legacy usage stays below the approved threshold for the observation window. |
| Rollback restriction | Never weaken revocation, token hashing, or security-state checks for an older client. |

Owner: API/platform team.

### `AUTH_LEGACY_REFRESH`

| Field | Contract |
| --- | --- |
| Status | Active, migration-only |
| Legacy behavior | A raw refresh token already stored on a user may be atomically consumed once. |
| Canonical behavior | Refresh tokens rotate through `AuthSession`; only SHA-256 hashes are stored. |
| Telemetry | Structured event `compat.auth.legacy_refresh`, with identifiers but no token. |
| Removal gate | No supported deployment holds legacy raw tokens and observed migrations stay at zero for the approved window. |
| Rollback restriction | Never repopulate a raw refresh token after migration. |

Owner: API/platform team.

### `USERS_PROFILE_POST`

| Field | Contract |
| --- | --- |
| Status | Active, deprecated |
| Legacy behavior | `POST /users/profile` updates the same allowlisted fields as PUT. |
| Canonical behavior | Clients use `PUT /users/profile`; both return `PublicUser`. |
| Telemetry | Event `compat.users.profile_post`; the response declares `USERS_PROFILE_POST`. |
| Removal gate | All supported clients use PUT and POST usage stays below the approved threshold for the observation window. |
| Rollback restriction | Never fork profile validation or serialization between methods. |

Owner: API/platform team.

### `PUSH_LEGACY_PROFILE_TOKEN`

| Field | Contract |
| --- | --- |
| Status | Active, temporary |
| Legacy behavior | `push_token` on a profile update registers a token-derived installation when the platform header is present. |
| Canonical behavior | Clients use `PUT /push-devices/:installationId` and DELETE to disable it. |
| Telemetry | Event `compat.push.legacy_profile_token`; never include the push token. |
| Removal gate | All supported clients use installation-scoped registration and legacy usage stays below the approved threshold for the observation window. |
| Rollback restriction | Never store push tokens on users or expose them in responses. |

Owner: API/platform team.
