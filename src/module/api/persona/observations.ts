import ai from '../../../services/ai';
import {
  CATEGORY_LABELS,
  ENRICHMENT_CATEGORIES,
  invalidateEnrichmentCache,
  type EnrichmentCategory,
} from '../../../services/enrichment';
import {
  listMemorySources,
  type InsightSourceDto,
} from '../../../services/insights';
import {forgetUserContext} from '../../../services/user-context-cache';
import {buildObservationCurationRequest} from '../../../utils/ai-prompt/observation-view-prompt';
import {PERSONA_INSIGHT_FIELDS} from '../../../utils/constant';
import {extractJson} from '../../../utils/helpers';
import logger from '../../../utils/logger';
import {speaksToMember} from '../../../utils/member-voice';
import {observationId} from '../../../utils/observation-id';
import {NotFoundException} from '../../../utils/service-error';
import Memory from '../../database/model/memory';
import ObservationView, {
  type IObservationView,
  type IObservationViewItem,
} from '../../database/model/observation-view';
import PendingInsight, {
  type PendingInsightField,
} from '../../database/model/pending-insight';
import Persona from '../../database/model/persona';
import User from '../../database/model/user';

const CURATION_BATCH_SIZE = 40;
const SOURCES_PER_FACT = 2;
const SOURCE_EXCERPT_LENGTH = 240;
const CURATION_LEASE_MS = 3 * 60 * 1000;
const CURATION_RETRY_MS = 6 * 60 * 60 * 1000;

export interface ObservationDto {
  id: string;
  field: PendingInsightField;
  heading: string;
  note: string;
  category_key: EnrichmentCategory;
  source_count: number;
}

type PendingRow = {
  _id: unknown;
  field: PendingInsightField;
  content: string;
  memory: string;
};

/** A stored fact: saved on the persona, extracted as pending, or both. */
type Fact = {
  id: string;
  field: PendingInsightField;
  text: string;
  memories: Set<string>;
  saved: boolean;
};

async function loadRecords(userId: string) {
  const [persona, pending] = await Promise.all([
    Persona.findOne({user: userId})
      .select(PERSONA_INSIGHT_FIELDS.join(' '))
      .lean(),
    PendingInsight.find({user: userId})
      .sort({created_at: -1})
      .select('field content memory')
      .lean<PendingRow[]>(),
  ]);
  return {persona, pending};
}

/** All stored facts, merged by wording, and which of them are still live. */
async function loadFacts(userId: string) {
  const {persona, pending} = await loadRecords(userId);
  const liveMemories = new Set(
    (
      await Memory.find({
        _id: {$in: [...new Set(pending.map(row => row.memory))]},
        user: userId,
        status: {$ne: 'deleted'},
      })
        .select('_id')
        .lean()
    ).map(row => String(row._id)),
  );

  const facts = new Map<string, Fact>();
  const allIds = new Set<string>();
  for (const field of PERSONA_INSIGHT_FIELDS) {
    for (const text of persona?.[field] ?? []) {
      if (!text.trim()) continue;
      const id = observationId(field, text);
      allIds.add(id);
      if (!facts.has(id)) {
        facts.set(id, {
          id,
          field,
          text: text.trim(),
          memories: new Set(),
          saved: true,
        });
      }
    }
  }
  for (const row of pending) {
    if (!row.content.trim()) continue;
    const id = observationId(row.field, row.content);
    allIds.add(id);
    // A pending fact goes with its memory when that memory is deleted.
    if (!liveMemories.has(row.memory)) continue;
    const fact = facts.get(id);
    if (fact) fact.memories.add(row.memory);
    else {
      facts.set(id, {
        id,
        field: row.field,
        text: row.content.trim(),
        memories: new Set([row.memory]),
        saved: false,
      });
    }
  }
  return {facts, allIds};
}

function normalizedHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cleanLine(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[—–]/g, ',').replace(/\s+/g, ' ').trim()
    : '';
}

type CardRecord = Pick<
  IObservationViewItem,
  '_id' | 'field' | 'heading' | 'note' | 'category' | 'sources' | 'edited'
>;

/**
 * Applies the model's choices. Anything not turned into a valid card is left
 * out on purpose. Returns null only for unusable output.
 */
