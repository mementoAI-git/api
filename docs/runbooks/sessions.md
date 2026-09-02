# Session Operations Runbook

## Invariants

- `AuthSession` stores only SHA-256 refresh-token hashes. Never log or query by a raw token.
- Every access token is checked against current user security state. Revoked,
  deleted, disabled, purge-pending, or version-mismatched sessions fail closed.
- Redis is a cache only. MongoDB remains the authoritative fallback.
- Legacy refresh migration consumes only the presented raw token and never repopulates it.

## Global session revocation

For account deletion, password reset, suspected compromise, or an operator-led
security response:

1. Increment the user's `session_version`.
2. Set `revoked_at` on every active `AuthSession` for that user.
3. Clear legacy `refresh_token` and `refresh_tokens` fields.
4. Invalidate the cached security state.
5. Verify old access and refresh tokens both return 401, recording only
   sanitized status, error code, and request ID.

Use the application session service. Do not modify MongoDB manually unless an
incident-approved recovery procedure requires it.

## Signing-key rotation

1. Put the new secret in the deployment secret store; never emit it to CI logs or artifacts.
2. Schedule a window appropriate to forced reauthentication.
3. Deploy the key, then increment session versions or globally revoke when immediate invalidation is required.
4. Exercise login, OAuth/passkey completion, refresh rotation, logout, and deleted-user rejection with synthetic accounts.
5. Retain the prior application release for rollback, without restoring raw refresh tokens or bypassing security checks.

## Rollback constraints

- Application code may roll back; hardened authorization state must not.
- Never un-revoke sessions, decrement `session_version`, restore raw refresh
  tokens, or loosen deleted/purge/disabled-user checks.
- If an older release cannot safely read the additive schema, deploy a forward fix.

## Acceptance evidence

Record the release SHA and supported client/build combinations. Capture only
status, canonical error code, and request ID for every auth flow, alias, and
push-device operation. Never record credentials, access/refresh tokens, push
tokens, or signing keys.
