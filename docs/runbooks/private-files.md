# Private Files Runbook

## Purpose

Memento attachment metadata keeps the existing client-facing field names, but
new files are private (`signed_only`). The API issues short-lived HMAC capability
URLs and authenticated users can refresh durable attachment metadata through
`POST /files/:id/access`.

## Required production configuration

- `BACKEND_URL`: public HTTPS API origin used to construct file URLs.
- `FILE_URL_SIGNING_KEYS`: comma-separated `key-id:secret` entries. Each secret
  must contain at least 32 characters; the first entry signs new URLs and all
  entries can verify URLs during rotation.
- `FILE_URL_TTL_SECONDS`: capability lifetime in seconds.
- Storage-provider credentials for the configured object store.

Generate secrets with a cryptographically secure generator and store them in the
deployment secret manager. Never log, paste into tickets, or commit signing
keys.

## Pre-deployment inventory

Run against a read-only database credential where possible:

```bash
yarn files:audit-access
yarn files:backfill-thumbnails
```

Both commands are non-mutating. Save the single-line JSON results with the
release evidence. Investigate files missing an original storage key and
unmatched legacy thumbnail URLs before rollout.

To write only recognized thumbnail keys after reviewing the dry run:

```bash
yarn files:backfill-thumbnails --commit
```

Run the audit again and compare counts. The backfill is idempotent and must not
change `access_mode`.

## Key rotation

1. Generate a new key ID and secret.
2. Prepend it to `FILE_URL_SIGNING_KEYS`, keeping the previous key entries.
3. Deploy and confirm newly returned URLs carry the new `kid`.
4. Keep old keys for at least the maximum URL TTL plus clock-skew and rollback
   windows.
5. Confirm no valid traffic uses the retired key ID, then remove it and deploy.

Never reorder to an unknown key or remove the only active key. A rollback must
retain every key needed by capabilities issued by both releases.

## Staging acceptance

Use two unrelated staging accounts (owner A and user B) and record sanitized
status codes and attachment IDs. Do not record signed query strings.

1. Upload image, audio, video, and document attachments as A. Confirm each file
   record is `signed_only` and response field names are unchanged.
2. Fetch every signed URL and its thumbnail where applicable. Confirm `200`, the
   expected content type, and private cache headers.
3. Request audio/video with a valid `Range` header. Confirm `206`, correct
   `Content-Range`, and successful seek/playback.
4. Remove or alter `sig`, `fid`, `exp`, `kid`, `variant`, and object key one at a
   time. Confirm rejection. Confirm an expired URL is rejected.
5. As B, call `POST /files/:id/access` for A's private unshared attachment and
   confirm it is not disclosed. Confirm A can refresh it.
6. Grant the existing supported beneficiary/shared-reader relationship and
   confirm B can refresh/read only the explicitly shared attachment.
7. Exercise one known `legacy_public` record by its bare URL. Confirm it works,
   emits `compat.files.legacy_bare_url`, and is privately cacheable. Confirm a
   `signed_only` bare URL is rejected.
8. Search application and proxy logs for `sig=`, signing secrets, authorization
   tokens, and raw capability URLs. There must be no disclosure.

## Monitoring and rollback

Alert on spikes in `401`/`403` file delivery, refresh failures, storage-provider
errors, and `compat.files.legacy_bare_url`. If rollback is required, reactivate
the prior immutable release while retaining the current signing key ring.

Do not change `signed_only` records to `legacy_public`. If storage is healthy but
clients cannot render attachments, validate `BACKEND_URL`, clock synchronization,
key ordering, supported client versions, and log redaction before considering an
application rollback.
