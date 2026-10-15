import VoiceAction from '../../../database/model/voice-action';
import * as beneficiaries from '../../beneficiary/service';
import * as capsules from '../../capsule/service';
import * as memories from '../../memory/service';
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

async function reverse(
  userId: string,
  undo: VoiceUndo,
): Promise<{effects: VoiceToolEffect[]; note?: string}> {
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
  now = Date.now(),
): Promise<VoiceToolOutcome> {
  const latest = await VoiceAction.findOne({
    user: userId,
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
    await VoiceAction.updateOne({_id: claimed._id}, {$unset: {undone_at: 1}});
    return failed(error, 'undo_last_action');
  }
}
