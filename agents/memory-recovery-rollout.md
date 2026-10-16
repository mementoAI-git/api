# Memory recovery rollout

Memories move to Deleted for 30 elapsed days. `created_at` stays the original creation date; `deleted_at` is the actual deletion time and `delete_after` is the UTC recovery deadline. Restore returns the updated active document and removes these recovery fields. Repeating Delete does not extend the deadline. Owner-only server checks enforce the deadline and serialize recovery against the irreversible purge claim.

Permanent deletion requires a memory already in Deleted. It disappears from lists/counts immediately. A durable purge claim prevents recovery while the system worker removes unshared primary/backup/thumbnail objects and related messages, bookmarks, active prompts, pending insights, and shared metadata. Files referenced by another memory, message, capsule or active shared item are retained. Provider failures retain the claim and object keys for retry; an unavailable storage provider can delay physical cleanup, never re-enable recovery.

## Activation

1. Review `feat/api-memory-recovery-20261016` and deploy its API and worker together before the Web Stories recovery package. This extracted branch has not been pushed or deployed. Preserve the newer dev embedding/voice workers and migrations included in its base.
2. Run the normal migration workflow in the target environment. `202610150001_memory_recovery_window` adds the retention index and grants existing deleted memories a fresh 30-day window. It does not infer dates from old activity timestamps. The owner opening Deleted and the scheduled sweep also initialize missing legacy windows idempotently.
3. Restart the API scheduler and system worker with MongoDB, Redis and storage credentials configured. `purge-deleted-memories` runs every minute, in batches of up to 100. Existing system queue limits and storage retries can delay physical cleanup beyond the deadline; recovery is denied at the exact deadline regardless.
4. Check scheduler logs for `deleted memory cleanup`, the BullMQ job `purge-deleted-memories`, and absence of repeated `Memory purge failed` errors. Do not enable a TTL index: deleting database rows first would lose cleanup keys.

## Verification

- Isolated Mongo integration tests cover deletion/creation timestamps, stable legacy backfill, ownership, restore list/count movement, expiry boundary, concurrent restore/purge, shared media and storage-failure retries.
- Web tests cover DELETE payload, failed envelopes, Undo surviving dialog close, ten-second toast configuration, restore errors, deadline labels and infinite-grid refresh notifications.
- Browser verification used ephemeral request fixtures, including actual ten-second toast expiry, Undo, list/grid restore movement and permanent-delete confirmation. It did not mutate hosted user memories or call hosted destructive endpoints.
- The local web app currently points to `https://dev.mymemento.io/api`. Hosted testing needs the API and worker release first; web code alone cannot supply accurate historical deletion dates or run server cleanup.
