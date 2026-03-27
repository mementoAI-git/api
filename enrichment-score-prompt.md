# Memento — Enrichment Score System Prompt
**Feature:** Enrichment Score engine + 10-category taxonomy  
**Stack:** React + TypeScript. Cursor / Windsurf in-codebase.

---

## 1. What the Enrichment Score Is

The Enrichment Score is a dynamic percentage (0–100%) that measures how fully a host has represented themselves as a complete human being across 10 dimensions of their life. It is not a raw content count — it measures **richness and breadth of representation**, not volume.

It appears in:
- The host dashboard (sidebar + context panel)
- The host's profile page
- The AI chat context panel
- As a quality gate: beneficiaries cannot access the host's Memento AI until the score reaches 20%. Once crossed, access is permanently unlocked (stored as a boolean flag `beneficiary_access_unlocked: true`).

The score grows with accepted insights and contributions. It decays slowly without activity (never reaching zero). It should always feel like progress is possible.

---

## 2. The 10 Categories

Each category is an axis of the Enrichment Score. Every accepted insight, uploaded file, recorded memory, or prompt response is tagged to one or more categories. The score for each category grows as content accumulates.

---

### 1. Identity & Self
**What it covers:** Personality, values, self-perception, how they've changed, what they're proud of, how they handle difficulty.
**Why it matters:** The foundation. Everything else is coloured by who this person is at their core.
**Prompt examples:**
- "How would the people who know you best describe you?"
- "What belief have you changed your mind on?"
- "What part of yourself took the longest to accept?"

---

### 2. Relationships & People
**What it covers:** Named people who mattered — family, friends, partners, mentors, rivals. Specific relationship dynamics, not abstract values.
**Why it matters:** People are remembered through their relationships. This is often what beneficiaries want most.
**Prompt examples:**
- "Tell us about someone who shaped who you are."
- "Who do you wish you'd spent more time with?"
- "Describe the person you've loved the longest."

---

### 3. Work & Purpose
**What it covers:** Career arc, what drove choices, what was built, pivots, regrets, professional identity.
**Why it matters:** Work is where most people spend the majority of their adult lives. It reveals values, ambition, and sacrifice.
**Prompt examples:**
- "What's the hardest professional decision you ever made?"
- "What did your work teach you about yourself?"
- "What are you most proud of building?"

---

### 4. Memories & Experiences
**What it covers:** Specific events, named places, turning points, firsts, adventures, milestones.
**Why it matters:** This is the narrative layer — the stories that make a life feel lived. Highest natural contribution volume.
**Prompt examples:**
- "Describe a day you'd want to live again."
- "What's a moment you've never fully told anyone about?"
- "What trip or place changed you?"

---

### 5. Beliefs & Worldview
**What it covers:** Faith, philosophy, politics, ethics, what they'd die on a hill for. Ideas they hold, distinct from who they are.
**Why it matters:** Beliefs reveal the invisible architecture of a person's decisions.
**Prompt examples:**
- "What do you believe that most people around you don't?"
- "How has your faith or philosophy evolved over time?"
- "What's something you believe is true but can't prove?"

---

### 6. Passions & Interests
**What it covers:** Hobbies, obsessions, what they consume, what they make, what they'd talk about for hours.
**Why it matters:** Passions are the texture of personality. They humanise the host beyond achievements and relationships.
**Prompt examples:**
- "What would you talk about for three hours without stopping?"
- "What hobby do you wish you'd started earlier?"
- "What are you learning right now?"

---

### 7. Heritage & Roots
**What it covers:** Cultural identity, family origin stories, traditions carried or abandoned, language, place, ancestry.
**Why it matters:** Heritage grounds the host in a lineage. It's often invisible to younger beneficiaries until it's documented.
**Prompt examples:**
- "What did your family do that most families didn't?"
- "What tradition do you hope survives you?"
- "Where do you feel most like yourself, and why?"

---

### 8. Lessons & Wisdom
**What it covers:** Hard-won realisations, advice they give, mistakes they learned from, what hardship taught them.
**Why it matters:** This is the category beneficiaries will return to most. The distilled wisdom of a life.
**Deferred:** Not introduced in onboarding. Unlocked progressively after Week 2 of usage.
**Prompt examples:**
- "What do you know now that you wish someone had told you at 25?"
- "What's the most useful thing failure ever taught you?"
- "What advice do you keep giving that nobody takes?"

---

### 9. Hopes & Legacy
**What it covers:** What they want remembered, letters to specific people, fears about being forgotten, what they're still working toward.
**Why it matters:** The most forward-facing category. Directly powers the Time Capsules feature.
**Deferred:** Not introduced in onboarding. Unlocked progressively after Week 3 of usage.
**Prompt examples:**
- "What do you hope people feel when they think of you?"
- "Is there something you want to say to someone that you haven't yet?"
- "What do you want to be true about the world when you're gone?"

---

### 10. Everyday Life
**What it covers:** Routines, food preferences, comfort rituals, pet peeves, small joys, ordinary days.
**Why it matters:** The most humanising category. Often overlooked but deeply personal — it's what beneficiaries miss most.
**Prompt examples:**
- "Walk us through a perfect ordinary day."
- "What small thing makes your day better every time?"
- "What does your morning look like when everything goes right?"

