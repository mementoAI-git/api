# Memento — Enrichment Score (plain-language guide)

This document explains what the Enrichment Score is supposed to be, how it fits together, and how that compares to what the Memento product actually does today across the API and web app. You do not need to be a developer to read it.

If you only want the mismatch list, jump to Section 5 — Discrepancies.

---

## 1. What the Enrichment Score is (in simple terms)

Think of the Enrichment Score as a 0–100% "how complete a picture we have of this person" meter.

- It is not just "how many words they typed." The idea is breadth and richness across different parts of life (relationships, work, beliefs, everyday habits, etc.).
- It should feel motivating: always possible to grow, never hopeless.
- The product spec also says the score can slowly drift down if someone goes quiet for a long time—but it should never fall to zero (there is a floor, e.g. 5%).

Where it is supposed to show up (per your spec):

| Place | What users should see |
|---|---|
| Dashboard | A proper score widget (big number, progress ring, breakdown by category) |
| Profile | Same idea in context |
| AI chat | A panel showing enrichment while chatting |

Rules for beneficiaries: Beneficiaries cannot use the host's Memento AI until the host's score reaches 20%. After that, access stays unlocked forever (even if the score later drops)—stored as something like `beneficiary_access_unlocked: true`.

---

## 2. The ten life categories (axes of the score)

Your spec defines 10 categories. Each piece of meaningful content (insights, uploads, memories, chat-derived items, etc.) is supposed to be tagged with one primary category. Each category has its own sub-score (0–100), and the overall score is a weighted average of those ten.

The ten names in the spec (technical keys):

| # | Friendly name (from your doc) | Spec key (EnrichmentCategory) |
|---|---|---|
| 1 | Identity & Self | identity_self |
| 2 | Relationships & People | relationships_people |
| 3 | Work & Purpose | work_purpose |
| 4 | Memories & Experiences | memories_experiences |
| 5 | Beliefs & Worldview | beliefs_worldview |
| 6 | Passions & Interests | passions_interests |
| 7 | Heritage & Roots | heritage_roots |
| 8 | Lessons & Wisdom | lessons_wisdom (deferred: week 2+) |
| 9 | Hopes & Legacy | hopes_legacy (deferred: week 3+) |
| 10 | Everyday Life | everyday_life |

Deferred categories: `lessons_wisdom` and `hopes_legacy` are not meant to appear in onboarding at first. They unlock after enough active usage (your spec: e.g. 2 weeks / 3 weeks with "active" defined as sessions with contributions).

---

## 3. How scoring is supposed to work (conceptually)

**Per category**

- Each category has its own score, influenced by things like: how much accepted content maps to it, how substantial the content is, and recency (recent activity counts a bit more).
- Your spec includes weights that can be seeded from onboarding (priorities the user chose get a higher weight, deferred categories start lower, etc.).

**Overall score**

- Weighted average of the ten category scores (not a simple plain average unless all weights are equal).

**Decay (inactivity)**

- If someone does not contribute for a while, category scores can decay slowly (your example: after 14 days idle, lose about 2% per week per category).
- There is a floor on the overall score (your example: never below 5%).
- Decay can pause if they were recently active in any category (your example: activity within 7 days).

**Supermemory (conversation-derived memories)**

- Your spec says: when the system saves structured memory from AI chat, it should automatically count toward enrichment (pre-accepted, no review modal), with a slightly lower weight (e.g. 0.9×) than things the host explicitly wrote.
- The Memory tab should show a "From conversation" style label.

**Insight tagging**

- New insights should be auto-tagged with one of the 10 categories (JSON line on the insight, per your prompt appendix).

**Dashboard nudges**

- Surface the lowest-scoring category (that is not deferred) as a gentle prompt suggestion.

---

## 4. What the product actually does today

### 4.1 Backend — `/users/stats` is now a real enrichment endpoint

The API already computes a real enrichment snapshot for the user and returns it from `GET /users/stats`.

Today that payload includes:

- `enrichment_score` — one overall percentage
- `category_scores` — the per-category breakdown
- `lowest_category` — used for nudge logic
- `beneficiary_access_unlocked`
- `milestone`
- `nudge`
- `jump_pills`
- `spotlight`
- supporting counts like stories, reflections, pending insights, and quick-capture pending state

Under the hood, the backend is already doing the main scoring work:

- conversation-derived items count at a slightly lower weight than explicit stories
- onboarding priorities increase category weight
- deferred categories unlock later based on account age
- inactive categories can decay over time
- the overall score has a floor

Important caveat: the code comment says beneficiary access should unlock forever after 20%, but the current implementation still computes that as `enrichment_score >= 20` in the moment. So the field exists, but the “forever unlocked” part is not yet persisted.

### 4.2 Web app — some surfaces are live, some are still partial

The web app is no longer purely stubbed:

- **Overview dashboard** shows the real `enrichment_score` from `GET /users/stats`.
- **Post-onboarding summary** also reads the real score from `GET /users/stats` and combines it with a 10-category onboarding coverage map.

But some enrichment UI is still partial:

