import dayjs from 'dayjs';
import Beneficiary from '../../../database/model/beneficiary';
import Capsule from '../../../database/model/capsule';
import User from '../../../database/model/user';
import * as beneficiaries from '../../beneficiary/service';
import type {CreateBeneficiaryBody} from '../../beneficiary/dto';
import * as capsules from '../../capsule/service';
import * as feedback from '../../feedback/service';
import * as memories from '../../memory/service';
import {JWT_SECRET} from '../../../../utils/config';
import {confirmationCode, isConfirmed} from './confirmation';
import {escapeRegex} from './memory-search';
import {findStory} from './find-story';
import type {VoiceToolOutcome} from './server-tool-types';

/**
 * Things Memento can do with the host's content by voice, through the same
 * services the app's screens use, as the host.
 *
 * Two tiers:
 * - Done straight away, then offered back: save a story, a quick note,
 *   bookmark, tag or rename a story, draft a capsule. All are easy to undo.
 * - Confirmed first: adding a beneficiary (emails an invite), scheduling a
 *   capsule, deleting a story, sending feedback. The first call only reads
 *   the action back with a code; a second call with the code runs it.
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
) => Promise<VoiceToolOutcome>;

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

/** A service refusal (validation, not found) as something Memento can say. */
function failed(error: unknown): VoiceToolOutcome {
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'something went wrong';
  return say(
    `That did not work: ${message}. Tell the host plainly and suggest doing it in the app.`,
  );
}

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
    await memories.quickCaptureMemory({body: text}, userId);
    return {
      result: 'Saved as a quick note. Tell them in a few words.',
      effects: [{type: 'refresh', what: 'memories'}],
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
  try {
    if (on) await memories.bookmark(id, userId);
    else await memories.unbookmark(id, userId);
  } catch (error) {
    return failed(error);
  }
  return {
    result: `${on ? 'Bookmarked' : 'Removed the bookmark from'} "${story.title || 'Untitled'}".`,
    effects: [{type: 'refresh', what: 'memories'}],
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
  try {
    await capsules.createCapsule(
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
    );
  } catch (error) {
    return failed(error);
  }
  return {
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
  try {
    await beneficiaries.create(
      {email, name, relationship, about: ''} as CreateBeneficiaryBody,
      userId,
    );
  } catch (error) {
    return failed(error);
  }
  return {
    result: `Added ${name} as a beneficiary and sent the invitation to ${email}.`,
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
    result: `Deleted "${story.title || 'Untitled'}". It can be restored from the app for a while.`,
    effects: [{type: 'refresh', what: 'memories'}],
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
  bookmark_story: bookmarkStory,
  tag_story: tagStory,
  rename_story: renameStory,
  draft_capsule: draftCapsule,
  schedule_capsule: scheduleCapsule,
  add_beneficiary: addBeneficiary,
  delete_story: deleteStory,
  send_feedback: sendFeedback,
};
