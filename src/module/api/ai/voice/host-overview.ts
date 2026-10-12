import dayjs from 'dayjs';
import Beneficiary from '../../../database/model/beneficiary';
import Capsule from '../../../database/model/capsule';
import Memory from '../../../database/model/memory';
import * as people from '../../people/service';

/**
 * A short sheet of what the host keeps in Memento, put in the voice call's
 * context so Memento can answer "who's on my list?" or "how many stories have
 * I saved?" at once, without a search. Details come from search_memories.
 *
 * Only the host's own records. People are names and relationships only.
 * Each section is optional: a failing query drops that section, not the call.
 */

const MAX_CHARS = 1_200;
const MAX_PEOPLE = 15;
const RECENT_STORIES = 5;
const NEXT_CAPSULES = 3;
const RECENT_REFLECTIONS = 3;
const SAVED_STORY = {type: 'story', status: {$nin: ['draft', 'deleted']}};
const OWN_CAPSULE_STATUSES = ['draft', 'scheduled', 'delivered', 'pause'];

function quoted(titles: unknown[]): string {
  return titles
    .map(title => String(title || '').trim())
    .filter(Boolean)
    .map(title => `"${title}"`)
    .join(', ');
}

async function peopleLine(userId: string): Promise<string> {
  const [connections, added] = await Promise.all([
    people
      .list(userId)
      .then(result => result.connections)
      .catch(() => []),
    Beneficiary.find({benefactor: userId})
      .sort({created_at: 1})
      .select('name email relationship')
      .lean(),
  ]);
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const person of [
    ...connections.map(row => ({
      name: row.name,
      relationship: row.relationship,
    })),
    ...added.map(row => ({
      name: row.name || row.email,
      relationship: row.relationship,
    })),
  ]) {
    const name = String(person.name || '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    entries.push(
      person.relationship ? `${name} (${person.relationship})` : name,
    );
  }
  if (!entries.length) return '';
  const shown = entries.slice(0, MAX_PEOPLE).join(', ');
  const more =
    entries.length > MAX_PEOPLE
      ? `, and ${entries.length - MAX_PEOPLE} more`
      : '';
  return `People in their life: ${shown}${more}.`;
}

async function storiesLine(userId: string): Promise<string> {
  const filter = {user: userId, ...SAVED_STORY};
  const [count, recent] = await Promise.all([
    Memory.countDocuments(filter),
    Memory.find(filter)
      .sort({created_at: -1})
      .limit(RECENT_STORIES)
      .select('title')
      .lean(),
  ]);
  if (!count) return '';
  const titles = quoted(recent.map(row => row.title));
  return `Stories: ${count} saved.${titles ? ` Most recent: ${titles}.` : ''}`;
}

async function capsulesLine(userId: string): Promise<string> {
  const [counts, next] = await Promise.all([
    Capsule.aggregate<{_id: string; count: number}>([
      {$match: {user: userId, status: {$in: OWN_CAPSULE_STATUSES}}},
      {$group: {_id: '$status', count: {$sum: 1}}},
    ]),
    Capsule.find({
      user: userId,
      status: 'scheduled',
      schedule_date: {$gte: new Date()},
    })
      .sort({schedule_date: 1})
      .limit(NEXT_CAPSULES)
      .select('title schedule_date')
      .lean(),
  ]);
  if (!counts.length) return '';
  const byStatus = new Map(counts.map(row => [row._id, row.count]));
  const parts = [
    ['scheduled', 'scheduled'],
    ['draft', 'draft'],
    ['delivered', 'delivered'],
    ['pause', 'paused'],
  ]
    .filter(([status]) => byStatus.get(status))
    .map(([status, label]) => `${byStatus.get(status)} ${label}`);
  const upcoming = next
    .map(row => {
      const title = String(row.title || '').trim() || 'Untitled';
      const when = row.schedule_date
        ? ` on ${dayjs(row.schedule_date).format('D MMMM YYYY')}`
        : '';
      return `"${title}"${when}`;
    })
    .join(', ');
  return `Time capsules: ${parts.join(', ')}.${upcoming ? ` Next due: ${upcoming}.` : ''}`;
}

async function reflectionsLine(userId: string): Promise<string> {
  const rows = await Memory.find({
    user: userId,
    status: {$ne: 'deleted'},
    prompt_text: {$exists: true, $nin: [null, '']},
  })
    .sort({created_at: -1})
    .limit(RECENT_REFLECTIONS)
    .select('prompt_text')
    .lean();
  const prompts = quoted(rows.map(row => row.prompt_text));
  return prompts ? `Recent reflections: ${prompts}.` : '';
}

export async function buildHostOverview(userId: string): Promise<string> {
  const lines = await Promise.all(
    [peopleLine, storiesLine, capsulesLine, reflectionsLine].map(line =>
      line(userId).catch(() => ''),
    ),
  );
  const body = lines.filter(Boolean).join('\n');
  if (!body) return '';
  return ['ABOUT THE HOST (private data, what they keep in Memento):', body]
    .join('\n')
    .slice(0, MAX_CHARS);
}
