# Description search integration

Memento's existing search window now calls an authenticated search endpoint that can combine descriptions with word matches. The integration supports a person's own saved stories, attached photos, and saved Memento chat messages. It does not search another person's vault, shared spaces, capsule messages, People messaging or any device folders.

## Enable a limited pilot

Description search is disabled by default. Configure **both the API and worker process**, then restart them:

```dotenv
MEMORY_SEARCH_ENABLED=true
MEMORY_SEARCH_USER_IDS=comma-separated-pilot-owner-ids
MEMORY_SEARCH_DIGUP_PATH=/absolute/path/to/digup
MEMORY_SEARCH_MODELS_DIR=/absolute/path/to/models
```

Use real owner IDs in the server allowlist. Do not place these settings in client/Vite configuration. Redis must be available to prepare new or existing memories. Existing background-worker startup now includes the optional `memory-description-search` worker when the flag is enabled; its shutdown and readiness use the same lifecycle as the other workers. Concurrency is one preparation job. The API permits at most two local query helpers at once and falls back to words when they are busy or time out.

The local tested helper/model are already available under the ignored `api/tmp/memory-search-trial-runtime` directory from the earlier experiment. Use absolute paths when configuring a process. See `agents/memory-search-trial.md` for DigUp v0.6.1 setup, model revision and verified checksums. The engine validates its startup metadata against EmbeddingGemma 2 revision `bfcd298762cc34d0357ece5ebdd31791a3a374d8`, llama.cpp vectors version 1 and the tested Q8_0 text/media encoders. An incompatible engine never contributes vectors to search.

The engine is an external native executable, not a JavaScript package. The tested artifact is for Apple Silicon/macOS; a hosted server needs a compatible build for that host, matching model files, available process memory and the existing storage-provider configuration. Hosted activation/deployment was not performed. No external paid AI service or account is used by this retrieval feature.

## What happens

- Saves, quick captures, edits, restores and photo detachments queue preparation for allowed owners. Existing or changed sources are also queued lazily on search, ten at a time. The modal polls while preparation is pending.
- The worker reads the latest saved story and only live, owned photos through the existing storage adapter. It uses bounded text chunks and private temporary image copies, cleans them up on success/failure, and checks that the source/account are still current before publishing vectors.
- Vectors and source fingerprints are stored in the optional hidden `Memory.search_index` field. Normal reads omit it; JSON/object serialization also removes it even if explicitly selected internally. Permanent memory/account deletion naturally deletes these derived data with the memory. No separate collection or schema migration is needed.
- Search compares fingerprints against current story content, attachment IDs and live photo metadata. Edits, deleted/replaced photos, changed ownership, drafts and deletions cannot use an old vector. Selected results are reloaded and rechecked before returning current content and the normal authenticated attachment contract.
- A preparation failure records a fingerprint-specific ten-minute cooldown. It does not monopolize the first ten backfill slots or keep the UI polling forever. Changing the source permits an immediate retry; a successful index clears the failure state. Partial coverage is explained in the modal.
- Word search remains available when the model or queue is unavailable, the owner is outside the allowlist, or the collection exceeds the pilot limit. Disabling the flag returns to word search. Existing vectors are ignored; they remain private derived fields until replaced or their memory/account is deleted.

## Bounds and ranking

The pilot supports at most **200 live owned memories** (including conversations), **five supported photos per story**, and roughly **230,400 plain-text characters per story**. Preparation skips accounts above the size cap before model work. Unsupported/unreadable sources use word search and a cooldown. Photos must be JPEG/PNG/WebP/HEIC/HEIF, ready/live and owned; SVG/audio/video/PDF indexing is outside this phase. Photo reads are capped at 20 MiB, image decoding at 40 million pixels, and inputs are resized to at most 1024×1024. Temporary files are private and removed afterward.

The native model uses the same query/document prefixes and photo budget as the DigUp trial. The application ranker preserves exact phrases/names, limits partial word boosts and requires description matches to stand out against the current collection. Very small collections use an absolute confidence rule. Chat preparation reads at most 2,000 messages across the saved conversations in a search, at most 8,000 characters per message and 230,400 characters per transcript. If these bounds are exceeded, the request uses full-message word search and reports limited description coverage. The ranking is a pilot adaptation, not a claim to reproduce the desktop app's complete search algorithm. This is bounded brute-force retrieval over a small owner's collection; it is not a large-archive vector database.

