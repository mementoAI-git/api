# Memento Host AI — How Everything Works Together

This document explains how all the AI docs connect, what runs when, and what still needs to be built. Read this first before touching any of the other docs.

---

## The Four Documents

| Doc | What it is | Who uses it |
|---|---|---|
| **This doc** | Master overview — how it all connects | Product, engineering, design |
| **Personality Framework** | Behaviour rules, voice, modes, principles | Product decisions, design alignment |
| **Production System Prompt** | Drop-in replacement for `createSystemContext()` | Backend engineer |
| **Session Context Injection** | Session brief prompt + post-conversation pipeline | Backend engineer |

---

## How the System Works — End to End

### 1. Onboarding (one time)

The host completes onboarding via `/onboard/chat`. This seeds:
- `IPersona`: important_notes, key_preferences, goals_and_aspirations, emotional_state_trends
- `userPreferences`: communication_style, topics_of_interest, conversation_tone, response_length
- ⬜ Still needed: motivation, age_bracket, priority_dimensions, expression_mode

All of this flows into **Section 3 (Onboarding Context)** of the system prompt.

---

### 2. Every Conversation — What Gets Injected

When the host opens a chat, `createSystemContext()` assembles the full system prompt in this order:

```
┌─────────────────────────────────────────────┐
│  1. Base Personality Prompt                 │  Who the AI is, voice rules, behaviour
│  2. User Information                        │  Name, location, member since, etc.
│  3. Onboarding Context                      │  Motivation, dimensions, expression mode
│  4. Accumulated Persona (IPersona)          │  Notes, preferences, goals, emotional patterns
│  5. Session Brief                           │  Last session, open threads, gaps, depth tier
│     └─ pastConversationsContext             │  (existing — stays as-is)
│     └─ longTermContext                      │  (existing — stays as-is)
│     └─ buildSessionContextPrompt()          │  ⬜ Add when session context is built
│  6. Behavioural Guardrails                  │  Hard rules (no legacy framing, no therapy)
└─────────────────────────────────────────────┘
```

The AI enters the conversation already knowing: who this person is, what they care about, where they left off, what threads are unresolved, and what parts of their life haven't been touched.

---

### 3. During Conversation

The AI runs in one of four modes (see Personality Framework doc):

```
Opening → Reflection → Task (optional) → Closing
```

It uses the Enrichment Score silently as a depth guide:
- **Below 20%** → Foundation mode: open, gentle, identity-first
- **20–60%** → Developing: draw connections, probe depth
- **Above 60%** → Rich: challenge, surface contradictions

The score comes from `GET /users/stats → enrichment_score`. It is **never mentioned** to the host.

---

### 4. End of Every Conversation — The Pipeline

Four jobs run in parallel when a conversation ends:

```
Conversation ends
       │
       ├── buildSummarizationPrompt()       ✅ Exists
       │   └── Saves: summary, topics → conversation record
       │
       ├── buildInsightsPrompt()            ✅ Exists
       │   └── Updates: IPersona fields (notes, preferences, goals, patterns)
       │
       ├── buildOpenThreadsPrompt()         ⬜ New — add to pipeline
       │   └── Updates: IPersona.open_threads[] (max 8, deduplicated)
       │
       └── buildDimensionTaggingPrompt()    ⬜ New — add to pipeline
           └── Saves: conversation.dimensions[] (max 3, canonical keys)
```

The output of this pipeline feeds the **next** conversation's session brief.

---

### 5. The Feedback Loop

This is how the AI gets smarter over time:

```
Conversation
    │
    ▼
Post-conversation pipeline
    │
    ▼
IPersona gets richer  +  conversation.dimensions[] grows
    │                           │
    ▼                           ▼
Next session brief knows    Gap dimensions shrink
more about this person      as life areas are covered
    │
    ▼
AI asks better questions → host shares more → loop
```

---

## What's Working Now vs. What Needs Building

### ✅ Working today
- Base personality prompt (drop-in replacement ready)
- User information injection
- Accumulated persona (IPersona) — notes, preferences, goals, patterns
- Past conversations context
- Long-term context
- Enrichment score number (`/users/stats`)
- Canonical dimension keys (`src/features/enrichment/enrichment-categories.ts`)

### ⬜ Backend — add to IPersona
- `motivation: string` — from onboarding
- `open_threads: string[]` — from buildOpenThreadsPrompt() post-conversation

### ⬜ Backend — add to userPreferences
- `age_bracket: string`
- `priority_dimensions: string[]`
- `expression_mode: string`

### ⬜ Backend — add to conversation record
- `dimensions: string[]` — from buildDimensionTaggingPrompt() post-conversation

### ⬜ Backend — new logic
- `buildOpenThreadsPrompt()` — add to post-conversation pipeline
- `buildDimensionTaggingPrompt()` — add to post-conversation pipeline
- `getSessionContext(userId)` — assembles ISessionContext for session brief
- `buildSessionContextPrompt()` — append to createSystemContext()
- Deferred dimension unlock: `lessons_wisdom` at 2 weeks, `hopes_legacy` at 3 weeks

### ⬜ Frontend — wire existing stubs
- `host-chat-enrichment-bar.tsx` — hardcoded at 47%, wire to `/users/stats`
- `milestone-card.tsx` — wire to `enrichmentDelta` from send-message response

---

## Suggested Build Order

Start with what gives the most AI improvement per hour of work:

**Phase 1 — Drop in the new system prompt** (1–2 hours)
Replace the personality block in `createSystemContext()` with the Production System Prompt. Immediate improvement, no new fields needed.

**Phase 2 — Add onboarding fields** (half day)
Add `motivation`, `age_bracket`, `priority_dimensions`, `expression_mode` to `IPersona` / `userPreferences`. Wire onboarding outputs to populate them. This unlocks the full onboarding context injection.

**Phase 3 — Add open threads** (half day)
Add `open_threads[]` to `IPersona`. Run `buildOpenThreadsPrompt()` post-conversation. Add `buildSessionContextPrompt()` to `createSystemContext()`. The AI now remembers what to come back to.

**Phase 4 — Add dimension tagging** (half day)
Run `buildDimensionTaggingPrompt()` post-conversation. Implement `computeGapDimensions()`. The session brief now surfaces unexplored life areas.

**Phase 5 — Wire enrichment to frontend** (few hours)
Connect the enrichment bar and milestone card to real API data. The enrichment score depth tier in the session brief also becomes active.

**Phase 6 — Deferred dimension unlocks** (backend logic)
Implement the 2-week / 3-week unlock schedule for `lessons_wisdom` and `hopes_legacy`.
