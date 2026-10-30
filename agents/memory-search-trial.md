# Description-based memory search trial

This is the first experiment for adopting DigUp's retrieval in Memento. It searches an explicitly listed local collection of photos and written stories. It does not change the app, connect to accounts, access Memento storage or send sample content to an external AI service.

## Run the prepared trial

From `api`:

```sh
npm run search:trial -- \
  --manifest test/fixtures/memory-search-trial/collection.json \
  --digup tmp/memory-search-trial-runtime/digup \
  --models tmp/memory-search-trial-runtime/models
```

The runtime and models have been prepared locally in the ignored `tmp/memory-search-trial-runtime` directory. They are not application dependencies and are not committed. The source and fixtures are versionable. No paid API key is required.

Read `tmp/memory-search-trial/results.md` for the human-readable results or `results.json` for the full measurements. Each run gets a fresh private index; its temporary sample copies, vectors and engine logs are deleted afterward. Reports retain queries, sample titles/IDs, ranks, counts and durations, so use the default ignored destination for any private trial. Original stories and photos stay unchanged.

## Setup on another machine

The verified trial used the Apple Silicon helper from [DigUp v0.6.1](https://github.com/ARahim3/DigUp/releases/tag/v0.6.1) on macOS. The helper is inside the disk image at `DigUp.app/Contents/Helpers/digup`. Copy it into `tmp/memory-search-trial-runtime/digup` and retain the distribution's license notices. Alternatively build the `digup` product following the upstream build instructions for that release. Do not install it into the running backend or worker service.

The upstream CLI downloads and checks its model files:

```sh
tmp/memory-search-trial-runtime/digup download-model \
  --to tmp/memory-search-trial-runtime/models
```

This setup step requires network access for approximately 865 MB of model files. Indexing and searching use the downloaded files locally. The runner requires `--models` explicitly, so it does not accidentally use a different model cache.

Verified upstream model repository: `ggml-org/embeddinggemma-2-GGUF`, revision `bfcd298762cc34d0357ece5ebdd31791a3a374d8`. SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `embeddinggemma-2-Q8_0.gguf` | `2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135` |
| `mmproj-embeddinggemma-2-Q8_0.gguf` | `c4a8a52691ecef40618438928bdf9e68379b854e24166f292592353db0aab64f` |

DigUp is MIT-licensed; the model is Apache 2.0. This repository invokes the external engine and does not copy its source into the application. Public photo origins and licenses are in the fixture README.

## Test another collection

Copy the fixture collection into a separate local directory, replace its samples and edit `collection.json`. Use only files explicitly approved for the experiment. Do not export real accounts or share private files simply to populate the trial.

Each memory has a stable `id`, display `title`, `kind` (`story` or `photo`) and relative `file`. Each query has `text`, `expected` (one or more correct memory IDs, or `[]` for no match), and optional `kind` to constrain results to stories or photos. The runner reads only the listed files, not the whole folder. Example:

```json
{
  "version": 1,
  "memories": [
    {"id": "story01", "title": "Starting out", "kind": "story", "file": "story01.txt"},
    {"id": "photo01", "title": "A day together", "kind": "photo", "file": "photo01.jpg"}
  ],
  "queries": [
    {"text": "our first home", "expected": ["story01"], "kind": "story"},
    {"text": "people at the beach", "expected": ["photo01"], "kind": "photo"},
    {"text": "a skiing holiday", "expected": []}
  ]
}
```

Supported files are TXT/Markdown stories and JPG/JPEG/PNG/WebP/HEIC photos. Limits: 2–30 files, 1–50 queries, 1 MiB per story, 20 MiB per photo, 100 MiB total. Files must remain inside the manifest folder; symlinks and unsupported file types are rejected. Do not use a descriptive filename to make a meaning-search test artificially easy.

The report compares DigUp with a deliberately simple title/body keyword search. It does not claim to reproduce live Memento retrieval or Supermemory. A run fails if indexing has zero vectors, unfinished or skipped files, or results from outside the approved collection. Child processes have bounded runtime, no shell and no inherited backend API credentials.

## First measured result, 14 October 2026

- 10 fictional family stories and 2 public-domain/CC0 photos; 19 queries total.
- Correct first result on 14 of 16 positive queries; the simple keyword comparison scored 5 of 16.
- Correct first result on 10 of 12 story queries, 3 of 3 photo-only positive queries and 1 of 1 mixed positive query.
- No results for all 3 intentionally unrelated queries.
- Misses: “how Dad got his first job” and “family spending an evening without lights.” Both expected stories exist; the engine's default relevance threshold returned no match.
- Indexing took about 4–10 seconds across two runs. Cold searches took roughly 0.6–0.9 seconds each on this machine. These are local smoke-test measurements, not production performance claims.

The full, generated table is in the local `tmp/memory-search-trial/results.md` report. Exact durations vary across runs. Runtime: llama.cpp `b11461`, vectors version `1`; text/media Q8_0 model files listed above. Default DigUp ranking and relevance thresholds were retained; no sample-specific tuning was applied.

## What this evidence supports

The result supports a broader, owner-only retrieval pilot. It does not establish recognition of a family member by name, multilingual quality, retrieval quality across thousands of memories or readiness for shared/capsule access. Visual search recognizes visible content; a person's identity and relationship need metadata or confirmation. Add more diverse, explicitly approved samples and hard no-match cases before choosing relevance thresholds.

Application integration should reuse the existing memory/file access contracts and worker queues. It needs permission-scoped retrieval, source edit/deletion invalidation, authenticated media delivery, keyword fallback and tests for other users' content. Shared memories, unreleased capsules and AI-chat citations remain outside this initial trial. Supermemory remains in place.

## Verification

```sh
npx vitest run test/search-trial/trial.test.ts
npx eslint src/scripts/memory-search-trial/*.ts test/search-trial/trial.test.ts
npm run compile
```

The trial's automated tests do not require the downloaded engine or model. The prepared trial command above is the separate real-model check.

Verification on 14 October 2026: all 13 trial tests pass; scoped lint passes; backend TypeScript compilation passes. Full backend lint exits successfully with 153 existing warnings and no errors. The full backend suite produced 558 passes and two Google OAuth audience failures with the inherited local environment. Both affected files then passed all 7 tests with the synthetic fixture Google audience explicitly supplied for the test process; no authentication code or environment files were changed.
