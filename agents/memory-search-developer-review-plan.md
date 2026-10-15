# Memento description search — implementation and rollout review

**Purpose:** let a person find content already saved in Memento by describing it, even when their search uses different words. This is application search, not a search of the person's computer.

**Status (14 October 2026):** the search backend is deployed on the development/test server, and text description search is enabled for the approved test owner only. The pinned Linux helper and models passed server probes. Activation checked both running services and readiness successfully. The app on port 5173 has returned `hybrid` mode with content preparation in progress. Photo-description search remains disabled. Hosted paraphrase checks have succeeded for a story and a saved chat, including their normal opening flows. Preparation is still running, and the response also reports partial availability (`limited: true`); failed sources have a ten-minute retry cooldown. Full library coverage and the user's relevance review remain open.

## 1. Intended experience

A user opens the existing Memento search window and types a name, phrase or description. For example, “our seaside holiday” could find a story about visiting the beach. Results include the owner's saved stories and saved AI-chat conversations. Photo-description search can follow after the initial text rollout.

Selecting a story opens the existing standard desktop story viewer. Existing direct story links also open that viewer; the currently used mobile story page remains available. Selecting a saved chat opens its conversation screen.

The search window must distinguish preparation, word-only fallback, partial availability, errors and no matches. It must not present an unavailable semantic engine as an empty library or claim that word search is semantic search.

## 2. Scope

| Included | Excluded from this phase |
| --- | --- |
| The signed-in owner's saved stories/memories | Other people's private memories |
| Saved messages in the owner's Memento AI chats | People messaging, shared spaces and capsule contents |
| Existing word search as a fallback | Scanning desktop folders, downloads or arbitrary device files |
| Supported photos attached to owned memories, after storage checks | Audio/video/PDF search and unrestricted large archives |
| Existing app authentication, file access and story/chat views | Replacing Supermemory or sending user content to a new paid AI API |

Initial activation is restricted to an explicit test-account allowlist, on the **development/test server only**. Production stays disabled.

## 3. Backend search flow

The frontend calls authenticated `GET /memories/search?q=...`. The route validates a 1–200 character query and limits requests per signed-in owner.

The backend loads current saved memories belonging to that owner. Drafts and deleted records are excluded. For saved chats, it reads only messages matching both the owner and the permitted conversation IDs. It combines word matches with model similarity, then reloads selected sources and rechecks freshness before returning results.

The response keeps the normal paginated `data.docs` contract and adds:

```json
{"search":{"mode":"hybrid","preparing":false,"limited":false}}
```

`hybrid` means word and description matching are available. `keyword` means word search. `preparing` signals successfully queued preparation. `limited` explains incomplete description coverage.

When the new endpoint is unavailable during rollout, the frontend can call the existing `/memories?search=...` endpoint and identify the result as word search. Authentication, permission, validation and rate-limit errors must not be bypassed by that compatibility path.

**Main implementation:** `src/module/api/memory/search.ts`, memory route/controller/validator/DTO, and `src/services/memory-search/{source,chats,load}.ts`.

## 4. Prepare saved content in the background

The existing BullMQ worker process gains an optional `memory-description-search` worker. Saves, edits, restores and supported chat-turn saves queue work for eligible owners. Searching also detects and queues existing or stale content in bounded batches.

The worker loads current app content, divides text into bounded pieces and runs the embedding model. The resulting private search vectors are stored on their owning memory in an optional hidden `search_index` field. Normal API serialization removes this field. Permanent memory/account deletion removes it with the memory, without a separate vector collection.

A source fingerprint identifies the exact story content, owned chat-message content and relevant live photo metadata. Content changes and deletions invalidate old vectors. The worker rechecks the source before saving; search checks again before using a vector and before returning a result. A failed unchanged source has a ten-minute cooldown to avoid repeated expensive failures. Changing the source permits an earlier retry.

For photos, the worker uses the existing authorized storage adapter. It does not fetch arbitrary supplied URLs. Temporary image copies are private and deleted after processing. The first rollout sets photo preparation off, so text can be evaluated independently of storage configuration.

**Main implementation:** `src/services/memory-search/indexing.ts`, `src/services/queues/memory-search`, `src/workers/memory-search`, and the optional private schema in `src/module/database/model/memory.ts`.

## 5. Run the search engine on the application server

DigUp's embedding worker is an external server executable. Memento uses its embedding protocol; it does not launch the desktop app, use its folder crawler, or install it on users' devices.

The native Linux helper has now been built and verified for the test server. The build pins:

- DigUp source commit `ca6e877be139997ef259e1a5f84881394c46332c`.
- The upstream pinned llama.cpp build and patch.
- EmbeddingGemma 2 Q8_0 model revision `bfcd298762cc34d0357ece5ebdd31791a3a374d8` and the documented file checksums.
- The expected worker metadata, 768-dimensional vectors, runtime vector version and encoder type.

The native Linux package must contain its required runtime libraries and license notices. A builder container is used to produce the native package; Docker is not intended to be a required part of each application search request.

Before installation, run the real helper through the authenticated API against fictional stories/public test photos in a temporary database. Measure query startup and response time on Linux. The current per-query model timeout is three seconds: if the server cannot reliably meet it, startup/model reuse or the execution budget needs engineering work before activation. Do not silently relax limits or claim success because the UI falls back to words.

**Verified build files:** `ops/memory-search/Dockerfile`, `ops/memory-search/build-linux.sh`, and `.github/workflows/memory-search-prepare.yml`. The native package passed the Linux integration checks and three query probes on the test server within the three-second deadline.

