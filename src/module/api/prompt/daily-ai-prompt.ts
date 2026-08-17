import {createUserContent} from '@google/genai';
import Memory from '../../database/model/memory';
import Message from '../../database/model/message';
import User from '../../database/model/user';
import Prompt from '../../database/model/prompt';
import DailyAiPromptCache from '../../database/model/daily-ai-prompt-cache';
import gemini, {GEMINI_MODEL} from '../../../services/gemini';
import {
  CATEGORY_LABELS,
  computeEnrichmentScore,
} from '../../../services/enrichment';
import {
  generateTextWithProviderFallback,
  isNonStreamingProviderFallbackConfigured,
} from '../../../services/ai/nonstream-fallback';

const LLM_TIMEOUT_MS = 3000;

const SYSTEM_INSTRUCTION = `You write one reflection question for one person.

Rules:
- Output exactly one sentence: a warm, specific reflection question tailored to the context.
- Conversational, not clinical. Personal, not generic.
- Target an area they have not explored much yet OR an unfinished thread from what they recently shared.
- Do not mention any product, app, scores, percentages, enrichment, or internal labels.
- Do not use bullet points, quotes around the question, or preamble.

Return plain text only — the question itself, nothing else.`;

export function stripHtmlSnippet(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('daily_prompt_timeout')), ms);
    p.then(
      v => {
        clearTimeout(t);
        resolve(v);
      },
      e => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function normalizePromptSentence(raw: string): string {
  let t = (raw || '')
    .replace(/^[\s"'“”]+|[\s"'“”]+$/g, '')
    .split('\n')[0]
    .trim();
  t = t.replace(/^(question:|reflection:)\s*/i, '').trim();
  if (t.length > 320) {
    t = `${t.slice(0, 317)}...`;
  }
  return t;
}

export function normalizeForDedupe(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function loadAnsweredDedupeSet(
  userId: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  const memories = await Memory.find({
    user: userId,
    status: {$ne: 'draft'},
    $or: [
      {prompt: {$exists: true, $ne: null}},
      {prompt_type: 'ai-generated', prompt_text: {$exists: true, $ne: null}},
    ],
  })
    .select('prompt prompt_text')
    .lean();

  const ids = [
    ...new Set(memories.map(m => m.prompt).filter(Boolean) as string[]),
  ];
  const prompts = ids.length
    ? await Prompt.find({_id: {$in: ids}})
        .select('title')
        .lean()
    : [];
  for (const p of prompts) {
    if (p.title) set.add(normalizeForDedupe(p.title));
  }
  for (const m of memories) {
    if (m.prompt_text) set.add(normalizeForDedupe(String(m.prompt_text)));
  }
  return set;
}

export async function isDuplicateAnsweredPrompt(
  userId: string,
  text: string,
): Promise<boolean> {
  const n = normalizeForDedupe(text);
  if (!n) return true;
  const answered = await loadAnsweredDedupeSet(userId);
  return answered.has(n);
}

export async function buildDailyPromptUserPayload(
  userId: string,
): Promise<string> {
  let enrichmentBlock = '';
  try {
    const e = await computeEnrichmentScore(userId);
    const sorted = [...e.category_scores]
      .filter(c => c.unlocked)
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
    if (sorted.length) {
      enrichmentBlock = sorted
        .map(
          c =>
            `- ${CATEGORY_LABELS[c.key]} (${Math.round(c.score)}% — lower means less explored so far)`,
        )
        .join('\n');
    }
  } catch {
    /* new user or compute failure */
  }

  const memories = await Memory.find({
    user: userId,
    type: 'story',
    status: {$nin: ['draft', 'deleted']},
  })
    .sort({created_at: -1})
    .limit(5)
    .select('title body category')
    .lean();

  const memBlock = memories.length
    ? memories
        .map((m, i) => {
          const snip = stripHtmlSnippet(String(m.body || '')).slice(0, 140);
          const cat = m.category ? ` [${m.category}]` : '';
          return `${i + 1}. "${m.title || 'Untitled'}"${cat}${snip ? ` — ${snip}` : ''}`;
        })
        .join('\n')
    : '';

  let chatBlock = '';
  const user = await User.findById(userId)
    .select('primary_conversation_id')
    .lean();
  if (user?.primary_conversation_id) {
    const msgs = await Message.find({
      memory: user.primary_conversation_id,
      role: 'user',
    })
      .sort({created_at: -1})
      .limit(3)
      .select('text')
      .lean();
    const ordered = [...msgs].reverse();
    if (ordered.length) {
      chatBlock = ordered
        .map((m, i) => `${i + 1}. ${String(m.text || '').slice(0, 300)}`)
        .join('\n');
    }
  }

  const dedupe = await loadAnsweredDedupeSet(userId);
  const avoidList =
    dedupe.size > 0
      ? [...dedupe].slice(0, 40).join(' | ')
      : 'None — nothing to avoid yet.';

  const parts: string[] = [];
  if (enrichmentBlock) {
    parts.push(
      `Areas of life with relatively less depth so far (use subtly; never mention numbers or this list to the user):\n${enrichmentBlock}`,
    );
  } else {
    parts.push(
      'No life-area depth breakdown yet — open with a warm, general invitation to reflect.',
    );
  }

  parts.push(
    memBlock
      ? `Recent memory titles and short hints:\n${memBlock}`
      : 'No recent memories yet.',
  );

  parts.push(
    chatBlock
      ? `Recent things the host said in chat (oldest to newest):\n${chatBlock}`
      : 'No recent chat lines.',
  );

  parts.push(
    `Reflection prompts or questions they have already responded to — do not repeat these or paraphrase them closely:\n${avoidList}`,
  );

  return parts.join('\n\n');
}

async function runLlm(userPayload: string): Promise<string> {
  const userMessage = `${userPayload}\n\nWrite one reflection question.`;

  if (isNonStreamingProviderFallbackConfigured()) {
    const r = await generateTextWithProviderFallback({
      task: 'daily_prompt_generate',
      messages: [
        {role: 'system', content: SYSTEM_INSTRUCTION},
        {role: 'user', content: userMessage},
      ],
      temperature: 0.8,
    });
    return r.text;
  }

  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: createUserContent([userMessage]),
    config: {systemInstruction: SYSTEM_INSTRUCTION},
  });
  const t = response.text;
  if (!t?.trim()) {
    throw new Error('empty_llm_response');
  }
  return t;
}

export async function generateDailyAiQuestionWithRetry(
  userId: string,
): Promise<string | null> {
  const payload = await buildDailyPromptUserPayload(userId);

  const attempt = async (): Promise<string | null> => {
    try {
      const raw = await withTimeout(runLlm(payload), LLM_TIMEOUT_MS);
      const q = normalizePromptSentence(raw);
      if (!q) return null;
      return q;
    } catch {
      return null;
    }
  };

  let text = await attempt();
  if (text && (await isDuplicateAnsweredPrompt(userId, text))) {
    text = await attempt();
  }
  if (text && (await isDuplicateAnsweredPrompt(userId, text))) {
    return null;
  }
  return text;
}

export async function getCachedAiPrompt(
  userId: string,
  dateKey: string,
): Promise<string | null> {
  const doc = await DailyAiPromptCache.findOne({
    user: userId,
    date_key: dateKey,
  })
    .select('prompt_text')
    .lean();
  return doc?.prompt_text ?? null;
}

export async function setCachedAiPrompt(
  userId: string,
  dateKey: string,
  promptText: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await DailyAiPromptCache.findOneAndUpdate(
    {user: userId, date_key: dateKey},
    {
      user: userId,
      date_key: dateKey,
      prompt_text: promptText,
      generated_at: new Date(),
      expires_at: expiresAt,
    },
    {upsert: true},
  );
}
