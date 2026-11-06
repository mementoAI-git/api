import dayjs from 'dayjs';
import Memory from '../../../database/model/memory';
import User from '../../../database/model/user';
import VoiceAction from '../../../database/model/voice-action';
import * as beneficiaries from '../../beneficiary/service';
import * as capsules from '../../capsule/service';
import * as memories from '../../memory/service';
import {forgetObservation} from '../../persona/observations';
import * as users from '../../user/service';
import type {
  VoiceToolEffect,
  VoiceToolOutcome,
  VoiceUndo,
} from './server-tool-types';
import {failed} from './tool-errors';

/**
 * "Undo that": reverses the most recent thing Memento did by voice, one per
 * call, newest first, within half an hour. Each action stored how to
 * reverse itself when it ran (see VoiceToolRun.undo), so this never has to
 * guess what the host's data looked like before.
 */

export const UNDO_WINDOW_MS = 30 * 60_000;

/** The host changed it again after Memento did, so undo would overwrite them. */
export class UndoConflictError extends Error {}

function sameValue(
  field: string,
  current: unknown,
  expected: unknown,
): boolean {
  const empty = (value: unknown) =>
    value === undefined || value === null || value === '';
  if (empty(current) && empty(expected)) return true;
  if (field === 'dob') {
    return (
      !empty(current) &&
      !empty(expected) &&
      dayjs(current as Date)
        .toISOString()
        .slice(0, 10) ===
        dayjs(expected as string)
          .toISOString()
          .slice(0, 10)
    );
  }
  return String(current) === String(expected);
}

function sameTags(current: unknown, expected: string[]): boolean {
  const a = (Array.isArray(current) ? current : []).map(tag =>
    String(tag).toLowerCase(),
  );
  const b = expected.map(tag => tag.toLowerCase());
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

/** Throws UndoConflictError when what Memento set is no longer there. */
async function assertUnchanged(userId: string, undo: VoiceUndo): Promise<void> {
  if (undo.kind === 'profile' && undo.expect) {
    const fields = Object.keys(undo.expect);
    const current = ((await User.findById(userId)
      .select(fields.join(' '))
      .lean()) ?? {}) as Record<string, unknown>;
    if (
      fields.some(
        field => !sameValue(field, current[field], undo.expect![field]),
      )
    ) {
      throw new UndoConflictError();
    }
  }
  if (
    undo.kind === 'story_fields' &&
    (undo.expectTitle !== undefined || undo.expectTags !== undefined)
  ) {
    const story = (await Memory.findOne({_id: undo.id, user: userId})
      .select('title tags')
      .lean()) as {title?: unknown; tags?: unknown} | null;
    if (!story) throw new UndoConflictError();
    if (
      undo.expectTitle !== undefined &&
      !sameValue('title', story.title, undo.expectTitle)
    ) {
      throw new UndoConflictError();
    }
    if (
      undo.expectTags !== undefined &&
      !sameTags(story.tags, undo.expectTags)
    ) {
      throw new UndoConflictError();
    }
  }
}

async function reverse(
  userId: string,
  undo: VoiceUndo,
): Promise<{effects: VoiceToolEffect[]; note?: string}> {
  await assertUnchanged(userId, undo);
  switch (undo.kind) {
    case 'profile':
      await users.updateProfile(undo.fields as never, userId);
      return {
        effects: [
          {type: 'refresh', what: 'profile'},
          {type: 'open', destination: 'profile'},
        ],
      };
    case 'story_fields': {
      const fields: Record<string, unknown> = {};
      if (undo.title !== undefined) fields.title = undo.title;
      if (undo.tags !== undefined) fields.tags = undo.tags;
      await memories.updateMemory(undo.id, fields as never, userId);
      return {
        effects: [
          {type: 'refresh', what: 'memories'},
          {type: 'open_story', id: undo.id},
        ],
      };
    }
    case 'bookmark':
      if (undo.on) await memories.bookmark(undo.id, userId);
      else await memories.unbookmark(undo.id, userId);
      return {effects: [{type: 'refresh', what: 'memories'}]};
    case 'forget_observation':
      await forgetObservation(userId, undo.id);
      return {effects: []};
    case 'remove_story':
      await memories.deleteMemory({memory_id: undo.id} as never, userId);
      return {
        effects: [
          {type: 'refresh', what: 'memories'},
          {type: 'open', destination: 'stories'},
        ],
      };
    case 'restore_story':
      await memories.restoreMemory(undo.id, userId);
      return {
        effects: [
          {type: 'refresh', what: 'memories'},
          {type: 'open_story', id: undo.id},
        ],
      };
    case 'remove_capsule':
      await capsules.deleteCapsule(undo.id, userId);
      return {effects: [{type: 'refresh', what: 'capsules'}]};
    case 'unschedule_capsule':
      // The queued delivery stays, but it only sends scheduled capsules.
      await capsules.updateCapsule(
        undo.id,
        {
          status: undo.status,
          ...(undo.schedule_date && {schedule_date: undo.schedule_date}),
        } as never,
        userId,
      );
      return {effects: [{type: 'refresh', what: 'capsules'}]};
    case 'remove_beneficiary':
      await beneficiaries.del(undo.id, userId);
      return {
        effects: [{type: 'refresh', what: 'beneficiaries'}],
        note: `The invitation email to ${undo.email} had already been sent; say so.`,
      };
  }
}

export async function undoLastAction(
  userId: string,
  options: {sessionId?: string; now?: number} = {},
): Promise<VoiceToolOutcome> {
  const now = options.now ?? Date.now();
  const latest = await VoiceAction.findOne({
    user: userId,
    // Within this call only, when the app says which call it is: "undo that"
    // must not reach into another call or device.
    ...(options.sessionId && {session_id: options.sessionId}),
    undo: {$exists: true},
    undone_at: {$exists: false},
    running: false,
    created_at: {$gte: new Date(now - UNDO_WINDOW_MS)},
  })
    .sort({created_at: -1})
    .lean();
  // Claimed first, so two quick "undo"s never reverse the same action twice.
  const claimed =
    latest &&
    (await VoiceAction.findOneAndUpdate(
      {_id: latest._id, undone_at: {$exists: false}},
      {$set: {undone_at: new Date(now)}},
    ).lean());
  if (!claimed?.undo) {
    return {
      result:
        'There is nothing recent to undo. What you do by voice can be undone for half an hour; tell them older changes are made in the app.',
      effects: [],
    };
  }
  try {
    const {effects, note} = await reverse(
      userId,
      claimed.undo as unknown as VoiceUndo,
    );
    return {
      result: `Undone: ${claimed.summary || claimed.tool} has been reversed.${note ? ` ${note}` : ''} Tell them in a few words.`,
      effects,
    };
  } catch (error) {
    if (error instanceof UndoConflictError) {
      // Left as it is: the host's newer change wins.
      return {
        result: `I did not undo it: ${claimed.summary || claimed.tool}, but it has been changed again since, so I left it as it is now. Tell them, and that they can change it in the app.`,
        effects: [],
      };
    }
    await VoiceAction.updateOne({_id: claimed._id}, {$unset: {undone_at: 1}});
    return failed(error, 'undo_last_action');
  }
}
