import dayjs from 'dayjs';
import Beneficiary from '../../../database/model/beneficiary';
import Bookmark from '../../../database/model/bookmarks';
import Capsule from '../../../database/model/capsule';
import Group from '../../../database/model/group';
import Memory from '../../../database/model/memory';
import User from '../../../database/model/user';
import * as beneficiaries from '../../beneficiary/service';
import type {CreateBeneficiaryBody} from '../../beneficiary/dto';
import * as capsules from '../../capsule/service';
import * as feedback from '../../feedback/service';
import * as memories from '../../memory/service';
import {
  findObservation,
  forgetObservation,
  getObservationSources,
  updateObservation,
  type ObservationMatch,
} from '../../persona/observations';
import {MAX_REMEMBERED_LENGTH, rememberFact} from '../../persona/remember';
import {JWT_SECRET} from '../../../../utils/config';
import {confirmationCode, isConfirmed} from './confirmation';
import {escapeRegex} from './memory-search';
import {findStory} from './find-story';
import type {VoiceToolOutcome, VoiceToolRun} from './server-tool-types';
import {failed} from './tool-errors';

/**
 * Things Memento can do with the host's content by voice, through the same
 * services the app's screens use, as the host.
 *
 * Two tiers:
 * - Done straight away, then offered back: save a story, a quick note, a fact,
 *   bookmark, tag, rename or add to a story, correct an observation, make a
 *   story private, draft a capsule. All are easy to undo. Explaining an
 *   observation only reads.
 * - Confirmed first: adding a beneficiary (emails an invite), scheduling a
 *   capsule, deleting a story, replacing a story's whole text, sharing a
 *   story, making a story visible to everyone, forgetting an observation,
 *   sending feedback. The first call only reads the action back with a code;
 *   a second call with the code runs it.
 *
 * Never by voice (no tool exists): billing, subscriptions, account
 * deletion, password, email, two-factor, signing out.
 */

const MAX_TITLE = 120;
const MAX_BODY = 20_000;
const MAX_TAGS = 10;

type Handler = (
  userId: string,
  args: Record<string, unknown>,
) => Promise<VoiceToolRun>;

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function list(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];
  return items
    .map(item => str(item, 40).toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_TAGS);
}

function say(result: string): VoiceToolOutcome {
  return {result, effects: []};
}

const NO_STORY = say(
  'No story matched. Tell the host you could not find it and ask what it was called.',
);

function secret(): string {
  return JWT_SECRET || 'memento-voice-confirmation';
}

/**
 * Null when the host already confirmed these exact details; otherwise the
 * read-back Memento must give before calling again with the code.
 */
function confirmFirst(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  readBack: string,
): VoiceToolOutcome | null {
  const now = Date.now();
  if (isConfirmed(userId, tool, args, now, secret())) return null;
  const code = confirmationCode(userId, tool, args, now, secret());
  return say(
    `Nothing has happened yet. ${readBack} Read this back to the host and ask them to confirm. Only if they clearly say yes, call ${tool} again with exactly the same details and confirmation "${code}".`,
  );
}

const saveStory: Handler = async (userId, args) => {
  const body = str(args.body, MAX_BODY);
  if (!body)
    return say('There is nothing to save yet. Ask what the story should say.');
  const title =
    str(args.title, MAX_TITLE) || body.split(/\s+/).slice(0, 6).join(' ');
  try {
    const {data} = await memories.createMemory(
      {title, body, status: 'save', tags: [], level: 1, attachments: []},
      userId,
    );
    return {
      result: `Saved as a story called "${title}". It is on screen. Tell them, and offer to change the title or the words.`,
      effects: [
        {type: 'refresh', what: 'memories'},
        {type: 'open_story', id: String((data as {_id: unknown})._id)},
      ],
      undo: {kind: 'remove_story', id: String((data as {_id: unknown})._id)},
      summary: `saved the story "${title}"`,
    };
  } catch (error) {
    return failed(error);
  }
};