- the main **host chat enrichment bar** is still a placeholder UI rather than a fully wired category breakdown
- the old milestone card in host chat still is not driven by a live per-message enrichment delta
- there is still no full profile/sidebar breakdown experience for the 10 categories

### 4.3 Onboarding and Host Chat use the same enrichment categories

Onboarding "what matters most" and Host Chat deep dive both use `EnrichmentCategory` (10 keys). Definitions live in `src/features/enrichment/enrichment-categories.ts`. `DIMENSION_OPTIONS` in onboarding types re-exports the full list; `ONBOARDING_DIMENSION_OPTIONS` is the subset without deferred categories (`lessons_wisdom`, `hopes_legacy`) for the initial onboarding step.

When loading saved onboarding from the API, legacy keys (`people_relationships`, `memories_stories`, etc.) are migrated to canonical values via `migrateLegacyPriorityList` / `migrateLegacyPriorityDimension`.

File references:
- `src/features/enrichment/enrichment-categories.ts`
- `src/features/onboarding-groot/types.ts` (EnrichmentCategory, DIMENSION_OPTIONS, ONBOARDING_DIMENSION_OPTIONS)
- `src/features/host-chat/chat.types.ts` (LifeDimension)

---

## 5. Discrepancies (spec vs product today)

| Topic | Your spec says… | In the product today… |
|---|---|---|
| Category taxonomy | 10 EnrichmentCategory keys | Implemented in `src/features/enrichment/enrichment-categories.ts`; onboarding + host chat aligned. Legacy API values are migrated on read. |
| Overall score display | Dashboard widget + profile + chat context | Overview and post-onboarding summary use the live `enrichment_score` from `/users/stats`. Main chat context is still partial. |
| Category breakdown UI | 10-bar mini chart, tooltips | Backend returns `category_scores`, but the full breakdown UI is still not built across the product. |
| Weighted average & seed weights | Formula + onboarding-based weights | Implemented on the backend; not explained visually in the UI. |
| Decay & floor | 14-day rule, weekly decay, 5% floor, pause rules | Implemented in backend scoring logic; still mostly invisible to the user. |
| 20% beneficiary gate | Unlock Memento AI for beneficiaries at 20%; permanent flag | Backend returns `beneficiary_access_unlocked`, but the “unlock forever” behavior is still computed from the current score instead of being persisted permanently. |
| Supermemory | Auto-accepted, 0.9× weight, "From conversation" label | Conversation-derived weighting exists in backend scoring, but the full user-facing “From conversation” product layer is still incomplete. |
| Insight JSON tagging | AI appends `{"category": "…"}` | Not implemented in this frontend repo (generation is backend / prompt). |
| Deferred categories & unlock schedule | Week 2 / week 3, session rules | Implemented in backend scoring using account age; still not surfaced very explicitly in UI. |
| Milestone after chat | `enrichmentDelta` after an exchange | Milestone data exists on `/users/stats`, but the per-exchange host-chat milestone moment is still not fully wired. |
| Visual design details | Lora serif, amber ring | Current UI styling differs from the older spec visuals. |

**Bottom line:** The scoring engine is no longer hypothetical. The backend already computes a meaningful enrichment snapshot and exposes it through `/users/stats`, and the web app already uses that real data in overview and post-onboarding summary. What is still missing is the fuller user-facing enrichment experience: richer breakdown UI, cleaner beneficiary-unlock persistence, and better chat-surface wiring.

---

## 6. Suggested next steps (for product + engineering)

1. **Frontend milestones:** (1) Wire host chat bar + milestone to real API fields. (2) Add profile/sidebar breakdown when design + data exist. (3) Surface jump pills, spotlight, and richer category context where product wants them.
2. **Persistence cleanup:** Make `beneficiary_access_unlocked` truly permanent once the user crosses 20%, instead of recalculating it from the current score only.
3. **Keep this doc updated** when the spec or the API changes.

---

## 7. Quick file map (for developers)

| Area | Location |
|---|---|
| Overview enrichment % | `memento-web/src/pages/dashboard/overview/sections/welcome-section.tsx` |
| Onboarding summary enrichment | `memento-web/src/pages/onboarding/summary.tsx` |
| Chat enrichment stub + milestone | `src/features/host-chat/components/host-chat-enrichment-bar.tsx`, `milestone-card.tsx` |
| Chat screen wiring | `memento-web/src/pages/dashboard/chat/conversation/index.tsx` |
| Stats endpoint path | `memento-web/src/api/endpoint.ts → userStats: "/users/stats"` |
| User stats response builder | `src/module/api/user/service.ts → getUserStats()` |
| Enrichment computation | `src/services/enrichment/index.ts → computeEnrichmentScore()` |
| Enrichment categories (canonical) | `memento-web/src/features/enrichment/enrichment-categories.ts` |
| Onboarding re-exports | `memento-web/src/features/onboarding-groot/types.ts` |
| Host chat deep-dive dimensions | `memento-web/src/features/host-chat/chat.types.ts` |
| Backend handoff (related) | `docs/MEMENTO_HOST_CHAT_BACKEND_WORK.md` |

This document summarizes your enrichment spec and compares it to the memento-web repository. It is not a promise of roadmap priority—use it to align conversation between product, design, backend, and frontend.
