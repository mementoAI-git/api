import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

// No Redis in tests: caches and queues are skipped.
vi.mock('../../src/services/redis', () => ({
  default: null,
  getRedisConnection: () => null,
  getCachedJson: async () => null,
  setCachedJson: async () => {},
  deleteCacheValue: async () => {},
}));
vi.mock('../../src/module/mail', () => ({
  default: {
    sendBeneficiaryInvite: vi.fn().mockResolvedValue(undefined),
    sendCapsuleReveal: vi.fn().mockResolvedValue(undefined),
  },
}));

import Beneficiary from '../../src/module/database/model/beneficiary';
import Bookmark from '../../src/module/database/model/bookmarks';
import Capsule from '../../src/module/database/model/capsule';
import Memory from '../../src/module/database/model/memory';
import User from '../../src/module/database/model/user';
import VoiceAction from '../../src/module/database/model/voice-action';
import {runVoiceServerTool} from '../../src/module/api/ai/voice/server-tools';
import {failed} from '../../src/module/api/ai/voice/tool-errors';
import {
  UNDO_WINDOW_MS,
  undoLastAction,
} from '../../src/module/api/ai/voice/undo';
import {ServiceError} from '../../src/utils/service-error';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

function codeIn(result: string): string {
  const match = result.match(/confirmation "([A-Z2-7]{8})"/);
  if (!match) throw new Error(`No confirmation code in: ${result}`);
  return match[1];
}

/** Runs a confirmed tool: the read-back, then the call with its code. */
async function confirmed(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
) {
  const first = await runVoiceServerTool(userId, tool, args);
  return runVoiceServerTool(userId, tool, {
    ...args,
    confirmation: codeIn(first.result),
  });
}

async function story(userId: string, title: string, tags: string[] = []) {
  return Memory.create({
    user: userId,
    type: 'story',
    status: 'save',
    title,
    body: `<p>${title}</p>`,
    tags,
  });
}

const undo = (userId: string) =>
  runVoiceServerTool(userId, 'undo_last_action', {});