export function applyCuration(input: {
  raw: string;
  existing: CardRecord[];
  factIdByRef: Map<string, string>;
}): CardRecord[] | null {
  const cards = extractJson(input.raw)?.cards;
  if (!Array.isArray(cards)) return null;

  const fields = new Set<string>(PERSONA_INSIGHT_FIELDS);
  // Models sometimes answer with the field's label instead of its key.
  const categoryByName = new Map<string, EnrichmentCategory>(
    ENRICHMENT_CATEGORIES.flatMap(key => [
      [key, key],
      [CATEGORY_LABELS[key], key],
    ]),
  );
  const items = input.existing.map(item => ({
    ...item,
    sources: [...item.sources],
  }));
  const byRef = new Map(items.map((item, index) => [`C${index + 1}`, item]));
  const attach = (target: CardRecord, sources: string[]) => {
    target.sources = [...new Set([...target.sources, ...sources])];
  };

  for (const card of cards) {
    const refs: unknown[] = Array.isArray(card?.sources) ? card.sources : [];
    const sources = refs.flatMap(
      ref => input.factIdByRef.get(String(ref)) ?? [],
    );
    if (!sources.length) continue;

    const target = byRef.get(String(card?.merge_into));
    if (target) {
      attach(target, sources);
      continue;
    }
    const heading = cleanLine(card?.heading).replace(/[.!]+$/, '');
    const note = cleanLine(card?.note);
    const category = categoryByName.get(card?.category);
    if (
      !heading ||
      !note ||
      !speaksToMember(heading) ||
      !speaksToMember(note) ||
      !fields.has(card?.field) ||
      !category
    ) {
      continue;
    }
    const duplicate = items.find(
      item => normalizedHeading(item.heading) === normalizedHeading(heading),
    );
    if (duplicate) {
      attach(duplicate, sources);
      continue;
    }
    items.push({
      heading,
      note,
      sources,
      edited: false,
      field: card.field,
      category: category as EnrichmentCategory,
    });
  }
  return items;
}

async function curate(
  userId: string,
  view: Pick<IObservationView, 'items' | 'processed'>,
  facts: Fact[],
): Promise<void> {
  const memoryIds = [...new Set(facts.flatMap(fact => [...fact.memories]))];
  const [memories, user] = await Promise.all([
    Memory.find({_id: {$in: memoryIds}, user: userId})
      .select('title summary body')
      .lean(),
    User.findById(userId).select('nickname first_name').lean(),
  ]);
  const memoryById = new Map(memories.map(row => [String(row._id), row]));
  const factIdByRef = new Map(
    facts.map((fact, index) => [`F${index + 1}`, fact.id]),
  );

  const raw = await ai.generateText([
    {
      role: 'user',
      content: buildObservationCurationRequest({
        name: user?.nickname || user?.first_name || null,
        fields: CATEGORY_LABELS,
        existing: view.items.map((item, index) => ({
          ref: `C${index + 1}`,
          heading: item.heading,
        })),
        facts: facts.map((fact, index) => ({
          ref: `F${index + 1}`,
          field: fact.field,
          text: fact.text,
          sources: [...fact.memories]
            .slice(0, SOURCES_PER_FACT)
            .flatMap(id => memoryById.get(id) ?? [])
            .map(memory => ({
              title: cleanLine(memory.title) || 'Untitled',
              excerpt: cleanLine(
                (memory.summary || memory.body || '').replace(/<[^>]+>/g, ' '),
              ).slice(0, SOURCE_EXCERPT_LENGTH),
            })),
        })),
      }),
    },
  ]);

  const items = applyCuration({raw, factIdByRef, existing: view.items});
  if (!items) throw new Error('Unusable curation output');
  await ObservationView.updateOne(
    {user: userId},
    {
      $set: {items, generating_until: null, next_attempt_at: null},
      $addToSet: {processed: {$each: facts.map(fact => fact.id)}},
    },
  );
}

/** Takes the curation lease. Exactly one concurrent caller gets the view. */
export async function claimCuration(userId: string) {
  const now = new Date();
  try {
    return await ObservationView.findOneAndUpdate(
      {
        user: userId,
        $and: [
          {$or: [{generating_until: null}, {generating_until: {$lte: now}}]},
          {$or: [{next_attempt_at: null}, {next_attempt_at: {$lte: now}}]},
        ],
      },
      {$set: {generating_until: new Date(now.getTime() + CURATION_LEASE_MS)}},
      {new: true, upsert: true, setDefaultsOnInsert: true},
    ).lean();
  } catch (error) {
    // The lease is held elsewhere, so the upsert hit the unique user index.
    if ((error as {code?: number}).code === 11000) return null;
    throw error;
  }
}

function startCuration(
  userId: string,
  view: Pick<IObservationView, 'items' | 'processed'>,
  facts: Fact[],
): void {
  curate(userId, view, facts).catch(async error => {
    logger.error(
      {userId, error: error instanceof Error ? error.message : String(error)},
      'Observation curation failed',
    );
    await ObservationView.updateOne(
      {user: userId},
      {
        $set: {
          generating_until: null,
          next_attempt_at: new Date(Date.now() + CURATION_RETRY_MS),
        },
      },
    ).catch(() => undefined);
  });
}

