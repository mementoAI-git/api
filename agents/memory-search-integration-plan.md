# Owner-only description search pilot

Historical implementation plan for the local integration phase. For the current approved test-server rollout, use [the developer review plan](memory-search-developer-review-plan.md) and [the rollout checklist](memory-search-rollout-plan.md). Production activation remains outside scope.

Approved scope: connect description search for app-saved photos, written stories and chats to the existing search box; preserve keyword search, check current ownership and freshness, and verify the app. No deployment or shared/capsule search is included.

## Design

Run the tested external DigUp embedding worker on the application backend. Do not index device folders or personal computer files. Store private vectors on the owning memory in a hidden `search_index` field so existing account deletion automatically removes them. A source fingerprint covers story content and current, live, owned photo metadata. Search rejects vectors when the source or model version changes, and rechecks matching documents before returning them.

Heavy text/image preparation runs in the existing BullMQ worker process. Queue work after saves/edits/restores and lazily repair existing/stale indexes during search. Load original photos through the existing storage adapter; do not fetch arbitrary URLs or use public object URLs. Temporary photo files are private and deleted even on failures. Bound image size, process runtime, vectors and pilot collection size.

`GET /memories/search?q=...` is authenticated, validated and rate-limited. It returns the existing paginated `docs` shape plus `search.mode`, `search.preparing` and optional `search.limited`. Default behavior remains keyword search. Description search requires explicit server configuration, a compatible local engine/model and an owner ID allowlist. Only live, saved, owned stories and Memento chats enter the semantic candidate set. Other users, shares, People messaging and capsules never enter its vectors. Chat message revisions are checked before indexing, at query time and again before returning results. Oversized transcripts use word search.

The search modal calls this endpoint, retains the existing focus/keyboard/motion conventions, announces loading, preparing and fallback/error states, and preserves existing result cards. A changed query cannot select a previous query's result. A disabled/unavailable model must not look like “nothing saved.”

## Execution checklist

- [x] Tests first for hidden index serialization, source fingerprints, ranking, owner/status boundaries, stale/deleted media and content, malformed queries and model failures.
- [x] Implement bounded DigUp protocol adapter and text/photo vector preparation.
- [x] Implement background queue, source reload/recheck, indexing and save/restore scheduling.
- [x] Add authenticated search endpoint, current-source validation, hybrid ranking and keyword fallback.
- [x] Connect existing modal and local preview with truthful status, input limits, stale-result/error/loading tests.
- [x] Run actual model against an isolated database with fictional stories/public photos and expanded queries.
- [x] Run backend/frontend checks and inspect desktop/mobile interactions in the collaborative browser.
- [x] Document enablement, verified results, limits and deployment requirements.

Implementation and pilot verification are complete. Production activation remains outside this work. See `memory-search-integration.md` for measured results and repository-wide check limitations.

No app-wide refactoring, external AI service, new paid dependency or production data backfill is required for this pilot.

The user clarified application-only wiring. All local pilot processes and pending pilot jobs were stopped, and local launcher configuration was removed. The user subsequently authorized a development/test-server rollout; its verification and activation are still pending.
