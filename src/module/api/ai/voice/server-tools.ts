import dayjs from 'dayjs';
import User from '../../../database/model/user';
import VoiceAction from '../../../database/model/voice-action';
import * as users from '../../user/service';
import {CONTENT_ACTION_HANDLERS} from './content-actions';
import {findStory} from './find-story';
import type {VoiceToolOutcome, VoiceToolRun} from './server-tool-types';
import {
  OPEN_STORY_TOOL_NAME,
  UNDO_LAST_ACTION_TOOL_NAME,
  UPDATE_PROFILE_TOOL_NAME,
} from './server-tool-declarations';
import {failed} from './tool-errors';
import {undoLastAction} from './undo';

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
 *
 * Every action is logged with how to reverse it ("undo that"). When the app
 * sends Gemini's call id, a repeated call (Gemini resends after a reconnect)
 * gets the first result back instead of acting twice.
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
): Promise<VoiceToolRun> {
  const update: Record<string, unknown> = {};
  const restore: Record<string, unknown> = {};
  const changed: string[] = [];
  // What each field was, so Memento can answer "what was it before?" and
  // change it back.
  const before = ((await User.findById(userId)
    .select('first_name last_name nickname country location dob')
    .lean()) ?? {}) as Record<string, unknown>;
  const was = (value: unknown) =>
    value === undefined || value === null || value === ''
      ? 'empty'
      : `"${String(value)}"`;
  for (const [arg, {field, label}] of Object.entries(PROFILE_FIELDS)) {
    const value = text(args[arg]);
    if (value === undefined) continue;
    update[field] = value;
    restore[field] = before[field] ?? null;
    changed.push(`${label} from ${was(before[field])} to "${value}"`);
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
    restore.dob = before.dob ?? null;
    const previous = before.dob
      ? dayjs(before.dob as Date).format('D MMMM YYYY')
      : undefined;
    changed.push(
      `birthday from ${previous ? `"${previous}"` : 'empty'} to "${birthday.format('D MMMM YYYY')}"`,
    );
  }
  if (!changed.length) {
    return {
      result:
        'There was nothing to change: voice can update their name, nickname, country, location or birthday. Other details are changed in the app.',
      effects: [],
    };
  }

  try {
    await users.updateProfile(update, userId);
  } catch (error) {
    return failed(error);
  }
  return {
    undo: {kind: 'profile', fields: restore, expect: update},
    summary: `changed their ${changed.join(', ')}`,
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

/** The voice call a tool runs in, as the app identifies it. */
export type VoiceToolContext = {sessionId?: string};

const HANDLERS: Record<
  string,
  (
    userId: string,
    args: Record<string, unknown>,
    context: VoiceToolContext,
  ) => Promise<VoiceToolRun>
> = {
  [UPDATE_PROFILE_TOOL_NAME]: updateProfile,
  [OPEN_STORY_TOOL_NAME]: openStory,
  [UNDO_LAST_ACTION_TOOL_NAME]: (userId, _args, context) =>
    undoLastAction(userId, {sessionId: context.sessionId}),
  ...CONTENT_ACTION_HANDLERS,
};

/** How long a repeated call waits for the first one to finish. */
const REPEAT_WAIT_MS = 15_000;
const REPEAT_POLL_MS = 250;

function isDuplicateKey(error: unknown): boolean {
  return (error as {code?: number})?.code === 11000;
}

/** The first run's outcome for a repeated call id. */
async function replay(
  userId: string,
  callId: string,
  name: string,
  waitMs: number,
): Promise<VoiceToolOutcome> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const first = await VoiceAction.findOne({user: userId, call_id: callId})
      .select('tool running outcome')
      .lean();
    // The same id for a different tool is not a repeat; never hand one
    // tool's result to another.
    if (first && first.tool !== name) {
      return {
        result: `${name} did not run. Tell the host it did not work and that they can try again.`,
        effects: [],
      };
    }
    if (first && !first.running && first.outcome) {
      return first.outcome as VoiceToolOutcome;
    }
    if (!first || Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, REPEAT_POLL_MS));
  }
  return {
    result:
      'That request is already being handled. Do not call it again; tell the host it is on its way.',
    effects: [],
  };
}

export async function runVoiceServerTool(
  userId: string,
  name: string,
  args: Record<string, unknown>,
  options: {callId?: string; sessionId?: string; repeatWaitMs?: number} = {},
): Promise<VoiceToolOutcome> {
  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, name)
    ? HANDLERS[name]
    : undefined;
  if (!handler) throw new UnknownVoiceToolError(name);
  const {callId, sessionId} = options;
  const session = sessionId ? {session_id: sessionId} : {};

  let claim: string | undefined;
  if (callId) {
    try {
      const created = await VoiceAction.create({
        user: userId,
        tool: name,
        call_id: callId,
        ...session,
        running: true,
      });
      claim = String(created._id);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      return replay(
        userId,
        callId,
        name,
        options.repeatWaitMs ?? REPEAT_WAIT_MS,
      );
    }
  }

  let run: VoiceToolRun;
  try {
    run = await handler(userId, args ?? {}, {sessionId});
  } catch (error) {
    // Free the call id so a retry can run.
    if (claim) await VoiceAction.deleteOne({_id: claim});
    throw error;
  }
  const outcome: VoiceToolOutcome = {result: run.result, effects: run.effects};
  const entry = {
    outcome,
    ...(run.undo && {undo: run.undo}),
    ...(run.summary && {summary: run.summary}),
  };
  if (claim) {
    await VoiceAction.updateOne(
      {_id: claim},
      {$set: {...entry, running: false}},
    );
  } else if (run.undo) {
    await VoiceAction.create({user: userId, tool: name, ...session, ...entry});
  }
  return outcome;
}