const quickNote: Handler = async (userId, args) => {
  const text = str(args.text, MAX_BODY);
  if (!text)
    return say('There is nothing to note yet. Ask what to write down.');
  try {
    const {data} = await memories.quickCaptureMemory({body: text}, userId);
    return {
      result: 'Saved as a quick note. Tell them in a few words.',
      effects: [{type: 'refresh', what: 'memories'}],
      undo: {kind: 'remove_story', id: String((data as {_id: unknown})._id)},
      summary: 'saved the quick note',
    };
  } catch (error) {
    return failed(error);
  }
};

const rememberFactAction: Handler = async (userId, args) => {
  const fact = str(args.fact, MAX_REMEMBERED_LENGTH);
  if (!fact)
    return say('There is nothing to remember yet. Ask what you should keep.');
  try {
    const {id} = await rememberFact(userId, fact);
    return {
      result:
        'Saved to what you know about them, and it will show in their Observations. Tell them in a few words.',
      effects: [{type: 'refresh', what: 'observations'}],
      ...(id && {undo: {kind: 'forget_observation' as const, id}}),
      summary: 'remembered a fact',
    };
  } catch (error) {
    return failed(error);
  }
};

const forgetObservationAction: Handler = async (userId, args) => {
  const query = str(args.query, MAX_REMEMBERED_LENGTH);
  if (!query) return say('Ask what they would like you to forget.');
  try {
    const found = await findObservation(userId, query);
    if (found.kind !== 'one') {
      const options = found.headings.map(h => `"${h}"`).join(', ');
      return say(
        found.kind === 'unsure'
          ? `Nothing was removed. It could be any of these: ${options}. Ask which one, then call again with its exact heading.`
          : `Nothing was removed, because nothing matched.${options ? ` What you keep includes: ${options}.` : ''} Tell them you could not find it. If one of these is what they meant, call again with its exact heading.`,
      );
    }
    const pending = confirmFirst(
      userId,
      'forget_observation',
      {...args, observation: found.id},
      `Forget "${found.heading}": ${found.note} This cannot be undone.`,
    );
    if (pending) return pending;
    await forgetObservation(userId, found.id);
    return {
      result: `Forgotten: "${found.heading}". It is gone from their Observations. Do not bring it up again in this call. Tell them in a few words.`,
      effects: [{type: 'refresh', what: 'observations'}],
      summary: `forgot "${found.heading}"`,
    };
  } catch (error) {
    return failed(error);
  }
};

const bookmarkStory: Handler = async (userId, args) => {
  const story = await findStory(userId, args.query);
  if (!story) return NO_STORY;
  const id = String(story._id);
  const on = args.bookmarked !== false;
  const was = Boolean(await Bookmark.exists({memory: id, user: userId}));
  if (was === on) {
    return say(
      `"${story.title || 'Untitled'}" was already ${on ? 'bookmarked' : 'not bookmarked'}. Nothing changed.`,
    );
  }
  try {
    if (on) await memories.bookmark(id, userId);
    else await memories.unbookmark(id, userId);
  } catch (error) {
    return failed(error);
  }
  return {
    result: `${on ? 'Bookmarked' : 'Removed the bookmark from'} "${story.title || 'Untitled'}".`,
    effects: [{type: 'refresh', what: 'memories'}],
    undo: {kind: 'bookmark', id, on: was},
    summary: `${on ? 'bookmarked' : 'removed the bookmark from'} "${story.title || 'Untitled'}"`,
  };
};

const tagStory: Handler = async (userId, args) => {
  const story = await findStory(userId, args.query);
  if (!story) return NO_STORY;
  const add = list(args.add);
  const remove = new Set(list(args.remove));
  if (!add.length && !remove.size)
    return say('Which tags should be added or removed?');
  const current = (story.tags ?? []).map(tag => String(tag).toLowerCase());
  const tags = [...new Set([...current, ...add])].filter(
    tag => !remove.has(tag),
  );
  try {
    await memories.updateMemory(String(story._id), {tags}, userId);
  } catch (error) {
    return failed(error);
  }
  return {
    result: `"${story.title || 'Untitled'}" tags were ${current.join(', ') || 'none'}; now ${tags.join(', ') || 'none'}.`,
    effects: [{type: 'refresh', what: 'memories'}],
    undo: {
      kind: 'story_fields',
      id: String(story._id),
      tags: story.tags ?? [],
      expectTags: tags,
    },
    summary: `changed the tags on "${story.title || 'Untitled'}"`,
  };
};

