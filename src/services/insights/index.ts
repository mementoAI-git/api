import type {FilterQuery} from 'mongoose';
import ai from '../ai';
import logger from '../../utils/logger';
import {extractJson} from '../../utils/helpers';
import {NotFoundException} from '../../utils/service-error';
import {serializeAttachment} from '../../utils/attachment-response';
import {
  buildInsightBatchRequest,
  type InsightPromptMemory,
} from '../../utils/ai-prompt/insight-batch-prompt';
import InsightBatch, {
  type IInsightBatch,
  type IInsightBatchItem,
} from '../../module/database/model/insight-batch';
import Memory, {type IMemory} from '../../module/database/model/memory';
// Registers the model that populating memory attachments depends on.
import '../../module/database/model/file';
import {
  CATEGORY_LABELS,
  ENRICHMENT_CATEGORIES,
  type EnrichmentCategory,
} from '../enrichment';

export const INSIGHTS_PER_BATCH = 4;
export const MIN_MEMORIES_FOR_INSIGHTS = 3;
const MIN_MEMORIES_PER_INSIGHT = 2;
const MEMORIES_PER_PROMPT = 60;
const EXCERPT_LENGTH = 320;
const PREVIOUS_TITLES_KEPT = 16;
const MAX_SOURCES = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_REFRESH_DAYS = 3;
const MAX_REFRESH_DAYS = 5;
/** Nothing new to connect yet, so look again tomorrow. */
const NO_NEW_MATERIAL_RECHECK_MS = DAY_MS;
const FAILED_GENERATION_RETRY_MS = 6 * 60 * 60 * 1000;
const GENERATION_LEASE_MS = 3 * 60 * 1000;

/** Same memories the enrichment score counts. */
const LIVE_MEMORY_FILTER: FilterQuery<IMemory> = {
  $or: [
    {type: 'story', status: {$in: ['save', 'queued', 'on_chain']}},
    {type: 'conversation', status: {$nin: ['draft', 'deleted']}},
  ],
};

export interface InsightDto {
  id: string;
  title: string;
  body: string;
  categories: EnrichmentCategory[];
  source_count: number;
}

export interface InsightListDto {
  insights: InsightDto[];
  generated_at: string | null;
  next_refresh_at: string | null;
  generating: boolean;
}

export interface InsightSourceDto {
  id: string;
  title: string;
  type: 'story' | 'conversation';
  created_at: string | null;
  thumbnail: string | null;
}

export function nextRefreshDelayMs(random: () => number = Math.random): number {
  const days =
    MIN_REFRESH_DAYS +
    Math.floor(random() * (MAX_REFRESH_DAYS - MIN_REFRESH_DAYS + 1));
  return days * DAY_MS;
}

function liveMemoryQuery(
  userId: string,
  extra: FilterQuery<IMemory> = {},
): FilterQuery<IMemory> {
  return {user: userId, $and: [LIVE_MEMORY_FILTER, extra]};
}

function plainExcerpt(memory: {summary?: string; body?: string}): string {
  return (memory.summary || memory.body || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, EXCERPT_LENGTH);
}

function cleanLine(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[—–]/g, ',').replace(/\s+/g, ' ').trim()
    : '';
}

/** Keeps only insights backed by real memories and real enrichment fields. */
export function parseInsightBatch(
  raw: string,
  memoryIdByRef: Map<string, string>,
): Pick<IInsightBatchItem, 'title' | 'body' | 'categories' | 'memories'>[] {
  const candidates = extractJson(raw)?.insights;
  if (!Array.isArray(candidates)) return [];

  const known = new Set<string>(ENRICHMENT_CATEGORIES);
  const parsed = [];
  for (const candidate of candidates) {
    const title = cleanLine(candidate?.title);
    const body = cleanLine(candidate?.body);
    const categories = [
      ...new Set<string>(
        Array.isArray(candidate?.categories) ? candidate.categories : [],
      ),
    ].filter(key => known.has(key)) as EnrichmentCategory[];
    const refs: unknown[] = Array.isArray(candidate?.memory_refs)
      ? candidate.memory_refs
      : [];
    const memories = [
      ...new Set(refs.flatMap(ref => memoryIdByRef.get(String(ref)) ?? [])),
    ];
    if (
      title &&
      body &&
      categories.length &&
      memories.length >= MIN_MEMORIES_PER_INSIGHT
    ) {
      parsed.push({title, body, categories, memories});
    }
  }
  return parsed.slice(0, INSIGHTS_PER_BATCH);
}