/**
 * The curated cards. Facts not yet considered are handled in the background a
 * batch at a time, so clients poll while `generating` is true.
 */
export async function listObservations(userId: string) {
  const [{facts, allIds}, view] = await Promise.all([
    loadFacts(userId),
    ObservationView.findOne({user: userId}).lean(),
  ]);

  // Cards whose facts are permanently gone must not keep their wording around.
  const gone = (view?.items ?? []).filter(
    item => !item.edited && !item.sources.some(id => allIds.has(id)),
  );
  if (gone.length) {
    await ObservationView.updateOne(
      {user: userId},
      {$pull: {items: {_id: {$in: gone.map(item => item._id)}}}},
    );
  }

  const now = Date.now();
  const processed = new Set(view?.processed ?? []);
  const waiting = [...facts.values()].filter(fact => !processed.has(fact.id));
  const leased =
    view?.generating_until && new Date(view.generating_until).getTime() > now;
  const backingOff =
    view?.next_attempt_at && new Date(view.next_attempt_at).getTime() > now;

  let generating = Boolean(leased);
  if (waiting.length && !leased && !backingOff) {
    generating = true;
    const claimed = await claimCuration(userId);
    if (claimed) {
      // `waiting` came from a read taken before the lease. Another reader may
      // have curated those facts since, so check against the claimed view.
      const done = new Set(claimed.processed ?? []);
      const fresh = waiting.filter(fact => !done.has(fact.id));
      if (fresh.length) {
        startCuration(
          userId,
          claimed as unknown as IObservationView,
          fresh.slice(0, CURATION_BATCH_SIZE),
        );
      } else {
        generating = false;
        await ObservationView.updateOne(
          {user: userId, generating_until: claimed.generating_until},
          {$set: {generating_until: null}},
        );
      }
    }
  }

  const goneIds = new Set(gone.map(item => String(item._id)));
  const observations: ObservationDto[] = (view?.items ?? []).flatMap(item => {
    const live = item.sources.flatMap(id => facts.get(id) ?? []);
    if (goneIds.has(String(item._id)) || !live.length) return [];
    return [
      {
        id: String(item._id),
        field: item.field,
        heading: item.heading,
        note: item.note,
        category_key: item.category,
        source_count: new Set(live.flatMap(fact => [...fact.memories])).size,
      },
    ];
  });

  return {
    message: 'Observations retrieved successfully',
    data: {observations, generating},
  };
}

async function findCard(userId: string, id: string) {
  const view = await ObservationView.findOne({
    user: userId,
    'items._id': id,
  }).lean();
  const item = view?.items.find(entry => String(entry._id) === id);
  if (!item) throw new NotFoundException('Observation not found');
  return item;
}

export async function getObservationSources(
  userId: string,
  id: string,
): Promise<{message: string; data: {sources: InsightSourceDto[]}}> {
  const item = await findCard(userId, id);
  const sourceIds = new Set(item.sources);
  const {pending} = await loadRecords(userId);
  const memories = pending
    .filter(row => sourceIds.has(observationId(row.field, row.content)))
    .map(row => row.memory);
  const sources = await listMemorySources({
    _id: {$in: [...new Set(memories)]},
    user: userId,
    status: {$ne: 'deleted'},
  });
  return {message: 'Observation sources retrieved', data: {sources}};
}

/**
 * What the member changed must not return, so the old wording is remembered
 * for extraction, and caches built from it are dropped.
 */
export async function saveFactChanges(
  userId: string,
  update: Record<string, unknown>,
  removedHashes: string[],
) {
  await Persona.updateOne(
    {user: userId},
    {
      $set: {...update, last_array_update: new Date()},
      ...(removedHashes.length && {
        $addToSet: {forgotten_observations: {$each: removedHashes}},
      }),
      $unset: {memory_insights_summary: '', memory_insights_summary_at: ''},
    },
    {upsert: true},
  );
  // The change is already saved, so a cache failure must not fail the request.
  await invalidateEnrichmentCache(userId).catch(error =>
    logger.warn({error}, 'Could not refresh the enrichment score cache'),
  );
  void forgetUserContext(userId);
}

function hashOf(factId: string): string {
  return factId.slice(factId.lastIndexOf('-') + 1);
}

