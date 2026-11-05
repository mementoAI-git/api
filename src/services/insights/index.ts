import type {FilterQuery} from 'mongoose';
import ai from '../ai';
import logger from '../../utils/logger';
import {extractJson} from '../../utils/helpers';
import {NotFoundException} from '../../utils/service-error';
import {serializeAttachment} from '../../utils/attachment-response';
import {buildInsightEvaluationRequest} from '../../utils/ai-prompt/insight-batch-prompt';
import InsightBatch, {
  type IInsightBatch,
  type IInsightBatchItem,
  type IInsightEvidence,
} from '../../module/database/model/insight-batch';
import Memory, {type IMemory} from '../../module/database/model/memory';
import Message from '../../module/database/model/message';
// Registers the model that populating memory attachments depends on.
import '../../module/database/model/file';
import {
  CATEGORY_LABELS,
  ENRICHMENT_CATEGORIES,
  type EnrichmentCategory,
} from '../enrichment';

/** The most shown at once. There is no minimum: empty is a valid result. */
export const MAX_ACTIVE_INSIGHTS = 4;
export const MIN_EVIDENCE_SOURCES = 3;
export const MIN_EVIDENCE_DATES = 2;
/** Evidence spread over less time than this is an emerging pattern. */
export const ESTABLISHED_SPAN_DAYS = 14;
const MAX_EVIDENCE_PER_PROMPT = 150;
const EXCERPT_LENGTH = 400;
const RETIRED_TITLES_KEPT = 16;
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

export type InsightStatus = 'emerging' | 'established';

