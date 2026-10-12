import dayjs from 'dayjs';
import * as users from '../../user/service';
import {CONTENT_ACTION_HANDLERS} from './content-actions';
import {findStory} from './find-story';
import type {VoiceToolOutcome} from './server-tool-types';
import {
  OPEN_STORY_TOOL_NAME,
  UPDATE_PROFILE_TOOL_NAME,
} from './server-tool-declarations';

export {SERVER_TOOL_NAMES} from './server-tool-declarations';

/**
 * Tools Memento runs on the server during a voice call. Gemini sends the
 * call to the app, the app forwards it to POST /ai/voice/tools/:name, and
 * this module does the work with the host's own permissions, reusing the
 * same services the app's screens call.
 *
 * Besides the text Gemini hears, a tool returns effects for the app to apply
 * (refresh a cached screen, open a screen or a story). The app applies only
 * the effect types it knows, so new tools can be added here without an app
 * release as long as they use existing effect types.
 */

export type {VoiceToolEffect, VoiceToolOutcome} from './server-tool-types';

export class UnknownVoiceToolError extends Error {
  constructor(name: string) {
    super(`Unknown voice tool: ${name}`);
  }
}

/** Profile fields voice may change, mapped to user fields. Never email, phone or security. */
const PROFILE_FIELDS = {
  first_name: {field: 'first_name', label: 'first name'},
  last_name: {field: 'last_name', label: 'last name'},
  nickname: {field: 'nickname', label: 'nickname'},
  country: {field: 'country', label: 'country'},
  location: {field: 'location', label: 'location'},
} as const;
const MAX_PROFILE_TEXT = 100;

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, MAX_PROFILE_TEXT);
  return trimmed || undefined;
}

async function updateProfile(
  userId: string,
  args: Record<string, unknown>,
): Promise<VoiceToolOutcome> {
  const update: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const [arg, {field, label}] of Object.entries(PROFILE_FIELDS)) {
    const value = text(args[arg]);
    if (value === undefined) continue;
    update[field] = value;
    changed.push(`${label} to ${value}`);
  }
  if (args.birthday !== undefined) {
    const given = String(args.birthday);
    const birthday = dayjs(given);
    // Must read back unchanged: dayjs rolls 1990-02-31 over to 3 March.
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(given) ||
      !birthday.isValid() ||
      birthday.format('YYYY-MM-DD') !== given ||
      birthday.isAfter(dayjs())
    ) {
      return {
        result:
          'That birthday is not a valid past date, so nothing was changed. Ask the host for the day, month and year.',
        effects: [],
      };
    }
    update.dob = `${given}T00:00:00.000Z`;
    changed.push(`birthday to ${birthday.format('D MMMM YYYY')}`);
  }
  if (!changed.length) {
    return {
      result:
        'There was nothing to change: voice can update their name, nickname, country, location or birthday. Other details are changed in the app.',
      effects: [],
    };
  }

  await users.updateProfile(update, userId);
  return {
    result: `Done: changed their ${changed.join(', ')}. Their profile is now on screen. Tell them briefly and offer to change it back.`,
    effects: [
      {type: 'refresh', what: 'profile'},
      {type: 'open', destination: 'profile'},
    ],
  };
}

async function openStory(
  userId: string,
  args: Record<string, unknown>,
): Promise<VoiceToolOutcome> {
  const story = await findStory(userId, args.query);
  if (!story) {
    return {
      result:
        'No story matched. Tell the host you could not find it and ask what it was called.',
      effects: [],
    };
  }
  const title = String(story.title || 'Untitled');
  return {
    result: `Opened their story "${title}" on screen. Say so in a few words.`,
    effects: [{type: 'open_story', id: String(story._id)}],
  };
}

const HANDLERS: Record<
  string,
  (userId: string, args: Record<string, unknown>) => Promise<VoiceToolOutcome>
> = {
  [UPDATE_PROFILE_TOOL_NAME]: updateProfile,
  [OPEN_STORY_TOOL_NAME]: openStory,
  ...CONTENT_ACTION_HANDLERS,
};

export async function runVoiceServerTool(
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<VoiceToolOutcome> {
  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, name)
    ? HANDLERS[name]
    : undefined;
  if (!handler) throw new UnknownVoiceToolError(name);
  return handler(userId, args ?? {});
}