const renameStory: Handler = async (userId, args) => {
  const story = await findStory(userId, args.query);
  if (!story) return NO_STORY;
  const title = str(args.title, MAX_TITLE);
  if (!title) return say('What should the new title be?');
  try {
    await memories.updateMemory(String(story._id), {title}, userId);
  } catch (error) {
    return failed(error);
  }
  return {
    result: `Renamed "${story.title || 'Untitled'}" to "${title}". Offer to change it back.`,
    effects: [
      {type: 'refresh', what: 'memories'},
      {type: 'open_story', id: String(story._id)},
    ],
    undo: {
      kind: 'story_fields',
      id: String(story._id),
      title: story.title ?? '',
      expectTitle: title,
    },
    summary: `renamed "${story.title || 'Untitled'}" to "${title}"`,
  };
};

const MAX_HEADING = 120;
const MAX_NOTE = 378;

/** What to say when a description did not name exactly one observation. */
function notOneObservation(
  found: Exclude<ObservationMatch, {kind: 'one'}>,
  lead: string,
): VoiceToolOutcome {
  const options = found.headings.map(h => `"${h}"`).join(', ');
  const start = lead ? `${lead} ` : '';
  return say(
    found.kind === 'unsure'
      ? `${start}It could be any of these: ${options}. Ask which one, then call again with its exact heading.`
      : `${start}Nothing matched.${options ? ` What you keep includes: ${options}.` : ''} Tell them you could not find it. If one of these is what they meant, call again with its exact heading.`,
  );
}

const explainObservationAction: Handler = async (userId, args) => {
  const query = str(args.query, MAX_REMEMBERED_LENGTH);
  if (!query) return say('Ask which observation they mean.');
  try {
    const found = await findObservation(userId, query);
    if (found.kind !== 'one') return notOneObservation(found, '');
    const {
      data: {sources},
    } = await getObservationSources(userId, found.id);
    const listed = sources
      .slice(0, 5)
      .map(source => {
        const kind =
          source.type === 'conversation' ? 'a conversation' : 'the story';
        const when = source.created_at
          ? ` from ${dayjs(source.created_at).format('MMMM YYYY')}`
          : '';
        return `${kind} "${source.title || 'Untitled'}"${when}`;
      })
      .join('; ');
    return say(
      listed
        ? `"${found.heading}": ${found.note} It comes from ${listed}${sources.length > 5 ? `, and ${sources.length - 5} more` : ''}. Tell them in your own words where it came from, and offer to correct it if it is wrong.`
        : `"${found.heading}": ${found.note} It is not linked to a particular story or conversation: they told you directly, or the stories it came from were deleted. Say so, and offer to correct it if it is wrong.`,
    );
  } catch (error) {
    return failed(error);
  }
};

const correctObservationAction: Handler = async (userId, args) => {
  const query = str(args.query, MAX_REMEMBERED_LENGTH);
  if (!query) return say('Ask which observation they want to correct.');
  const note = str(args.note, MAX_NOTE);
  if (!note) return say('Ask what it should say instead, in their words.');
  try {
    const found = await findObservation(userId, query);
    if (found.kind !== 'one')
      return notOneObservation(found, 'Nothing was changed.');
    const heading = str(args.heading, MAX_HEADING) || found.heading;
    const {data} = await updateObservation(userId, found.id, {heading, note});
    return {
      result: `Corrected. It now reads "${data.heading}": ${data.note} It shows in their Observations. Tell them in a few words and offer to change it back.`,
      effects: [{type: 'refresh', what: 'observations'}],
      undo: {
        kind: 'observation_text',
        id: found.id,
        heading: found.heading,
        note: found.note,
        expectHeading: data.heading,
        expectNote: data.note,
      },
      summary: `corrected "${found.heading}"`,
    };
  } catch (error) {
    return failed(error);
  }
};

