# Collaborator feature inventory — Web and API

Scope: customer-facing local work prepared on 16 October 2026. Admin/staff implementation is excluded. Entries marked “already in API dev” are retained dependencies, not another patch to merge. This inventory does not claim that dev is deployed to production.

| Repository | Feature/work | What it changes | Review branch/status |
|---|---|---|---|
| API | Longer About me/onboarding descriptions | Accepts up to 2,000 characters with validation and published contract updates | `feat/api-about-limit-20261016` |
| API | Spoken Chat replies | Authenticated, rate-limited narration of the exact reply in the selected voice, with cancellation and audio error handling | `feat/api-spoken-replies-20261016` |
| API | Deleted-memory recovery | Server deletion/recovery deadlines, 30-day recovery window, restore and legacy timestamp backfill | `feat/api-memory-recovery-20261016` |
| API | Expired-memory cleanup | Durable purge claims, scheduled worker cleanup and protection for files still referenced elsewhere | `feat/api-memory-recovery-20261016` |
| API | Recovery integration correctness | Keeps draft deletion out of activity tracking and prevents cache failures from invalidating successful delete/restore responses | `feat/api-memory-recovery-20261016` |
| API | Customer feature flags | Endpoint and contract are already upstream; this package adds customer authentication/account-isolation regression coverage only | Runtime already in API `dev` (`53e240c`); tests in `test/api-customer-flags-20261016` |
| API | People/connections/shared spaces | Invitations, activation, connection settings/blocking, shared items, contributions and private Talk | Already in `origin/dev`; retain remote implementation (People PR #60) |
| API | Description-based memory search | Search endpoint, access filtering, source/indexing/worker pipeline and trial tooling | Already in `origin/dev`; retain newer search/embedding implementation (PR #72 and follow-ups) |
| Web | Shared UI and request recovery | Error normalization, retry behavior, shared dialogs/buttons/inputs, theme and motion foundations | `feat/web-session-ui-20261016` |
| Web | Authentication and session isolation | Login/registration/password recovery, email codes/2FA, session cleanup and account-scoped state | `feat/web-session-ui-20261016` |
| Web | Onboarding | Draft/save/skip/retry behavior and guarded progression | `feat/web-session-ui-20261016` |
| Web | Profile and settings | Avatar/banner uploading and positioning, About me editing, security recovery and consistent dialog styling | `feat/web-profile-billing-20261016` |
| Web | Billing and pricing | Subscription/storage loading and error recovery, pricing and cancellation states | `feat/web-profile-billing-20261016` |
| Web | People and shared spaces | Connections, blocked-person recovery, contributions/media, activation and private Talk; beneficiary/group recovery | `feat/web-people-20261016` |
| Web | Continuous Chat | Send/history/loading/retry behavior, lifecycle protection and current settings drawer wiring | `feat/web-chat-recovery-20261016` |
| Web | Chat voice and files | Voice/settings recovery, audio replies/playback cancellation, conversation file handling | `feat/web-chat-recovery-20261016` |
| Web | Stories and drafts | Composer/detail/list recovery, autosave/draft isolation, upload retries and attachment handling | `feat/web-stories-recovery-search-20261016` |
| Web | Delete/Undo/restore | Timed Undo toast, recovery countdowns and correct active/deleted list updates | `feat/web-stories-recovery-search-20261016` |
| Web | Search and media previews | Description search with recovery/fallback, thumbnail and document/audio/video preview behavior | `feat/web-stories-recovery-search-20261016` |
| Web | Quick notes and recording | Capture save recovery, recording/dictation lifecycle, draft preservation and error toasts | `feat/web-stories-recovery-search-20261016` |
| Web | Overview and Explore | Card/page loading, empty/retry states, capture presentation and navigation integration | `feat/web-dashboard-utilities-20261016` |
| Web | Navigation and quick tools | Header/sidebar/theme interactions, streak recovery and background music controls | `feat/web-dashboard-utilities-20261016` |
| Web | Public and utility flows | Shared posts/capsules, invitation acceptance, feedback, invite friends, Insights and not-found recovery | `feat/web-dashboard-utilities-20261016` |
| Web | Local state previews | Development-only preview transport, fixtures and state-testing tools | `feat/web-local-preview-20261016` — optional tooling |
| Web | Customer flag provider | Uses the API evaluation endpoint while preserving the current administrative UI | `feat/web-customer-flags-20261016` |
| Web | Handoff and audit documentation | People specifications, state audit, implementation plans and project guidance | `feat/web-handoff-docs-20261016` |

Branch order, dependencies, validation and deployment gates are in HANDOFF.md and VALIDATION.md. These are stacked review branches: a later branch includes the commits below it.