## 6. Initial limits for review

- At most 200 live owned memory/conversation records for semantic retrieval.
- At most 2,000 messages across the chat sources read for one search; 8,000 characters per message and approximately 230,400 characters per transcript/story.
- At most five supported photos per memory when photo preparation is enabled.
- Supported photos: JPEG, PNG, WebP, HEIC and HEIF; bounded original size, decoded pixels and resized input.
- One preparation job at a time per worker; bounded local helper concurrency.
- Query and preparation deadlines, plus fast-failing queue operations.

Accounts or transcripts outside these bounds use word search. These are pilot bounds, not the final large-library design. The developer should review them against expected real account sizes before wider rollout.

## 7. Test-server rollout sequence

1. **Isolate the change.** Start from the current deployed development baseline. Include only search work; preserve unrelated unfinished People/UI work. Regenerate API contracts in that clean checkout.
2. **Review the patch.** Review permission checks, chat freshness, ranking, resource bounds, native-package contents and deployment scripts. Resolve important findings.
3. **Verify gates.** Run repository-required formatting, lint, build and tests. Run the Linux actual-model checks, including useful no-match cases. Confirm that the test server has compatible architecture, libraries and enough memory.
4. **Prepare the server.** Use Memento's existing GitHub deployment login. Install the verified helper and model files outside disposable release folders, with restricted permissions. No new private key should be sent through chat.
5. **Deploy the backend through the existing release process.** Retain the previous immutable release for rollback. Keep the feature disabled until the runtime is verified on that host.
6. **Enable the test owner only.** Set matching API and worker configuration, initially with photos disabled. Restart the relevant processes and confirm readiness.
7. **Prepare app content and test in the app.** Use the app on port 5173 against the updated test backend. Confirm the response is actually `hybrid`, not the compatibility fallback. Validate useful paraphrases and correct story/chat opening.
8. **Evaluate before expansion.** Review relevance, latency, failures and privacy. Enable photos only after storage reads and file-access checks pass. Broader accounts and production require a separate rollout decision.

The preparation workflow builds/tests the runtime and checks the server platform. The normal development workflow deploys the backend. A separate activation workflow installs the verified runtime, applies the account allowlist, checks both running processes and restores the prior settings if activation fails.

Server-only settings, shared by API and worker:

```dotenv
MEMORY_SEARCH_ENABLED=true
MEMORY_SEARCH_USER_IDS=<approved-test-owner-id>
MEMORY_SEARCH_DIGUP_PATH=/absolute/server/path/to/digup
MEMORY_SEARCH_MODELS_DIR=/absolute/server/path/to/models
MEMORY_SEARCH_PHOTOS_ENABLED=false
```

These settings and credentials must not be put in Vite/client configuration or committed as real environment values.

## 8. Acceptance checks

- A paraphrase finds the correct saved story even when the full search wording does not occur in it.
- A paraphrase can find a saved chat from its message text, not just its title.
- Word/name search still works when the model is disabled or unavailable.
- A deliberate no-match query does not consistently return an unrelated memory.
- Story results open the standard app viewer; chat results open their saved conversation.
- Another account, deleted memory, draft, shared-space record or capsule is never surfaced through this feature.
- Edits and message deletions stop old semantic matches from being used; rebuilt content becomes searchable again.
- API responses and logs do not expose vectors or internal transcripts.
- Account deletion removes derived search data.
- Preparation cannot block ordinary saves or keep a failed source polling indefinitely.
- Turning the feature off restores word-only behavior. Release rollback restores the previous backend; previously generated vectors remain private and ignored while disabled.

## 9. Evidence and work still open

The full backend suite passed with 666 tests and four skips, and the normal development deployment passed its checks. Focused frontend, privacy and routing tests have also passed during implementation. Actual Linux-model testing on a small fictional development set returned the expected memory first for 19 of 20 positive queries and no results for four of five negative queries. This set was used during development; it is not an independent accuracy benchmark, and it did not establish production chat-search quality.

The hosted search endpoint is deployed. The Linux package, server query probes and development deployment are verified. Account activation succeeded in [workflow run 38627178043](https://github.com/mementoAI-git/api/actions/runs/38627178043), and the authenticated app has returned `hybrid` mode. Hosted checks through the app on port 5173 found “Waiting for the sunset meeting” from “appointment at dusk” and the saved salary/salt-allowance conversation from “compensation derived from edible minerals”. The latter wording is absent from the chat, apart from the common word “from”. Clicking the story opened the standard View Story modal without a 404, and clicking the chat opened its saved conversation route. Content preparation is still running and some sources have entered the retry cooldown; full coverage, failure diagnosis and broader relevance review remain open. These two examples establish basic end-to-end operation, not a general accuracy benchmark. Activation explicitly supplies the five pilot settings in PM2 app configuration because ecosystem reloads replace the nested app environment; private temporary configuration files are removed after use. Both failed earlier activation attempts restored the previous configuration. Existing unrelated frontend test/type-check failures have been documented separately and must not be mistaken for a completely clean repository baseline.

### Developer review requested

Please review the integration boundaries, owner/chat access rules, native Linux dependency choice, cold-start cost, pilot limits, ranking thresholds and rollout/rollback sequence. The main architectural decision to validate is running this particular DigUp embedding worker as a server dependency. If that cannot meet the host's latency/resource requirements reliably, change that server execution design before activation while retaining the app's permission and source-freshness guarantees.
