import dayjs from 'dayjs';
import Beneficiary from '../../../database/model/beneficiary';
import Bookmark from '../../../database/model/bookmarks';
import Group from '../../../database/model/group';
import Memory from '../../../database/model/memory';
import {
  findObservation,
  getObservationSources,
  listObservations,
} from '../../persona/observations';
import type {ChatLinkTarget} from '../../../../services/ai/chat-links';
import {describeAccess, storyAccess} from '../voice/content-actions';
import {findStory} from '../voice/find-story';
import {searchMemoriesForChat, stripHtml} from '../voice/memory-search';
import type {ChatToolName} from './declarations';

/**
 * Read-only lookups chat can make before it replies (see ./lookups). Each
 * returns text for the reply's context, and the stories and conversations
 * it mentions, which the reply may then link. Nothing here changes data.
 */

export type ChatToolResult = {
  text: string;
  targets: Map<string, ChatLinkTarget>;
};

export type ChatToolContext = {userId: string; origin: string};

type Handler = (
  args: Record<string, unknown>,
  context: ChatToolContext,
) => Promise<ChatToolResult>;

const MAX_STORY_CHARS = 6_000;
const MAX_LIST = 20;

function str(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function day(value: unknown): string {
  return value ? dayjs(value as Date).format('D MMMM YYYY') : 'date unknown';
}

function said(text: string): ChatToolResult {
  return {text, targets: new Map()};
}

type StoryRow = {
  _id: unknown;
  title?: string;
  body?: string;
  created_at?: Date | string;
  visibility?: string;
  groups?: unknown[];
  beneficiaries?: unknown[];
};

/** The story they mean: their latest, or the best match for their words. */
async function storyFor(
  userId: string,
  args: Record<string, unknown>,
): Promise<StoryRow | null> {
  const fields = 'title body created_at visibility groups beneficiaries';
  const scope = {
    user: userId,
    type: 'story',
    status: {$nin: ['draft', 'deleted']},
  };
  const query = str(args.query);
  if (args.latest === true || !query) {
    return (await Memory.findOne(scope)
      .sort({created_at: -1, _id: -1})
      .select(fields)
      .lean()) as StoryRow | null;
  }
  const found = await findStory(userId, query);
  if (!found) return null;
  return (await Memory.findOne({...scope, _id: found._id})
    .select(fields)
    .lean()) as StoryRow | null;
}

/** A story's links, noted in the text and allowed in the reply. */
function storyLinks(
  story: StoryRow,
  context: ChatToolContext,
  targets: Map<string, ChatLinkTarget>,
): string {
  const id = String(story._id);
  const shareable = story.visibility === 'everyone';
  targets.set(id, {type: 'story', shareable});
  return ` [link: /stories/${id}]${shareable ? ` [share link: ${context.origin}/post/${id}]` : ' [private: no share link]'}`;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
};

/** A story body as plain text, as the host wrote it. */
function plainText(body: string): string {
  return stripHtml(body)
    .replace(
      /&(amp|lt|gt|quot|apos|#39);/g,
      (_, name: string) => ENTITIES[name],
    )
    .trim();
}

const NO_STORY = said(
  'No saved story matched. Ask which story they mean; do not guess.',
);

const searchMemories: Handler = async (args, {userId}) => {
  const query = str(args.query);
  if (!query) return said('Nothing was searched: no query.');
  const also = Array.isArray(args.also)
    ? args.also
        .map(item => str(item, 60))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const {text, found} = await searchMemoriesForChat(userId, query, {also});
  const targets = new Map<string, ChatLinkTarget>();
  for (const memory of found) {
    targets.set(memory.id, {type: memory.type, shareable: memory.shareable});
  }
  return {text, targets};
};

const readStory: Handler = async (args, context) => {
  const story = await storyFor(context.userId, args);
  if (!story) return NO_STORY;
  const targets = new Map<string, ChatLinkTarget>();
  const body = plainText(String(story.body || ''));
  return {
    text: [
      `Story "${story.title || 'Untitled'}" (saved ${day(story.created_at)})${storyLinks(story, context, targets)}`,
      body
        ? `Full text, in their words:\n"""${body.slice(0, MAX_STORY_CHARS)}${body.length > MAX_STORY_CHARS ? '…' : ''}"""`
        : 'It has no text (it may be only photos or audio). Do not guess what it shows.',
    ].join('\n'),
    targets,
  };
};

function dateRange(args: Record<string, unknown>) {
  const range: Record<string, Date> = {};
  for (const [key, op] of [
    ['from', '$gte'],
    ['to', '$lte'],
  ] as const) {
    const value = str(args[key], 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value).isValid()) {
      range[op] =
        key === 'to'
          ? dayjs(value).endOf('day').toDate()
          : dayjs(value).startOf('day').toDate();
    }
  }
  return Object.keys(range).length ? {created_at: range} : {};
}

const listStories: Handler = async (args, context) => {
  const filter = str(args.filter, 20) || 'recent';
  const query: Record<string, unknown> = {
    user: context.userId,
    type: 'story',
    status: {$nin: ['draft', 'deleted']},
    ...dateRange(args),
  };
  if (filter === 'bookmarked') {
    const marks = await Bookmark.find({user: context.userId})
      .select('memory')
      .lean();
    query._id = {$in: marks.map(mark => mark.memory)};
  } else if (filter === 'public') {
    query.visibility = 'everyone';
  } else if (filter === 'shared') {
    query.$or = [
      {'groups.0': {$exists: true}},
      {'beneficiaries.0': {$exists: true}},
    ];
  }
  const rows = (await Memory.find(query)
    .sort({created_at: -1, _id: -1})
    .limit(MAX_LIST)
    .select('title created_at visibility')
    .lean()) as StoryRow[];
  const label =
    {
      recent: 'Their most recent stories',
      bookmarked: 'Their bookmarked stories',
      shared: 'Their stories shared with particular people',
      public: 'Their stories visible to everyone',
    }[filter] || 'Their stories';
  if (!rows.length) return said(`${label}: none found.`);
  const targets = new Map<string, ChatLinkTarget>();
  return {
    text: `${label}, newest first:\n${rows
      .map(
        row =>
          `- "${row.title || 'Untitled'}" (${day(row.created_at)})${storyLinks(row, context, targets)}`,
      )
      .join('\n')}${rows.length === MAX_LIST ? '\n(There may be more.)' : ''}`,
    targets,
  };
};

const listObservationsTool: Handler = async (_args, {userId}) => {
  const {observations} = (await listObservations(userId)).data;
  if (!observations.length) {
    return said('Memento keeps no observations about them yet.');
  }
  return said(
    `What Memento keeps about them (their Observations):\n${observations
      .slice(0, 30)
      .map(item => `- ${item.heading}: ${item.note}`)
      .join('\n')}`,
  );
};

const explainObservation: Handler = async (args, {userId}) => {
  const query = str(args.query);
  if (!query) return said('Ask which observation they mean.');
  const found = await findObservation(userId, query);
  if (found.kind !== 'one') {
    const options = found.headings.map(h => `"${h}"`).join(', ');
    return said(
      found.kind === 'unsure'
        ? `It could be any of these observations: ${options}. Ask which one.`
        : `No observation matched.${options ? ` What Memento keeps includes: ${options}.` : ''}`,
    );
  }
  const {
    data: {sources},
  } = await getObservationSources(userId, found.id);
  const targets = new Map<string, ChatLinkTarget>();
  const lines = sources.slice(0, 8).map(source => {
    const type = source.type === 'conversation' ? 'conversation' : 'story';
    targets.set(source.id, {type});
    return `- ${type === 'story' ? 'Story' : 'Conversation'} "${source.title || 'Untitled'}"${source.created_at ? ` (${day(source.created_at)})` : ''} [link: ${type === 'story' ? '/stories/' : '/chat/'}${source.id}]`;
  });
  return {
    text: `Observation "${found.heading}": ${found.note}\n${
      lines.length
        ? `It comes from:\n${lines.join('\n')}`
        : 'It is not linked to a particular story or conversation: they told Memento directly, or the sources were deleted.'
    }`,
    targets,
  };
};

const listPeople: Handler = async (_args, {userId}) => {
  const [people, groups] = await Promise.all([
    Beneficiary.find({benefactor: userId})
      .select('name relationship status')
      .limit(50)
      .lean(),
    Group.find({user: userId}).select('name members').limit(30).lean(),
  ]);
  const status = (value?: string) =>
    value === 'accepted'
      ? 'joined'
      : value === 'rejected'
        ? 'declined the invitation'
        : 'invitation pending';
  return said(
    [
      people.length
        ? `Their beneficiaries:\n${people
            .map(
              p =>
                `- ${p.name || 'Unnamed'}${p.relationship ? ` (${p.relationship})` : ''}: ${status(p.status)}`,
            )
            .join('\n')}`
        : 'They have no beneficiaries yet.',
      groups.length
        ? `Their groups:\n${groups
            .map(
              g =>
                `- ${g.name || 'Unnamed'} (${g.members?.length ?? 0} people)`,
            )
            .join('\n')}`
        : 'They have no groups.',
    ].join('\n'),
  );
};

const whoCanSee: Handler = async (args, context) => {
  const story = await storyFor(context.userId, args);
  if (!story) return NO_STORY;
  const targets = new Map<string, ChatLinkTarget>();
  const access = await storyAccess(context.userId, String(story._id));
  const who = await describeAccess(context.userId, access);
  return {
    text: `Story "${story.title || 'Untitled'}"${storyLinks(story, context, targets)} is ${who}.${access.visibility === 'everyone' ? ' Everyone means all their beneficiaries and the people they are connected with in Memento.' : ''}`,
    targets,
  };
};

const getShareLink: Handler = async (args, context) => {
  const story = await storyFor(context.userId, args);
  if (!story) return NO_STORY;
  const targets = new Map<string, ChatLinkTarget>();
  const links = storyLinks(story, context, targets);
  const title = story.title || 'Untitled';
  if (story.visibility === 'everyone') {
    return {
      text: `Story "${title}"${links}. It is visible to everyone, so its share link works for anyone: ${context.origin}/post/${String(story._id)} . Give that link on its own line.`,
      targets,
    };
  }
  const who = await describeAccess(
    context.userId,
    await storyAccess(context.userId, String(story._id)),
  );
  return {
    text: `Story "${title}"${links} is ${who}, so it has no public share link yet. Sharing is two steps: they choose who can see it from the story's Share option, then share the link. Do not offer a link, and do not say you changed who can see it.`,
    targets,
  };
};

export const CHAT_TOOL_HANDLERS: Record<ChatToolName, Handler> = {
  search_memories: searchMemories,
  read_story: readStory,
  list_stories: listStories,
  list_observations: listObservationsTool,
  explain_observation: explainObservation,
  list_people: listPeople,
  who_can_see_story: whoCanSee,
  get_share_link: getShareLink,
};