async function hasNewMaterial(userId: string, since: Date): Promise<boolean> {
  const memory = await Memory.exists(
    liveMemoryQuery(userId, {
      $or: [{created_at: {$gt: since}}, {updated_at: {$gt: since}}],
    }),
  );
  return Boolean(memory);
}

async function postpone(userId: string, delayMs: number): Promise<void> {
  await InsightBatch.updateOne(
    {user: userId},
    {
      $set: {
        generating_until: null,
        next_refresh_at: new Date(Date.now() + delayMs),
      },
    },
  );
}

/** Generates the next batch. The current batch stays until a new one is valid. */
export async function refreshInsightBatch(
  userId: string,
  batch: Pick<IInsightBatch, 'generated_at' | 'previous_titles' | 'insights'>,
): Promise<void> {
  if (
    batch.generated_at &&
    !(await hasNewMaterial(userId, new Date(batch.generated_at)))
  ) {
    await postpone(userId, NO_NEW_MATERIAL_RECHECK_MS);
    return;
  }

  const rows = await Memory.find(liveMemoryQuery(userId))
    .sort({updated_at: -1, created_at: -1})
    .limit(MEMORIES_PER_PROMPT)
    .select('title summary body dimensions tags created_at')
    .lean();
  const known = new Set<string>(ENRICHMENT_CATEGORIES);
  const memoryIdByRef = new Map<string, string>();
  const memories: InsightPromptMemory[] = [];
  for (const row of rows) {
    const excerpt = plainExcerpt(row);
    if (!excerpt) continue;
    const ref = `M${memories.length + 1}`;
    memoryIdByRef.set(ref, String(row._id));
    memories.push({
      ref,
      excerpt,
      title: cleanLine(row.title) || 'Untitled',
      date: row.created_at
        ? new Date(row.created_at).toISOString().slice(0, 10)
        : 'unknown date',
      fields: [...(row.dimensions ?? []), ...(row.tags ?? [])].filter(key =>
        known.has(key),
      ),
    });
  }
  if (memories.length < MIN_MEMORIES_FOR_INSIGHTS) {
    await postpone(userId, NO_NEW_MATERIAL_RECHECK_MS);
    return;
  }

  const previousTitles = [
    ...batch.insights.map(insight => insight.title),
    ...(batch.previous_titles ?? []),
  ].slice(0, PREVIOUS_TITLES_KEPT);
  const raw = await ai.generateText([
    {
      role: 'user',
      content: buildInsightBatchRequest({
        memories,
        previousTitles,
        fields: CATEGORY_LABELS,
        count: INSIGHTS_PER_BATCH,
      }),
    },
  ]);
  const insights = parseInsightBatch(raw, memoryIdByRef);
  if (!insights.length) {
    await postpone(userId, FAILED_GENERATION_RETRY_MS);
    return;
  }

  const now = Date.now();
  await InsightBatch.updateOne(
    {user: userId},
    {
      $set: {
        insights,
        generated_at: new Date(now),
        next_refresh_at: new Date(now + nextRefreshDelayMs()),
        generating_until: null,
        previous_titles: previousTitles,
      },
    },
  );
}

/** Takes the generation lease. Exactly one concurrent caller gets the batch. */
async function claimRefresh(userId: string) {
  const now = new Date();
  try {
    return await InsightBatch.findOneAndUpdate(
      {
        user: userId,
        next_refresh_at: {$lte: now},
        $or: [{generating_until: null}, {generating_until: {$lte: now}}],
      },
      {
        $set: {generating_until: new Date(now.getTime() + GENERATION_LEASE_MS)},
        $setOnInsert: {next_refresh_at: now},
      },
      {new: true, upsert: true, setDefaultsOnInsert: true},
    ).lean();
  } catch (error) {
    // The lease is held elsewhere, so the upsert hit the unique user index.
    if ((error as {code?: number}).code === 11000) return null;
    throw error;
  }
}

