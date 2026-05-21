import Memory from '../../module/database/model/memory';

/** Matches web `UserStatsData.spotlight.source` */
export type MemorySpotlightSource = 'explicit' | 'conversation';

export interface MemorySpotlightDto {
  memory_id: string;
  title: string | null;
  excerpt: string;
  source: MemorySpotlightSource;
  updated_at: string | null;
}

/** Prefer substantive text; shorter fallbacks avoid an empty panel without exposing raw chat. */
const BODY_PREFERRED_LEN = 28;
const BODY_MIN_LEN = 8;
const SUMMARY_PREFERRED_LEN = 28;
const SUMMARY_MIN_LEN = 8;
const EXCERPT_MAX = 240;

function stripHtmlish(text: string): string {
  return text.replace(/<[^>]*>/g, ' ');
}

function normalizeExcerpt(raw: string, max: number): string {
  const single = stripHtmlish(raw).replace(/\s+/g, ' ').trim();
  if (single.length <= max) return single;
  return `${single.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Picks one recent memory thread for the insight panel: prefers a substantive
 * saved story, then shorter story body, then title-only; otherwise a conversation
 * with an AI summary (never raw chat). Shorter text fallbacks reduce empty spotlight
 * while avoiding transcript exposure.
 */
export async function getMemorySpotlightForUser(
  userId: string,
): Promise<MemorySpotlightDto | null> {
  const base = {
    user: userId,
    status: {$nin: ['draft', 'deleted']},
  };

  const stories = await Memory.find({
    ...base,
    $or: [{type: 'story'}, {type: {$exists: false}}],
    body: {$exists: true, $nin: [null, '']},
  })
    .sort({updated_at: -1})
    .limit(12)
    .select('_id title body updated_at')
    .lean();

  for (const story of stories) {
    const body = String(story.body || '').trim();
    const titleRaw = story.title ? String(story.title).trim() : '';
    const title = titleRaw || null;

    if (body.length >= BODY_PREFERRED_LEN) {
      return {
        memory_id: String(story._id),
        title,
        excerpt: normalizeExcerpt(body, EXCERPT_MAX),
        source: 'explicit',
        updated_at: story.updated_at
          ? new Date(story.updated_at as string | Date).toISOString()
          : null,
      };
    }
  }

  for (const story of stories) {
    const body = String(story.body || '').trim();
    const titleRaw = story.title ? String(story.title).trim() : '';
    const title = titleRaw || null;

    if (body.length >= BODY_MIN_LEN) {
      return {
        memory_id: String(story._id),
        title,
        excerpt: normalizeExcerpt(body, EXCERPT_MAX),
        source: 'explicit',
        updated_at: story.updated_at
          ? new Date(story.updated_at as string | Date).toISOString()
          : null,
      };
    }

    if (titleRaw.length >= 3) {
      return {
        memory_id: String(story._id),
        title,
        excerpt: normalizeExcerpt(titleRaw, EXCERPT_MAX),
        source: 'explicit',
        updated_at: story.updated_at
          ? new Date(story.updated_at as string | Date).toISOString()
          : null,
      };
    }
  }

  const convos = await Memory.find({
    ...base,
    type: 'conversation',
    summary: {$exists: true, $nin: [null, '']},
  })
    .sort({updated_at: -1})
    .limit(12)
    .select('_id title summary updated_at')
    .lean();

  for (const convo of convos) {
    const summary = String(convo.summary || '').trim();
    const convoTitle = convo.title ? String(convo.title).trim() || null : null;
    if (summary.length >= SUMMARY_PREFERRED_LEN) {
      return {
        memory_id: String(convo._id),
        title: convoTitle,
        excerpt: normalizeExcerpt(summary, EXCERPT_MAX),
        source: 'conversation',
        updated_at: convo.updated_at
          ? new Date(convo.updated_at as string | Date).toISOString()
          : null,
      };
    }
  }

  for (const convo of convos) {
    const summary = String(convo.summary || '').trim();
    const convoTitle = convo.title ? String(convo.title).trim() || null : null;
    if (summary.length >= SUMMARY_MIN_LEN) {
      return {
        memory_id: String(convo._id),
        title: convoTitle,
        excerpt: normalizeExcerpt(summary, EXCERPT_MAX),
        source: 'conversation',
        updated_at: convo.updated_at
          ? new Date(convo.updated_at as string | Date).toISOString()
          : null,
      };
    }

    const t = convoTitle ? String(convoTitle).trim() : '';
    if (t.length >= 3) {
      return {
        memory_id: String(convo._id),
        title: convoTitle,
        excerpt: normalizeExcerpt(t, EXCERPT_MAX),
        source: 'conversation',
        updated_at: convo.updated_at
          ? new Date(convo.updated_at as string | Date).toISOString()
          : null,
      };
    }
  }

  return null;
}