---

## 3. Scoring Logic

### Category Score
Each category scores 0–100% independently based on:
- Number of accepted insights tagged to it
- Richness of content (short responses score less than detailed ones)
- Recency (recent contributions carry slightly more weight)

```typescript
type EnrichmentCategory =
  | 'identity_self'
  | 'relationships_people'
  | 'work_purpose'
  | 'memories_experiences'
  | 'beliefs_worldview'
  | 'passions_interests'
  | 'heritage_roots'
  | 'lessons_wisdom'
  | 'hopes_legacy'
  | 'everyday_life';

interface CategoryScore {
  category: EnrichmentCategory;
  score: number;           // 0–100
  weight: number;          // multiplier from onboarding seed
  contribution_count: number;
  last_contributed: string;
}
```

### Overall Score
Weighted average of all 10 category scores:

```
overall_score = Σ (category_score × category_weight) / Σ category_weights
```

### Seeding from Onboarding
On onboarding completion, set initial category weights:

```typescript
const seedWeights = (priorityDimensions: EnrichmentCategory[]): Record<EnrichmentCategory, number> => {
  const all = ALL_CATEGORIES;
  return Object.fromEntries(
    all.map(cat => [
      cat,
      priorityDimensions.includes(cat) ? 1.2 :
      ['lessons_wisdom', 'hopes_legacy'].includes(cat) ? 0.6 : 0.8
    ])
  );
};
```

### Decay
- If no contribution in 14 days: category score decays by 2% per week
- Overall score never drops below 5% (floor)
- Decay pauses if the host has been active in any category within 7 days

### Beneficiary Access Gate
```typescript
if (overall_score >= 20 && !host.beneficiary_access_unlocked) {
  host.beneficiary_access_unlocked = true;
  // trigger notification to beneficiaries
}
```
Once unlocked, this flag never reverts regardless of score decay.

---

## 4. Supermemory Integration

Supermemory captures context from the host's AI conversations and stores it as structured memory objects. These feed the Enrichment Score as a continuous, passive data source — the host doesn't have to do anything extra.

### How it works

Every time Supermemory saves a memory object from a conversation, the system:
1. Reads the memory content
2. Tags it to an `EnrichmentCategory` (same tagging logic as insights — see §5)
3. Creates a **pre-accepted insight** — Supermemory data skips the review modal because it was already generated from a conversation the host participated in
4. Increments the relevant category score

```typescript
interface SupermemoryContribution {
  source: 'supermemory';
  memory_id: string;           // Supermemory's ID
  content: string;
  category: EnrichmentCategory;
  derived_from: 'chat';
  contributed_at: string;
  score_delta: number;         // how much this moved the category score
}
```

### Key distinctions from regular insights

| | Regular insights | Supermemory contributions |
|---|---|---|
| Requires host review | Yes | No — auto-accepted |
| Source | Chat, uploads, prompts | AI conversation context only |
| Appears in review modal | Yes | No |
| Visible to host | After acceptance | In Memory tab, labelled "From conversation" |
| Score impact | On acceptance | Immediately on save |

### Weighting
Supermemory contributions carry a slightly lower score weight (`0.9×`) compared to explicitly authored content (direct prompt responses, uploads) because they are inferred rather than intentional. But they count — and over time they fill categories passively that the host might never think to address directly.

### Display
On the Profile → Memory tab, Supermemory-sourced entries are labelled with a small "From conversation" tag so the host can distinguish them from things they deliberately added. They are editable and deletable like any other memory.

---

## 5. Insight Tagging

Every insight — whether generated by the AI or accepted from onboarding — must carry an `EnrichmentCategory` tag before it reaches the review modal or the score engine.

The AI should tag insights automatically using this instruction appended to the insight generation prompt:

```
After generating the insight, append a JSON tag on a new line:
{"category": "[one of the 10 EnrichmentCategory values]"}

Choose the category that best describes what the insight reveals about the person.
If it spans two categories, choose the primary one.
```

---

## 5. Dashboard Display

### Score widget (sidebar)
- Large percentage number, Lora serif
- Thin circular progress ring, amber fill
- Below the number: category breakdown as a mini bar chart (10 bars, labelled with short category names)
- Tooltip on hover per category: category name + score + last contributed date

### Nudge logic
The dashboard surfaces the **lowest-scoring non-deferred category** as the next prompt suggestion. Example: *"You haven't added anything about your Heritage & Roots yet — want a prompt to get started?"*

Deferred categories (`lessons_wisdom`, `hopes_legacy`) are excluded from nudge logic until their unlock week.

---

## 6. Deferred Category Unlock Schedule

| Category | Unlocks after | Unlock trigger |
|---|---|---|
| `lessons_wisdom` | 2 weeks active usage | First prompt introduced in Week 2 daily prompts |
| `hopes_legacy` | 3 weeks active usage | First prompt introduced in Week 3 daily prompts |

"Active usage" = at least 3 sessions with at least 1 contribution each.