Query helpers time out after three seconds; preparation helpers after two minutes. Search is limited to 60 requests per owner per minute. Redis queue operations fail fast instead of blocking ordinary search during an outage.

The producer completes BullMQ's Redis handshake before accepting preparation jobs. Search returns to words while the producer is connecting or disconnected. Connection and command timeouts are one second; a reconnect makes preparation available again. An opt-in real-Redis regression test covers clean startup and an unavailable connection:

```sh
RUN_REDIS_SEARCH=true npx vitest run test/memory-search/queue.test.ts
```

This check uses an isolated test key prefix on local Redis at port 6379. It does not consume or delete application queues.

## API contract

`GET /memories/search?q=...` requires authentication and a nonempty string of at most 200 characters after trimming. Client-supplied owner/status parameters cannot widen the scope. It returns the usual response envelope with paginated `data.docs` (up to 20 current results) and:

```json
{"search":{"mode":"hybrid","preparing":false,"limited":false}}
```

`mode` is `hybrid` when a query embedding was available, otherwise `keyword`. `preparing` means background work was successfully queued. Optional `limited` indicates a source currently cooling down after a preparation failure. These fields describe availability, not correctness guarantees. The response contains no vectors or temporary source paths. The frontend cache is keyed by account and query; results from an older query are not selectable while a new query loads.

The frontend's isolated new-user preview implements this endpoint locally using words only. It does not simulate successful description retrieval or contact the model. Search loading, retry, fallback and partial-coverage messages retain the existing dialog/sheet focus, keyboard and reduced-motion behavior.

## Actual-model verification

Run from `api` with the locally prepared runtime:

```sh
RUN_DIGUP_SMOKE=true \
MEMORY_SEARCH_DIGUP_PATH="$PWD/tmp/memory-search-trial-runtime/digup" \
MEMORY_SEARCH_MODELS_DIR="$PWD/tmp/memory-search-trial-runtime/models" \
npx vitest run test/memory-search/digup-smoke.test.ts
```

This test starts a temporary MongoDB database, seeds fictional stories and public sample photos, runs the actual preparation/model pipeline, and searches through the authenticated API. Storage reads use those public fixture bytes, not a real account or remote bucket. It verifies that returned photos use signed access and that private vectors are absent. The database is removed afterward. The model test is opt-in; ordinary unit tests do not need an installed model.

Measured on 14 October 2026 using the 25-query development smoke set:

- 19 of 20 positive searches returned the correct memory first.
- Four of five no-match searches returned nothing.
- “How Dad got his first job” was still missed; “a dog playing in snow” returned a puppy story that did not mention snow.
- This is a small development set used while improving the integration, not an independent accuracy benchmark or a production guarantee.

Full local results: `tmp/memory-search-integration/results.md` and `results.json`. Photo sources/licenses are in `test/fixtures/memory-search-trial/README.md`. Larger, diverse, owner-approved samples are the next quality gate before broad rollout. Visual similarity does not establish a person's name or family relationship.

## Checks

```sh
npx vitest run test/memory-search test/search-trial
npm run compile
npm run contracts:check
npm run lint
```

Frontend checks are the search-modal/preview tests, scoped ESLint, Vite production build and browser interactions at desktop and mobile sizes. The repository-wide standalone frontend TypeScript check already reports unrelated errors; it is recorded separately from the production bundle and the changed search files.

Verification recorded on 14 October 2026:

- Final focused backend run: **65 passed, one opt-in model test skipped**, covering search/trial, memory access, signed file delivery, account purge and OpenAPI. The account-purge check uses `SUPERMEMORY_API_KEY=''` for the process to avoid the existing external provider call; a preceding run timed out on that provider. The actual-model test was run separately and passed as described above.
- Backend compilation, OpenAPI consistency and repository lint passed. Lint reported 153 warnings and no errors. Both repositories passed `git diff --check`.
- Frontend search and preview tests: **35 passed**. Scoped ESLint and production build passed. The standalone TypeScript check reported 161 diagnostics elsewhere, with none in the changed search/preview files.
- Desktop (1280×800) and mobile (390×844) browser checks covered search results, fallback status, clearing, focus, keyboard selection and responsive layout using a disposable local preview session. The session was removed afterward.
- Wider suites are **not entirely green**: backend had 583 passed, one timeout and one skipped; its timed-out auth-alias file then passed all four tests in isolation. Frontend had 1,381 passed, 34 failed and ten skipped, with failures outside the changed search/preview files. These broad runs overlapped and included timing failures; they do not establish a clean repository baseline. No unrelated application fixes were included.