function startRefresh(userId: string, batch: IInsightBatch): void {
  refreshInsightBatch(userId, batch).catch(async error => {
    logger.error(
      {userId, error: error instanceof Error ? error.message : String(error)},
      'Insight batch generation failed',
    );
    await postpone(userId, FAILED_GENERATION_RETRY_MS).catch(() => undefined);
  });
}

async function liveMemoryIds(
  userId: string,
  batch: Pick<IInsightBatch, 'insights'> | null,
): Promise<Set<string>> {
  const referenced = batch?.insights.flatMap(item => item.memories) ?? [];
  if (!referenced.length) return new Set();
  const rows = await Memory.find(
    liveMemoryQuery(userId, {_id: {$in: referenced}}),
  )
    .select('_id')
    .lean();
  return new Set(rows.map(row => String(row._id)));
}

/**
 * Returns the current batch and, when one is due, starts the next in the
 * background. Clients poll while `generating` is true.
 */
export async function getCurrentInsights(
  userId: string,
): Promise<InsightListDto> {
  const batch = await InsightBatch.findOne({user: userId}).lean();
  const now = Date.now();
  let generating = Boolean(
    batch?.generating_until && new Date(batch.generating_until).getTime() > now,
  );

  const due = !batch || new Date(batch.next_refresh_at).getTime() <= now;
  if (due && !generating) {
    const ready =
      batch?.generated_at ||
      (await Memory.countDocuments(liveMemoryQuery(userId))) >=
        MIN_MEMORIES_FOR_INSIGHTS;
    if (ready) {
      const claimed = await claimRefresh(userId);
      generating = true;
      if (claimed) startRefresh(userId, claimed as unknown as IInsightBatch);
    }
  }

  const live = await liveMemoryIds(userId, batch);
  const insights = (batch?.insights ?? []).flatMap(item => {
    const sourceCount = item.memories.filter(id => live.has(id)).length;
    return sourceCount
      ? [
          {
            id: String(item._id),
            title: item.title,
            body: item.body,
            categories: item.categories,
            source_count: sourceCount,
          },
        ]
      : [];
  });

  return {
    insights,
    generating,
    generated_at: batch?.generated_at
      ? new Date(batch.generated_at).toISOString()
      : null,
    next_refresh_at: batch?.generated_at
      ? new Date(batch.next_refresh_at).toISOString()
      : null,
  };
}

type SourceSelector = {insight?: string; category?: EnrichmentCategory};

/** Memories behind one insight, or every memory tagged with one field. */
export async function getInsightSources(
  userId: string,
  {insight, category}: SourceSelector,
): Promise<{sources: InsightSourceDto[]}> {
  let scope: FilterQuery<IMemory>;
  if (insight) {
    const batch = await InsightBatch.findOne(
      {user: userId, 'insights._id': insight},
      {'insights.$': 1},
    ).lean();
    const item = batch?.insights[0];
    if (!item) throw new NotFoundException('Insight not found');
    scope = {_id: {$in: item.memories}};
  } else {
    scope = {$or: [{dimensions: category}, {tags: category}]};
  }

  return {sources: await listMemorySources(liveMemoryQuery(userId, scope))};
}

/** Memories as sources: title, date, and a thumbnail when one exists. */
export async function listMemorySources(
  query: FilterQuery<IMemory>,
): Promise<InsightSourceDto[]> {
  const rows = await Memory.find(query)
    .sort({created_at: -1})
    .limit(MAX_SOURCES)
    .select('title type created_at attachments')
    .populate({path: 'attachments', match: {deleted: {$ne: true}}})
    .lean();

  return rows.map(row => {
    const files = (row.attachments ?? []) as unknown as {type?: string}[];
    const image = files.find(file => file?.type?.startsWith('image/'));
    const attachment = image ? serializeAttachment(image) : null;
    return {
      id: String(row._id),
      title: cleanLine(row.title) || 'Untitled memory',
      type: row.type === 'conversation' ? 'conversation' : 'story',
      created_at: row.created_at
        ? new Date(row.created_at).toISOString()
        : null,
      thumbnail: attachment?.thumbnail || attachment?.url || null,
    };
  });
}

/** Removes a purged memory from every batch that cites it. */
export async function removeMemoryFromInsights(
  memoryId: string,
): Promise<void> {
  await InsightBatch.updateMany(
    {'insights.memories': memoryId},
    {$pull: {'insights.$[].memories': memoryId}},
  );
}