describe('voice undo and repeated calls', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('changes a renamed story back, then has nothing left to undo', async () => {
    const user = await createUserFixture();
    const lagos = await story(user.id, 'Lagos trip');

    await runVoiceServerTool(user.id, 'rename_story', {
      query: 'Lagos',
      title: 'Beach day',
    });
    expect((await Memory.findById(lagos.id))?.title).toBe('Beach day');

    const undone = await undo(user.id);
    expect(undone.result).toContain('renamed "Lagos trip" to "Beach day"');
    expect(undone.effects).toContainEqual({
      type: 'open_story',
      id: lagos.id,
    });
    expect((await Memory.findById(lagos.id))?.title).toBe('Lagos trip');

    expect((await undo(user.id)).result).toContain('nothing recent to undo');
  });

  it('puts profile fields back, including ones that were empty', async () => {
    const user = await createUserFixture();
    await User.updateOne(
      {_id: user.id},
      {$set: {first_name: 'Ada'}, $unset: {nickname: 1}},
    );

    await runVoiceServerTool(user.id, 'update_profile', {
      first_name: 'Adaeze',
      nickname: 'Yo',
    });
    await undo(user.id);

    const after = await User.findById(user.id).lean();
    expect(after?.first_name).toBe('Ada');
    expect(after?.nickname ?? null).toBeNull();
  });

  it('undoes newest first, one action per call', async () => {
    const user = await createUserFixture();
    const lagos = await story(user.id, 'Lagos', ['travel']);

    await runVoiceServerTool(user.id, 'tag_story', {
      query: 'Lagos',
      add: ['family'],
    });
    await runVoiceServerTool(user.id, 'bookmark_story', {query: 'Lagos'});
    expect(await Bookmark.countDocuments({memory: lagos.id})).toBe(1);

    expect((await undo(user.id)).result).toContain('bookmarked "Lagos"');
    expect(await Bookmark.countDocuments({memory: lagos.id})).toBe(0);
    expect((await Memory.findById(lagos.id))?.tags).toEqual([
      'travel',
      'family',
    ]);

    expect((await undo(user.id)).result).toContain('tags');
    expect((await Memory.findById(lagos.id))?.tags).toEqual(['travel']);
  });

  it('brings a deleted story back, and removes a story it saved', async () => {
    const user = await createUserFixture();
    const old = await story(user.id, 'Grandma soup');

    await confirmed(user.id, 'delete_story', {query: 'Grandma'});
    expect((await Memory.findById(old.id))?.status).toBe('deleted');
    await undo(user.id);
    expect((await Memory.findById(old.id))?.status).toBe('save');

    await runVoiceServerTool(user.id, 'save_story', {
      title: 'Market day',
      body: 'We went to the market.',
    });
    const saved = await Memory.findOne({user: user.id, title: 'Market day'});
    expect(saved?.status).toBe('save');
    await undo(user.id);
    expect((await Memory.findById(saved!.id))?.status).toBe('deleted');
  });

  it('removes a drafted capsule and unschedules a scheduled one', async () => {
    const user = await createUserFixture();
    await Beneficiary.create({
      name: 'Emeka',
      email: 'emeka@example.com',
      relationship: 'brother',
      status: 'accepted',
      level: 1,
      benefactor: user.id,
    });

    await runVoiceServerTool(user.id, 'draft_capsule', {
      title: 'For Emeka',
      message: 'Proud of you.',
      recipient: 'Emeka',
    });
    expect(await Capsule.countDocuments({user: user.id})).toBe(1);

    const year = new Date().getFullYear() + 1;
    const scheduled = await confirmed(user.id, 'schedule_capsule', {
      capsule: 'Emeka',
      date: `${year}-06-01`,
    });
    expect(scheduled.result).toContain('Scheduled');
    expect((await Capsule.findOne({user: user.id}))?.status).toBe('scheduled');

    await undo(user.id);
    expect((await Capsule.findOne({user: user.id}))?.status).toBe('draft');

    await undo(user.id);
    expect(await Capsule.countDocuments({user: user.id})).toBe(0);
  });

  it('removes an added beneficiary and says the invite already went', async () => {
    const user = await createUserFixture();
    await confirmed(user.id, 'add_beneficiary', {
      name: 'Chidi',
      email: 'chidi@example.com',
      relationship: 'friend',
    });
    expect(await Beneficiary.countDocuments({benefactor: user.id})).toBe(1);

    const undone = await undo(user.id);
    expect(undone.result).toContain('chidi@example.com');
    expect(await Beneficiary.countDocuments({benefactor: user.id})).toBe(0);
  });

  it('leaves actions older than half an hour alone', async () => {
    const user = await createUserFixture();
    const lagos = await story(user.id, 'Lagos');
    await runVoiceServerTool(user.id, 'rename_story', {
      query: 'Lagos',
      title: 'Beach',
    });

    const later = await undoLastAction(user.id, {
      now: Date.now() + UNDO_WINDOW_MS + 60_000,
    });
    expect(later.result).toContain('nothing recent to undo');
    expect((await Memory.findById(lagos.id))?.title).toBe('Beach');
  });

  it('does not overwrite a title the host changed after Memento', async () => {
    const user = await createUserFixture();
    const lagos = await story(user.id, 'Lagos');
    await runVoiceServerTool(user.id, 'rename_story', {
      query: 'Lagos',
      title: 'Beach',
    });
    await Memory.updateOne({_id: lagos.id}, {$set: {title: 'Beach day 1998'}});

    const outcome = await undoLastAction(user.id);
    expect(outcome.result).toContain('changed again since');
    expect((await Memory.findById(lagos.id))?.title).toBe('Beach day 1998');
  });

  it('does not overwrite a nickname the host changed after Memento', async () => {
    const user = await createUserFixture();
    await User.updateOne({_id: user.id}, {$set: {nickname: 'A'}});
    await runVoiceServerTool(user.id, 'update_profile', {nickname: 'B'});
    await User.updateOne({_id: user.id}, {$set: {nickname: 'C'}});

    const outcome = await undoLastAction(user.id);
    expect(outcome.result).toContain('changed again since');
    expect((await User.findById(user.id).lean())?.nickname).toBe('C');
  });

  it('still undoes a profile change nobody touched since', async () => {
    const user = await createUserFixture();
    await User.updateOne({_id: user.id}, {$set: {nickname: 'A'}});
    await runVoiceServerTool(user.id, 'update_profile', {
      nickname: 'B',
      birthday: '1990-05-17',
    });

    const outcome = await undoLastAction(user.id);
    expect(outcome.result).toContain('Undone');
    expect((await User.findById(user.id).lean())?.nickname).toBe('A');
  });

  it('only undoes actions from the same call when the call is known', async () => {
    const user = await createUserFixture();
    const lagos = await story(user.id, 'Lagos');
    await runVoiceServerTool(
      user.id,
      'rename_story',
      {query: 'Lagos', title: 'Beach'},
      {callId: 'c1', sessionId: 'call-A'},
    );

    const fromOtherCall = await runVoiceServerTool(
      user.id,
      'undo_last_action',
      {},
      {callId: 'c2', sessionId: 'call-B'},
    );
    expect(fromOtherCall.result).toContain('nothing recent to undo');
    expect((await Memory.findById(lagos.id))?.title).toBe('Beach');

    const fromSameCall = await runVoiceServerTool(
      user.id,
      'undo_last_action',
      {},
      {callId: 'c3', sessionId: 'call-A'},
    );
    expect(fromSameCall.result).toContain('Undone');
    expect((await Memory.findById(lagos.id))?.title).toBe('Lagos');
  });

  it("never undoes another host's action", async () => {
    const user = await createUserFixture();
    const other = await createUserFixture();
    const theirs = await story(other.id, 'Lagos');
    await runVoiceServerTool(other.id, 'rename_story', {
      query: 'Lagos',
      title: 'Beach',
    });

    expect((await undo(user.id)).result).toContain('nothing recent to undo');
    expect((await Memory.findById(theirs.id))?.title).toBe('Beach');
  });

  it('runs a repeated call id once and returns the first result', async () => {
    const user = await createUserFixture();
    const lagos = await story(user.id, 'Lagos');

    const first = await runVoiceServerTool(
      user.id,
      'rename_story',
      {query: 'Lagos', title: 'Beach'},
      {callId: 'call-1'},
    );
    // Gemini resends the same call after a reconnect.
    const again = await runVoiceServerTool(
      user.id,
      'rename_story',
      {query: 'Lagos', title: 'Beach'},
      {callId: 'call-1'},
    );

    expect(again).toEqual(first);
    expect(first.result).toContain('Renamed "Lagos" to "Beach"');
    expect(await VoiceAction.countDocuments({user: user.id})).toBe(1);
    expect((await Memory.findById(lagos.id))?.title).toBe('Beach');
  });

  it('never hands one tool the result of another with the same call id', async () => {
    const user = await createUserFixture();
    const lagos = await story(user.id, 'Lagos');
    await runVoiceServerTool(
      user.id,
      'rename_story',
      {query: 'Lagos', title: 'Beach'},
      {callId: 'call-1'},
    );

    const other = await runVoiceServerTool(
      user.id,
      'bookmark_story',
      {query: 'Beach', on: true},
      {callId: 'call-1'},
    );
    expect(other.result).toContain('bookmark_story did not run');
    expect(other.effects).toEqual([]);
    expect((await Memory.findById(lagos.id))?.title).toBe('Beach');
  });

  it('runs simultaneous repeats once', async () => {
    const user = await createUserFixture();
    await story(user.id, 'Lagos');

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        runVoiceServerTool(
          user.id,
          'save_story',
          {title: 'Market', body: 'We went to the market.'},
          {callId: 'call-save'},
        ),
      ),
    );

    expect(await Memory.countDocuments({user: user.id, title: 'Market'})).toBe(
      1,
    );
    expect(new Set(results.map(result => result.result)).size).toBe(1);
  });

  it('does not undo twice when the undo call itself is repeated', async () => {
    const user = await createUserFixture();
    const lagos = await story(user.id, 'Lagos');
    await runVoiceServerTool(user.id, 'rename_story', {
      query: 'Lagos',
      title: 'Beach',
    });
    await runVoiceServerTool(user.id, 'rename_story', {
      query: 'Beach',
      title: 'Coast',
    });

    await runVoiceServerTool(user.id, 'undo_last_action', {}, {callId: 'u1'});
    await runVoiceServerTool(user.id, 'undo_last_action', {}, {callId: 'u1'});

    expect((await Memory.findById(lagos.id))?.title).toBe('Beach');
  });

  it('frees a call id when the tool throws, so a retry can run', async () => {
    const user = await createUserFixture();
    await expect(
      runVoiceServerTool(user.id, 'nope', {}, {callId: 'c'}),
    ).rejects.toThrow('Unknown voice tool');
    expect(await VoiceAction.countDocuments({user: user.id})).toBe(0);
  });

  it('logs only actions, not lookups or read-backs', async () => {
    const user = await createUserFixture();
    await story(user.id, 'Lagos');
    await runVoiceServerTool(user.id, 'open_story', {query: 'Lagos'});
    await runVoiceServerTool(user.id, 'delete_story', {query: 'Lagos'});

    expect(await VoiceAction.countDocuments({user: user.id})).toBe(0);
  });
});

describe('voice tool errors', () => {
  it('explains plan limits without the raw message or an upgrade offer', () => {
    const {result} = failed(new ServiceError('feature_locked:abc', 402));
    expect(result).toContain('Memento Pro');
    expect(result).toContain('never offer to upgrade');
    expect(result).not.toContain('feature_locked');
  });

  it('says storage is full', () => {
    const error = new ServiceError(
      'quota',
      413,
      null,
      'failed',
      undefined,
      'storage_quota_exceeded',
    );
    expect(failed(error).result).toContain('storage is full');
  });

  it('keeps unexpected errors out of what Memento says', () => {
    const {result} = failed(new Error('E11000 duplicate key in users'));
    expect(result).not.toContain('E11000');
    expect(result).toContain("Memento's side");
  });

  it('passes a plain validation message through', () => {
    const {result} = failed(new ServiceError('Title is too long', 400));
    expect(result).toContain('Title is too long');
  });
});