/** Saves the member's words, keeping the facts' memory links for Sources. */
export async function updateObservation(
  userId: string,
  id: string,
  edit: {heading: string; note: string},
) {
  const item = await findCard(userId, id);
  const sourceIds = new Set(item.sources);
  const heading = edit.heading.trim().replace(/[.!]+$/, '');
  const note = edit.note.trim();
  // The AI reads stored facts as being about someone else, so "you" stays attributed.
  const fact = `In the user's own words: ${heading}. ${note}`;

  const {persona, pending} = await loadRecords(userId);
  const rows = pending.filter(row =>
    sourceIds.has(observationId(row.field, row.content)),
  );
  if (rows.length) {
    await PendingInsight.updateMany(
      {_id: {$in: rows.map(row => row._id)}, user: userId},
      {$set: {content: fact}},
    );
  }
  const update: Record<string, unknown> = {};
  const nextSources = new Set(rows.map(row => observationId(row.field, fact)));
  for (const field of PERSONA_INSIGHT_FIELDS) {
    const saved = (persona?.[field] ?? []) as string[];
    if (!saved.some(text => sourceIds.has(observationId(field, text)))) {
      continue;
    }
    update[field] = [
      ...new Set(
        saved.map(text =>
          sourceIds.has(observationId(field, text)) ? fact : text,
        ),
      ),
    ];
    nextSources.add(observationId(field, fact));
  }
  if (!nextSources.size) {
    update[item.field] = [...((persona?.[item.field] ?? []) as string[]), fact];
    nextSources.add(observationId(item.field, fact));
  }

  const kept = new Set([...nextSources].map(hashOf));
  await saveFactChanges(
    userId,
    update,
    item.sources.map(hashOf).filter(hash => !kept.has(hash)),
  );
  await ObservationView.updateOne(
    {user: userId, 'items._id': id},
    {
      $set: {
        'items.$.heading': heading,
        'items.$.note': note,
        'items.$.sources': [...nextSources],
        'items.$.edited': true,
      },
      $addToSet: {processed: {$each: [...nextSources]}},
    },
  );
  return {
    message: 'Observation updated',
    data: {id, field: item.field, heading, note},
  };
}

const QUERY_FILLER = new Set(
  'a an and about at for from i im in is it me my of on that the this to was with you your'.split(
    ' ',
  ),
);

function queryWords(text: string): string[] {
  return normalizedHeading(text)
    .split(' ')
    .filter(word => word && !QUERY_FILLER.has(word))
    .map(word => word.replace(/s$/, ''));
}

export type ObservationMatch =
  | {kind: 'one'; id: string; heading: string; note: string}
  /** Worth asking about, but too unsure to act on. */
  | {kind: 'unsure'; headings: string[]}
  | {kind: 'none'; headings: string[]};

const MAX_MATCH_HEADINGS = 8;

/**
 * Finds the card someone described, among the ones they can see. It only names
 * a single card when its heading was given or every word described it, because
 * forgetting cannot be undone.
 */
export async function findObservation(
  userId: string,
  query: string,
): Promise<ObservationMatch> {
  const {observations} = (await listObservations(userId)).data;
  const headings = observations
    .map(item => item.heading)
    .slice(0, MAX_MATCH_HEADINGS);
  const wanted = queryWords(query);
  if (!wanted.length) return {kind: 'none', headings};

  const scored = observations.map(item => {
    const words = new Set(queryWords(`${item.heading} ${item.note}`));
    return {
      item,
      share: wanted.filter(word => words.has(word)).length / wanted.length,
    };
  });
  const asked = normalizedHeading(query);
  const named = observations.filter(
    item => normalizedHeading(item.heading) === asked,
  );
  const whole = scored.filter(row => row.share === 1).map(row => row.item);
  const certain = named.length ? named : whole;
  if (certain.length === 1) {
    const [{id, heading, note}] = certain;
    return {kind: 'one', id, heading, note};
  }
  const close = certain.length
    ? certain
    : scored
        .filter(row => row.share >= 0.5)
        .sort((a, b) => b.share - a.share)
        .map(row => row.item);
  return close.length
    ? {
        kind: 'unsure',
        headings: close.map(item => item.heading).slice(0, MAX_MATCH_HEADINGS),
      }
    : {kind: 'none', headings};
}

export async function forgetObservation(userId: string, id: string) {
  const item = await findCard(userId, id);
  const sourceIds = new Set(item.sources);
  const {persona, pending} = await loadRecords(userId);

  const rows = pending.filter(row =>
    sourceIds.has(observationId(row.field, row.content)),
  );
  if (rows.length) {
    await PendingInsight.deleteMany({
      _id: {$in: rows.map(row => row._id)},
      user: userId,
    });
  }
  const update: Record<string, unknown> = {};
  for (const field of PERSONA_INSIGHT_FIELDS) {
    const saved = (persona?.[field] ?? []) as string[];
    const remaining = saved.filter(
      text => !sourceIds.has(observationId(field, text)),
    );
    if (remaining.length !== saved.length) update[field] = remaining;
  }
  await saveFactChanges(userId, update, item.sources.map(hashOf));
  await ObservationView.updateOne({user: userId}, {$pull: {items: {_id: id}}});
  return {message: 'Observation forgotten', data: null};
}