const HTML_TAG = /<\/?[a-z][^>]*>/i;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** The host's words in the story's own format: paragraphs for editor HTML. */
function asBody(text: string, html: boolean): string {
  if (!html) return text;
  return text
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function wordCount(body: string): number {
  return body
    .replace(/<[^>]*>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

const editStory: Handler = async (userId, args) => {
  const story = await findStory(userId, args.query);
  if (!story) return NO_STORY;
  const text = str(args.text, MAX_BODY);
  if (!text) return say('Ask what they would like the story to say.');
  const id = String(story._id);
  const title = story.title || 'Untitled';
  const replace = args.mode === 'replace';
  const current = String(
    (
      (await Memory.findOne({_id: id, user: userId}).select('body').lean()) as {
        body?: unknown;
      } | null
    )?.body ?? '',
  );
  const html = HTML_TAG.test(current);
  const empty = !current.replace(/<[^>]*>/g, '').trim();
  let body: string;
  if (replace) {
    const pending = confirmFirst(
      userId,
      'edit_story',
      {...args, story: id},
      `Replace all the words of "${title}" (about ${wordCount(current)} words now) with the new text (about ${wordCount(text)} words). Undo can bring the old text back for half an hour.`,
    );
    if (pending) return pending;
    body = asBody(text, html);
  } else {
    body = empty
      ? asBody(text, html)
      : html
        ? `${current}${asBody(text, true)}`
        : `${current.trimEnd()}\n\n${text}`;
  }
  try {
    await memories.updateMemory(id, {body}, userId);
  } catch (error) {
    return failed(error);
  }
  return {
    result: replace
      ? `Replaced the text of "${title}". It is on screen. Tell them, and offer to change it back.`
      : `Added their words to the end of "${title}". It is on screen. Tell them in a few words.`,
    effects: [
      {type: 'refresh', what: 'memories'},
      {type: 'open_story', id},
    ],
    undo: {kind: 'story_fields', id, body: current, expectBody: body},
    summary: `${replace ? 'replaced the text of' : 'added to'} "${title}"`,
  };
};

type Access = {
  groups: string[];
  beneficiaries: string[];
  visibility: 'private' | 'everyone';
};

async function storyAccess(userId: string, id: string): Promise<Access> {
  const row = (await Memory.findOne({_id: id, user: userId})
    .select('groups beneficiaries visibility')
    .lean()) as {
    groups?: unknown[];
    beneficiaries?: unknown[];
    visibility?: string;
  } | null;
  return {
    groups: (row?.groups ?? []).map(String),
    beneficiaries: (row?.beneficiaries ?? []).map(String),
    visibility: row?.visibility === 'everyone' ? 'everyone' : 'private',
  };
}

/** Who can see a story now, in words. */
async function describeAccess(userId: string, access: Access) {
  if (access.groups.length || access.beneficiaries.length) {
    const [groups, people] = await Promise.all([
      Group.find({_id: {$in: access.groups}, user: userId})
        .select('name')
        .lean(),
      Beneficiary.find({_id: {$in: access.beneficiaries}, benefactor: userId})
        .select('name')
        .lean(),
    ]);
    const names = [
      ...people.map(p => String(p.name || 'a beneficiary')),
      ...groups.map(g => `the group ${String(g.name || 'unnamed')}`),
    ];
    return `shared only with ${names.join(', ') || 'specific people'}`;
  }
  return access.visibility === 'everyone'
    ? 'visible to everyone'
    : 'private to them';
}

function sameAccess(a: Access, b: Access): boolean {
  const same = (x: string[], y: string[]) =>
    x.length === y.length && [...x].sort().join() === [...y].sort().join();
  return (
    a.visibility === b.visibility &&
    same(a.groups, b.groups) &&
    same(a.beneficiaries, b.beneficiaries)
  );
}

async function applyAccess(
  userId: string,
  id: string,
  before: Access,
  after: Access,
) {
  await memories.updateMemory(id, after, userId);
  return {kind: 'story_access' as const, id, ...before, expect: after};
}

function names(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/,| and /)
      : [];
  return [...new Set(items.map(item => str(item, 100)).filter(Boolean))].slice(
    0,
    MAX_TAGS,
  );
}

const shareStory: Handler = async (userId, args) => {
  const story = await findStory(userId, args.query);
  if (!story) return NO_STORY;
  const wanted = names(args.with);
  if (!wanted.length)
    return say('Ask which beneficiaries or groups to share it with.');
  const id = String(story._id);
  const title = story.title || 'Untitled';

  const groupIds: string[] = [];
  const beneficiaryIds: string[] = [];
  const matched: string[] = [];
  for (const name of wanted) {
    const pattern = new RegExp(`^${escapeRegex(name)}$`, 'i');
    const loose = new RegExp(escapeRegex(name), 'i');
    const person =
      (await Beneficiary.findOne({benefactor: userId, name: pattern})
        .select('name')
        .lean()) ??
      (await Beneficiary.findOne({benefactor: userId, name: loose})
        .select('name')
        .lean());
    if (person) {
      beneficiaryIds.push(String(person._id));
      matched.push(String(person.name));
      continue;
    }
    const group =
      (await Group.findOne({user: userId, name: pattern})
        .select('name')
        .lean()) ??
      (await Group.findOne({user: userId, name: loose}).select('name').lean());
    if (group) {
      groupIds.push(String(group._id));
      matched.push(`the group ${String(group.name)}`);
      continue;
    }
    return say(
      `Nothing was shared. "${name}" is not one of their beneficiaries or groups. Ask who they meant, or offer to add them as a beneficiary first.`,
    );
  }

  const before = await storyAccess(userId, id);
  const after: Access = {
    groups: [...new Set([...before.groups, ...groupIds])],
    beneficiaries: [...new Set([...before.beneficiaries, ...beneficiaryIds])],
    visibility: 'private',
  };
  if (sameAccess(before, after)) {
    return say(
      `"${title}" is already shared with ${matched.join(', ')}. Nothing changed.`,
    );
  }
  const now = await describeAccess(userId, before);
  const narrowing =
    before.visibility === 'everyone' &&
    !before.groups.length &&
    !before.beneficiaries.length
      ? ' It is visible to everyone now; after this only the people it is shared with will see it.'
      : '';
  const pending = confirmFirst(
    userId,
    'share_story',
    {...args, story: id},
    `Share "${title}" with ${matched.join(', ')}. It is ${now} now.${narrowing} It stays off public, and they will be able to see it in Memento.`,
  );
  if (pending) return pending;
  let undo;
  try {
    undo = await applyAccess(userId, id, before, after);
  } catch (error) {
    return failed(error);
  }
  return {
    result: `Shared "${title}" with ${matched.join(', ')}. It is now ${await describeAccess(userId, after)}. Tell them in a few words.`,
    effects: [
      {type: 'refresh', what: 'memories'},
      {type: 'open_story', id},
    ],
    undo,
    summary: `shared "${title}" with ${matched.join(', ')}`,
  };
};

const setStoryVisibility: Handler = async (userId, args) => {
  const story = await findStory(userId, args.query);
  if (!story) return NO_STORY;
  const everyone = args.visibility === 'everyone';
  if (!everyone && args.visibility !== 'only_me') {
    return say(
      'Ask whether they want it private to them, or visible to everyone.',
    );
  }
  const id = String(story._id);
  const title = story.title || 'Untitled';
  const before = await storyAccess(userId, id);
  const after: Access = {
    groups: [],
    beneficiaries: [],
    visibility: everyone ? 'everyone' : 'private',
  };
  if (sameAccess(before, after)) {
    return say(
      `"${title}" is already ${everyone ? 'visible to everyone' : 'private to them'}. Nothing changed.`,
    );
  }
  const now = await describeAccess(userId, before);
  if (everyone) {
    const pending = confirmFirst(
      userId,
      'set_story_visibility',
      {...args, story: id},
      `Make "${title}" visible to everyone: all their beneficiaries and the people they are connected with in Memento will be able to see it. It is ${now} now.`,
    );
    if (pending) return pending;
  }
  let undo;
  try {
    undo = await applyAccess(userId, id, before, after);
  } catch (error) {
    return failed(error);
  }
  return {
    result: everyone
      ? `"${title}" is now visible to everyone. Tell them in a few words.`
      : `"${title}" is now private: only they can see it. It was ${now}. Tell them in a few words and offer to change it back.`,
    effects: [
      {type: 'refresh', what: 'memories'},
      {type: 'open_story', id},
    ],
    undo,
    summary: `made "${title}" ${everyone ? 'visible to everyone' : 'private'}`,
  };
};

/** One of the host's beneficiaries by name, for capsule recipients. */
async function findBeneficiary(userId: string, name: string) {
  if (!name) return undefined;
  const pattern = new RegExp(escapeRegex(name), 'i');
  return Beneficiary.findOne({benefactor: userId, name: pattern})
    .select('name email')
    .lean();
}

const draftCapsule: Handler = async (userId, args) => {
  const title = str(args.title, MAX_TITLE);
  const message = str(args.message, MAX_BODY);
  if (!title || !message) {
    return say(
      'A capsule needs a title and a message. Ask for whichever is missing.',
    );
  }
  const recipientName = str(args.recipient, 100);
  const recipient = await findBeneficiary(userId, recipientName);
  if (recipientName && !recipient) {
    return say(
      `"${recipientName}" is not one of their beneficiaries. Ask who it is for, or offer to add them as a beneficiary first.`,
    );
  }
  let created: {_id?: unknown};
  try {
    ({data: created} = await capsules.createCapsule(
      {
        title,
        body: message,
        status: 'draft',
        recipients: recipient
          ? [
              {
                beneficiary_id: String(recipient._id),
                email: recipient.email,
                display_name: recipient.name,
              },
            ]
          : [],
      } as never,
      userId,
    ));
  } catch (error) {
    return failed(error);
  }
  return {
    undo: {kind: 'remove_capsule', id: String(created._id)},
    summary: `drafted the capsule "${title}"`,
    result: `Drafted a capsule "${title}"${recipient ? ` for ${recipient.name}` : ''}. It is saved as a draft and not scheduled. Their capsules are on screen.`,
    effects: [
      {type: 'refresh', what: 'capsules'},
      {type: 'open', destination: 'time_capsules'},
    ],
  };
};

const scheduleCapsule: Handler = async (userId, args) => {
  const words = str(args.capsule, MAX_TITLE);
  const capsule = words
    ? await Capsule.findOne({
        user: userId,
        status: {$in: ['draft', 'pause']},
        title: new RegExp(escapeRegex(words), 'i'),
      })
        .sort({updated_at: -1})
        .lean()
    : null;
  if (!capsule) {
    return say('No draft capsule matched. Ask which capsule they mean.');
  }
  const given = str(args.date, 10);
  const date = dayjs(given);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(given) ||
    !date.isValid() ||
    date.format('YYYY-MM-DD') !== given ||
    !date.isAfter(dayjs(), 'day')
  ) {
    return say(
      'The delivery date must be a real date in the future. Ask for the day, month and year.',
    );
  }
  const to =
    (capsule.recipient_snapshots ?? [])
      .map(recipient => recipient.display_name || recipient.email)
      .filter(Boolean)
      .join(', ') || 'no one yet';
  const pending = confirmFirst(
    userId,
    'schedule_capsule',
    args,
    `Schedule the capsule "${capsule.title}" to be delivered to ${to} on ${date.format('D MMMM YYYY')}.`,
  );
  if (pending) return pending;
  try {
    await capsules.updateCapsule(
      String(capsule._id),
      {schedule_date: `${given}T09:00:00.000Z`} as never,
      userId,
    );
    await capsules.scheduleCapsule(String(capsule._id), userId);
  } catch (error) {
    return failed(error);
  }
  return {
    result: `Scheduled "${capsule.title}" for ${date.format('D MMMM YYYY')}.`,
    undo: {
      kind: 'unschedule_capsule',
      id: String(capsule._id),
      status: capsule.status,
      schedule_date: capsule.schedule_date
        ? new Date(capsule.schedule_date).toISOString()
        : undefined,
    },
    summary: `scheduled the capsule "${capsule.title}"`,
    effects: [
      {type: 'refresh', what: 'capsules'},
      {type: 'open', destination: 'time_capsules'},
    ],
  };
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const addBeneficiary: Handler = async (userId, args) => {
  const name = str(args.name, 100);
  const email = str(args.email, 320).toLowerCase();
  const relationship = str(args.relationship, 60) || 'friend';
  if (!name || !EMAIL.test(email)) {
    return say(
      'Adding a beneficiary needs their name and a valid email address. Ask for whichever is missing, and spell the email back.',
    );
  }
  const pending = confirmFirst(
    userId,
    'add_beneficiary',
    args,
    `Add ${name} (${relationship}) as a beneficiary. This emails an invitation to ${email}.`,
  );
  if (pending) return pending;
  let added: {_id?: unknown} | undefined;
  try {
    ({data: added} = await beneficiaries.create(
      {email, name, relationship, about: ''} as CreateBeneficiaryBody,
      userId,
    ));
  } catch (error) {
    return failed(error);
  }
  return {
    result: `Added ${name} as a beneficiary and sent the invitation to ${email}.`,
    undo: added
      ? {kind: 'remove_beneficiary', id: String(added._id), email}
      : undefined,
    summary: `added ${name} as a beneficiary`,
    effects: [
      {type: 'refresh', what: 'beneficiaries'},
      {type: 'open', destination: 'beneficiaries'},
    ],
  };
};

const deleteStory: Handler = async (userId, args) => {
  const story = await findStory(userId, args.query);
  if (!story) return NO_STORY;
  const pending = confirmFirst(
    userId,
    'delete_story',
    {...args, story: String(story._id)},
    `Delete the story "${story.title || 'Untitled'}".`,
  );
  if (pending) return pending;
  try {
    await memories.deleteMemory(
      {memory_id: String(story._id)} as never,
      userId,
    );
  } catch (error) {
    return failed(error);
  }
  return {
    result: `Deleted "${story.title || 'Untitled'}". It can be brought back if they change their mind.`,
    effects: [{type: 'refresh', what: 'memories'}],
    undo: {kind: 'restore_story', id: String(story._id)},
    summary: `deleted the story "${story.title || 'Untitled'}"`,
  };
};

const sendFeedback: Handler = async (userId, args) => {
  const message = str(args.message, 5_000);
  if (!message) return say('What would they like to tell the Memento team?');
  const pending = confirmFirst(
    userId,
    'send_feedback',
    args,
    `Send this to the Memento team: "${message}".`,
  );
  if (pending) return pending;
  const user = await User.findById(userId).select('email').lean();
  if (!user?.email)
    return say(
      'Their account has no email address, so feedback has to be sent from the app.',
    );
  try {
    await feedback.createFeedback(
      {type: 'General Feedback', email: user.email, message} as never,
      userId,
    );
  } catch (error) {
    return failed(error);
  }
  return say('Sent their feedback to the Memento team. Thank them.');
};

export const CONTENT_ACTION_HANDLERS: Record<string, Handler> = {
  save_story: saveStory,
  quick_note: quickNote,
  remember_fact: rememberFactAction,
  forget_observation: forgetObservationAction,
  explain_observation: explainObservationAction,
  correct_observation: correctObservationAction,
  bookmark_story: bookmarkStory,
  tag_story: tagStory,
  rename_story: renameStory,
  edit_story: editStory,
  share_story: shareStory,
  set_story_visibility: setStoryVisibility,
  draft_capsule: draftCapsule,
  schedule_capsule: scheduleCapsule,
  add_beneficiary: addBeneficiary,
  delete_story: deleteStory,
  send_feedback: sendFeedback,
};