export interface InsightDto {
  id: string;
  title: string;
  body: string;
  categories: EnrichmentCategory[];
  source_count: number;
  status: InsightStatus;
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

function plainText(value: unknown): string {
  return typeof value === 'string'
    ? value
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function cleanLine(value: unknown): string {
  return typeof value === 'string'
    ? value
        .replace(/[\u2014\u2013]/g, ',')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function evidenceKey({memory, date}: IInsightEvidence): string {
  return `${memory}:${date}`;
}

/** Whether evidence is independent and spread out enough to support an insight. */
export function meetsEvidenceRules(evidence: IInsightEvidence[]): boolean {
  return (
    new Set(evidence.map(evidenceKey)).size >= MIN_EVIDENCE_SOURCES &&
    new Set(evidence.map(item => item.date)).size >= MIN_EVIDENCE_DATES
  );
}

export function insightStatus(evidence: IInsightEvidence[]): InsightStatus {
  const times = evidence.map(item => new Date(item.date).getTime());
  const span = (Math.max(...times) - Math.min(...times)) / DAY_MS;
  return span >= ESTABLISHED_SPAN_DAYS ? 'established' : 'emerging';
}

export type EvidenceUnit = IInsightEvidence & {
  title: string;
  fields: string[];
  excerpt: string;
};

/**
 * Everything the member has written. A story is one unit, and a chat is one
 * unit per day of the member's own messages, so a single long thread can show
 * recurrence while repetition within one sitting still counts once.
 */
async function loadEvidence(userId: string): Promise<EvidenceUnit[]> {
  const rows = await Memory.find(liveMemoryQuery(userId))
    .select('title type body dimensions tags created_at')
    .lean();
  const known = new Set<string>(ENRICHMENT_CATEGORIES);
  const describe = (row: (typeof rows)[number]) => ({
    title: cleanLine(row.title) || 'Untitled',
    fields: [...(row.dimensions ?? []), ...(row.tags ?? [])].filter(key =>
      known.has(key),
    ),
  });

  const units: EvidenceUnit[] = [];
  const chats = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.type === 'conversation') {
      chats.set(String(row._id), row);
      continue;
    }
    const excerpt = plainText(row.body).slice(0, EXCERPT_LENGTH);
    if (!excerpt || !row.created_at) continue;
    units.push({
      ...describe(row),
      excerpt,
      memory: String(row._id),
      date: new Date(row.created_at).toISOString().slice(0, 10),
    });
  }

  if (chats.size) {
    const days = await Message.aggregate<{
      _id: {memory: string; date: string};
      texts: string[];
    }>([
      {$match: {user: userId, role: 'user', memory: {$in: [...chats.keys()]}}},
      {$sort: {created_at: 1}},
      {
        $group: {
          _id: {
            memory: '$memory',
            date: {$dateToString: {format: '%Y-%m-%d', date: '$created_at'}},
          },
          texts: {$push: '$text'},
        },
      },
    ]).allowDiskUse(true);
    for (const day of days) {
      const excerpt = day.texts
        .map(plainText)
        .filter(Boolean)
        .join(' ')
        .slice(0, EXCERPT_LENGTH);
      const chat = chats.get(day._id.memory);
      if (excerpt && chat && day._id.date) {
        units.push({...describe(chat), excerpt, ...day._id});
      }
    }
  }

  return units.sort((a, b) => a.date.localeCompare(b.date));
}

/** Keeps long histories in view: recent evidence plus an even spread of older. */
export function selectEvidence(
  units: EvidenceUnit[],
  limit = MAX_EVIDENCE_PER_PROMPT,
): EvidenceUnit[] {
  if (units.length <= limit) return units;
  const recentCount = Math.ceil(limit / 2);
  const older = units.slice(0, units.length - recentCount);
  const olderCount = limit - recentCount;
  const spread = Array.from(
    {length: olderCount},
    (_, index) => older[Math.floor((index * older.length) / olderCount)],
  );
  return [...spread, ...units.slice(-recentCount)];
}

type InsightRecord = Pick<
  IInsightBatchItem,
  | '_id'
  | 'title'
  | 'body'
  | 'categories'
  | 'evidence'
  | 'first_seen_at'
  | 'updated_at'
>;

function normalizedTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Applies the model's decisions, enforcing the evidence rules in code. Returns
 * null only for unusable output: no decisions at all is a valid result.
 */
export function applyInsightDecisions(input: {
  raw: string;
  existing: InsightRecord[];
  evidenceByRef: Map<string, IInsightEvidence>;
  retiredTitles: string[];
  now: Date;
}): {insights: InsightRecord[]; retiredTitles: string[]} | null {
  const decisions = extractJson(input.raw)?.decisions;
  if (!Array.isArray(decisions)) return null;

  const known = new Set<string>(ENRICHMENT_CATEGORIES);
  const validCategories = (value: unknown) =>
    [...new Set<string>(Array.isArray(value) ? value : [])].filter(key =>
      known.has(key),
    ) as EnrichmentCategory[];
  const citedEvidence = (value: unknown) => {
    const refs: unknown[] = Array.isArray(value) ? value : [];
    return refs.flatMap(ref => input.evidenceByRef.get(String(ref)) ?? []);
  };
  const dedupe = (evidence: IInsightEvidence[]) => [
    ...new Map(evidence.map(item => [evidenceKey(item), item])).values(),
  ];
  const byRef = new Map(
    input.existing.map((item, index) => [`I${index + 1}`, item]),
  );

  const retired = new Set<InsightRecord>();
  const updated = new Map<InsightRecord, InsightRecord>();
  const additions: InsightRecord[] = [];
  const retiredTitles = [...input.retiredTitles];

  for (const decision of decisions) {
    if (decision?.action === 'retire') {
      const target = byRef.get(String(decision.insight));
      if (target && !retired.has(target)) {
        retired.add(target);
        retiredTitles.unshift(target.title);
      }
    } else if (decision?.action === 'update') {
      const target = byRef.get(String(decision.insight));
      if (!target || retired.has(target)) continue;
      const current = updated.get(target) ?? target;
      const categories = validCategories(decision.categories);
      updated.set(target, {
        ...current,
        title: cleanLine(decision.title) || current.title,
        body: cleanLine(decision.body) || current.body,
        categories: categories.length ? categories : current.categories,
        evidence: dedupe([
          ...current.evidence,
          ...citedEvidence(decision.evidence_refs),
        ]),
        updated_at: input.now,
      });
    } else if (decision?.action === 'new') {
      const title = cleanLine(decision.title);
      const body = cleanLine(decision.body);
      const categories = validCategories(decision.categories);
      const evidence = dedupe(citedEvidence(decision.evidence_refs));
      if (title && body && categories.length && meetsEvidenceRules(evidence)) {
        additions.push({
          title,
          body,
          categories,
          evidence,
          first_seen_at: input.now,
          updated_at: input.now,
        });
      }
    }
  }

  const kept = input.existing
    .filter(item => !retired.has(item))
    .map(item => updated.get(item) ?? item);
  const taken = new Set(
    [...kept.map(item => item.title), ...retiredTitles].map(normalizedTitle),
  );
  const insights = [...kept];
  for (const addition of additions) {
    if (insights.length >= MAX_ACTIVE_INSIGHTS) break;
    const key = normalizedTitle(addition.title);
    if (taken.has(key)) continue;
    taken.add(key);
    insights.push(addition);
  }

  return {insights, retiredTitles: retiredTitles.slice(0, RETIRED_TITLES_KEPT)};
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

/** Re-evaluates the evidence. Current insights stay unless a decision changes them. */
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

  const all = await loadEvidence(userId);
  if (all.length < MIN_EVIDENCE_SOURCES) {
    await postpone(userId, NO_NEW_MATERIAL_RECHECK_MS);
    return;
  }
  const selected = selectEvidence(all);
  const evidenceByRef = new Map(
    selected.map((unit, index): [string, IInsightEvidence] => [
      `E${index + 1}`,
      {memory: unit.memory, date: unit.date},
    ]),
  );
  const retiredTitles = batch.previous_titles ?? [];
  // Insights whose memories are gone no longer qualify, and shouldn't hold a slot.
  const live = await liveMemoryIds(userId, batch);
  const existing = batch.insights
    .map(item => ({
      ...item,
      evidence: item.evidence.filter(entry => live.has(entry.memory)),
    }))
    .filter(item => meetsEvidenceRules(item.evidence));

  const raw = await ai.generateText([
    {
      role: 'user',
      content: buildInsightEvaluationRequest({
        evidence: selected.map((unit, index) => ({
          ref: `E${index + 1}`,
          date: unit.date,
          title: unit.title,
          fields: unit.fields,
          excerpt: unit.excerpt,
        })),
        existing: existing.map((item, index) => ({
          ref: `I${index + 1}`,
          title: item.title,
          body: item.body,
          categories: item.categories,
          status: insightStatus(item.evidence),
          source_count: item.evidence.length,
          latest_date: item.evidence
            .map(evidence => evidence.date)
            .sort()
            .at(-1) as string,
        })),
        retiredTitles,
        fields: CATEGORY_LABELS,
        minSources: MIN_EVIDENCE_SOURCES,
        minDates: MIN_EVIDENCE_DATES,
        establishedDays: ESTABLISHED_SPAN_DAYS,
        maxInsights: MAX_ACTIVE_INSIGHTS,
      }),
    },
  ]);
  const now = new Date();
  const result = applyInsightDecisions({
    raw,
    evidenceByRef,
    retiredTitles,
    now,
    existing,
  });
  if (!result) {
    await postpone(userId, FAILED_GENERATION_RETRY_MS);
    return;
  }

  await InsightBatch.updateOne(
    {user: userId},
    {
      $set: {
        insights: result.insights,
        previous_titles: result.retiredTitles,
        generated_at: now,
        next_refresh_at: new Date(now.getTime() + nextRefreshDelayMs()),
        generating_until: null,
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
  const referenced =
    batch?.insights.flatMap(item => item.evidence.map(e => e.memory)) ?? [];
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
    // One long chat can be enough, because it is evaluated day by day.
    const ready =
      batch?.generated_at ||
      (await Memory.countDocuments(liveMemoryQuery(userId))) >=
        MIN_EVIDENCE_SOURCES ||
      (await Memory.exists(liveMemoryQuery(userId, {type: 'conversation'})));
    if (ready) {
      const claimed = await claimRefresh(userId);
      generating = true;
      if (claimed) startRefresh(userId, claimed as unknown as IInsightBatch);
    }
  }

  const live = await liveMemoryIds(userId, batch);
  // An insight whose memories were deleted no longer meets the rules.
  const insights = (batch?.insights ?? []).flatMap(item => {
    const evidence = item.evidence.filter(entry => live.has(entry.memory));
    return meetsEvidenceRules(evidence)
      ? [
          {
            id: String(item._id),
            title: item.title,
            body: item.body,
            categories: item.categories,
            source_count: evidence.length,
            status: insightStatus(evidence),
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
  if (insight) {
    const batch = await InsightBatch.findOne(
      {user: userId, 'insights._id': insight},
      {'insights.$': 1},
    ).lean();
    const item = batch?.insights[0];
    if (!item) throw new NotFoundException('Insight not found');
    const memories = new Map(
      (
        await listMemorySources(
          liveMemoryQuery(userId, {
            _id: {$in: item.evidence.map(entry => entry.memory)},
          }),
        )
      ).map(source => [source.id, source]),
    );
    // A chat appears once for each day that supports the insight.
    const sources = item.evidence.flatMap(entry => {
      const source = memories.get(entry.memory);
      if (!source) return [];
      return source.type === 'conversation'
        ? [{...source, created_at: new Date(entry.date).toISOString()}]
        : [source];
    });
    sources.sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at)),
    );
    return {sources};
  }
  return {
    sources: await listMemorySources(
      liveMemoryQuery(userId, {
        $or: [{dimensions: category}, {tags: category}],
      }),
    ),
  };
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
    {'insights.evidence.memory': memoryId},
    {$pull: {'insights.$[].evidence': {memory: memoryId}}},
  );
}
