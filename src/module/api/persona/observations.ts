import {
  invalidateEnrichmentCache,
  type EnrichmentCategory,
} from '../../../services/enrichment';
import {
  listMemorySources,
  type InsightSourceDto,
} from '../../../services/insights';
import {PERSONA_INSIGHT_FIELDS} from '../../../utils/constant';
import {observationHash, observationId} from '../../../utils/observation-id';
import logger from '../../../utils/logger';
import {NotFoundException} from '../../../utils/service-error';
import Memory from '../../database/model/memory';
import PendingInsight, {
  type PendingInsightField,
} from '../../database/model/pending-insight';
import Persona from '../../database/model/persona';

export interface ObservationDto {
  id: string;
  field: PendingInsightField;
  content: string;
  /** False until the member has confirmed or edited it. */
  reviewed: boolean;
  source_count: number;
  category_key?: EnrichmentCategory | null;
}

type PendingRow = {
  _id: unknown;
  field: PendingInsightField;
  content: string;
  memory: string;
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

/** Saved and unreviewed observations as one list, merged by wording. */
export async function listObservations(userId: string) {
  const {persona, pending} = await loadRecords(userId);
  const live = new Set(
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

  const observations = new Map<string, ObservationDto>();
  for (const field of PERSONA_INSIGHT_FIELDS) {
    for (const content of persona?.[field] ?? []) {
      const id = observationId(field, content);
      if (content.trim() && !observations.has(id)) {
        observations.set(id, {
          id,
          field,
          content: content.trim(),
          reviewed: true,
          source_count: 0,
        });
      }
    }
  }
  for (const row of pending) {
    // A pending observation goes with its memory when that memory is deleted.
    if (!live.has(row.memory) || !row.content.trim()) continue;
    const id = observationId(row.field, row.content);
    const existing = observations.get(id);
    if (existing) existing.source_count += 1;
    else {
      observations.set(id, {
        id,
        field: row.field,
        content: row.content.trim(),
        reviewed: false,
        source_count: 1,
      });
    }
  }

  return {
    message: 'Observations retrieved successfully',
    data: {observations: [...observations.values()]},
  };
}

function matchesId(id: string, field: string, content: string) {
  return observationId(field, content) === id;
}

function fieldFromId(id: string): PendingInsightField {
  return id.slice(0, id.lastIndexOf('-')) as PendingInsightField;
}

/** Finds every record behind an observation, or 404s. */
async function findObservation(userId: string, id: string) {
  const field = fieldFromId(id);
  const {persona, pending} = await loadRecords(userId);
  const saved = (persona?.[field] ?? []) as string[];
  const rows = pending.filter(row => matchesId(id, row.field, row.content));
  const inSaved = saved.some(content => matchesId(id, field, content));
  if (!inSaved && !rows.length) {
    throw new NotFoundException('Observation not found');
  }
  return {field, saved, rows};
}

export async function getObservationSources(
  userId: string,
  id: string,
): Promise<{message: string; data: {sources: InsightSourceDto[]}}> {
  const {rows} = await findObservation(userId, id);
  const sources = await listMemorySources({
    _id: {$in: [...new Set(rows.map(row => row.memory))]},
    user: userId,
    status: {$ne: 'deleted'},
  });
  return {message: 'Observation sources retrieved', data: {sources}};
}

/**
 * What the member removed must not return, so the old wording is remembered
 * for extraction, and caches built from it are dropped.
 */
async function recordRemoval(
  userId: string,
  update: Record<string, unknown>,
  removedHash: string | null,
) {
  await Persona.updateOne(
    {user: userId},
    {
      $set: {...update, last_array_update: new Date()},
      ...(removedHash && {
        $addToSet: {forgotten_observations: removedHash},
      }),
      $unset: {memory_insights_summary: '', memory_insights_summary_at: ''},
    },
    {upsert: true},
  );
  // The change is already saved, so a cache failure must not fail the request.
  await invalidateEnrichmentCache(userId).catch(error =>
    logger.warn({error}, 'Could not refresh the enrichment score cache'),
  );
}

export async function updateObservation(
  userId: string,
  id: string,
  content: string,
) {
  const {field, saved, rows} = await findObservation(userId, id);
  const next = content.trim();
  const removedHash = id.slice(id.lastIndexOf('-') + 1);

  if (rows.length) {
    await PendingInsight.updateMany(
      {_id: {$in: rows.map(row => row._id)}, user: userId},
      {$set: {content: next}},
    );
  }
  const unchanged = observationHash(field, next) === removedHash;
  await recordRemoval(
    userId,
    {
      [field]: saved.map(entry => (matchesId(id, field, entry) ? next : entry)),
    },
    unchanged ? null : removedHash,
  );
  // Wording the member chose themselves is allowed to come back.
  await Persona.updateOne(
    {user: userId},
    {
      $pull: {forgotten_observations: observationHash(field, next)},
    },
  );

  return {
    message: 'Observation updated',
    data: {id: observationId(field, next), field, content: next},
  };
}

export async function forgetObservation(userId: string, id: string) {
  const {field, saved, rows} = await findObservation(userId, id);
  if (rows.length) {
    await PendingInsight.deleteMany({
      _id: {$in: rows.map(row => row._id)},
      user: userId,
    });
  }
  await recordRemoval(
    userId,
    {[field]: saved.filter(entry => !matchesId(id, field, entry))},
    id.slice(id.lastIndexOf('-') + 1),
  );
  return {message: 'Observation forgotten', data: null};
}