No commit, push or hosted deployment was performed during the implementation checks above.

## Application-only scope

This integration searches data already saved inside Memento. It does not crawl or index a user's computer, desktop folders, downloads or arbitrary local files. The backend runs the search engine on the application server; configured executable/model paths are server dependencies. Temporary image copies come only from authorized Memento attachments and are deleted after preparation.

Stories, supported attached photos and saved Memento chat messages have description-search wiring. Chat source fingerprints cover the current owned message IDs, roles, text and update times. Edits and deletions invalidate existing vectors; selected results reload and recheck chat content before returning. Internal transcripts remain temporary source data and are never included in the API result. Chat results open the chat screen. Desktop story results open the existing `view-memory` viewer by memory ID; mobile stories use the app's existing story page.

The user clarified that the requested deliverable is app wiring only. The briefly activated local account pilot was stopped, its remaining queued jobs were removed, and its copied browser session and local website/API launch configuration were removed. No hosted deployment or hosted feature activation was performed. Existing private derived indexes produced during the authorized pilot remain on their owning app memories and are ignored while the feature is disabled.

The optional `MEMORY_SEARCH_PHOTOS_ENABLED=false` setting supports a stories-only server rollout without reading image bytes. This mode participates in source fingerprints, so switching to photo support invalidates text-only indexes and allows failed photo sources to retry correctly. Default photo support remains enabled when this setting is absent.

The chat extension adds regression checks for semantic and word matches, cross-account/deleted-chat isolation, edits/deletions, edits during query processing, and oversized transcript fallback. Chat preparation is queued after saved message batches and completed text/voice turns; local searches also repair stale chat indexes lazily. No live account pilot is needed to run these checks: they use temporary test databases and fictional messages.

Final application-only verification: **81 backend tests passed** with one opt-in model test skipped; **43 frontend search/preview tests passed**. Backend compilation, API contract consistency, scoped frontend/backend lint and the frontend production build passed. Backend scoped lint retained ten warnings in existing AI-service code, with no errors. The earlier repository-wide failures remain recorded above; they were not reclassified as passing. Read-only code review confirmed owner scoping and transcript freshness; its repeated-message fallback finding was fixed and regression-tested.

The final chat cases verify backend wiring with deterministic test embeddings. The earlier real-model measurements used fictional stories/public photos; they are not a chat-retrieval quality benchmark.

## Compatibility with the currently running website

The website on port 5173 serves the original `memento-web` checkout, while the dedicated feature branch also has an isolated worktree. The navigation and compatibility fixes are present in both locations. Search results use the standard app flow: desktop stories open `view-memory`, mobile stories use `/stories/:id`, and chats use `/chat/:id`.

The existing development backend currently returns HTTP 500 for `/memories/search`, while its original `/memories?search=...` endpoint works. The frontend now falls back to that original endpoint for missing/unsupported routes or server errors, and explicitly reports keyword mode. It preserves authentication, authorization, validation and rate-limit errors without issuing a fallback request. If both search endpoints fail, the existing retryable error remains visible. This restores word search while the new backend is awaiting deployment; it does not enable description retrieval remotely.

Verified in the actual port-5173 app: a word search returned a saved result and selecting it opened the story screen. The compatibility, modal, result-routing and preview checks passed 54 tests in the original checkout and dedicated worktree. Scoped frontend lint and the production build passed.

Viewer correction verified on port 5173: selecting a story opens the existing story viewer, closes search, loads the story and retains the underlying URL. The result/modal/compatibility checks passed 38 tests; scoped lint passed. The result component tests also passed in the feature worktree.

Standalone desktop story-page rendering has also been removed. Existing `/stories/:id` links now use a thin route adapter that opens the standard viewer above the stories library. The active phone layout was retained explicitly in `mobile-details.tsx`; the desktop viewer currently does not support phone presentation, so deleting that layout would break mobile story links. Viewer cleanup runs on route exit or switching to the mobile breakpoint. The route/search/library checks passed 23 tests and the production build passed. Desktop direct-link behavior was checked in the port-5173 browser; browser resize attempts timed out, so mobile switching was verified by regression tests rather than claimed as a mobile browser check.
