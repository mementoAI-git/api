import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/module/api/memory/service', () => ({
  createMemory: vi.fn(async () => ({data: {_id: '64b7f0c2a1b2c3d4e5f60718'}})),
  quickCaptureMemory: vi.fn(async () => ({data: {}})),
  updateMemory: vi.fn(async () => ({data: {}})),
  deleteMemory: vi.fn(async () => ({data: {}})),
  bookmark: vi.fn(async () => ({data: {}})),
  unbookmark: vi.fn(async () => ({data: {}})),
}));
vi.mock('../../src/module/api/capsule/service', () => ({
  createCapsule: vi.fn(async () => ({data: {}})),
  updateCapsule: vi.fn(async () => ({data: {}})),
  scheduleCapsule: vi.fn(async () => ({data: {}})),
}));
vi.mock('../../src/module/api/beneficiary/service', () => ({
  create: vi.fn(async () => ({data: {}})),
}));
vi.mock('../../src/module/api/feedback/service', () => ({
  createFeedback: vi.fn(async () => ({data: {}})),
}));

import * as beneficiaryService from '../../src/module/api/beneficiary/service';
import * as capsuleService from '../../src/module/api/capsule/service';
import * as feedbackService from '../../src/module/api/feedback/service';
import * as memoryService from '../../src/module/api/memory/service';
import Beneficiary from '../../src/module/database/model/beneficiary';
import Capsule from '../../src/module/database/model/capsule';
import Memory from '../../src/module/database/model/memory';
import {SERVER_TOOL_DECLARATIONS} from '../../src/module/api/ai/voice/server-tool-declarations';
import {runVoiceServerTool} from '../../src/module/api/ai/voice/server-tools';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

/** The code from a "Nothing has happened yet" read-back. */
function codeIn(result: string): string {
  const match = result.match(/confirmation "([A-Z2-7]{8})"/);
  if (!match) throw new Error(`No confirmation code in: ${result}`);
  return match[1];
}

async function story(
  userId: string,
  title: string,
  extra: Record<string, unknown> = {},
) {
  return Memory.create({
    user: userId,
    type: 'story',
    status: 'save',
    title,
    ...extra,
  });
}

describe('voice content actions', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.clearAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('declares every action it can run, and nothing it cannot', async () => {
    const user = await createUserFixture();
    for (const declaration of SERVER_TOOL_DECLARATIONS) {
      await expect(
        runVoiceServerTool(user.id, declaration.name as string, {}),
      ).resolves.toHaveProperty('result');
    }
    const names = SERVER_TOOL_DECLARATIONS.map(d => d.name);
    for (const never of [
      'delete_account',
      'change_password',
      'cancel_subscription',
      'change_email',
    ]) {
      expect(names).not.toContain(never);
    }
  });

  describe('done straight away', () => {
    it('saves a story in the host words and opens it', async () => {
      const user = await createUserFixture();

      const outcome = await runVoiceServerTool(user.id, 'save_story', {
        title: "Grandma's kitchen",
        body: 'The smell of pepper soup on Sundays.',
      });

      expect(memoryService.createMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Grandma's kitchen",
          body: 'The smell of pepper soup on Sundays.',
          status: 'save',
        }),
        user.id,
      );
      expect(outcome.effects).toContainEqual({
        type: 'open_story',
        id: '64b7f0c2a1b2c3d4e5f60718',
      });
    });

    it('does not save an empty story', async () => {
      const user = await createUserFixture();
      await runVoiceServerTool(user.id, 'save_story', {title: 'Empty'});
      expect(memoryService.createMemory).not.toHaveBeenCalled();
    });

    it('saves a quick note', async () => {
      const user = await createUserFixture();
      await runVoiceServerTool(user.id, 'quick_note', {
        text: 'Call Emeka on Friday',
      });
      expect(memoryService.quickCaptureMemory).toHaveBeenCalledWith(
        {body: 'Call Emeka on Friday'},
        user.id,
      );
    });

    it("bookmarks and unbookmarks the host's matching story", async () => {
      const user = await createUserFixture();
      const lagos = await story(user.id, 'Trip to Lagos');

      await runVoiceServerTool(user.id, 'bookmark_story', {query: 'Lagos'});
      await runVoiceServerTool(user.id, 'bookmark_story', {
        query: 'Lagos',
        bookmarked: false,
      });

      expect(memoryService.bookmark).toHaveBeenCalledWith(
        String(lagos._id),
        user.id,
      );
      expect(memoryService.unbookmark).toHaveBeenCalledWith(
        String(lagos._id),
        user.id,
      );
    });

    it('adds and removes tags, keeping the others', async () => {
      const user = await createUserFixture();
      const lagos = await story(user.id, 'Trip to Lagos', {
        tags: ['travel', 'family'],
      });

      await runVoiceServerTool(user.id, 'tag_story', {
        query: 'Lagos',
        add: ['Beach'],
        remove: ['family'],
      });

      expect(memoryService.updateMemory).toHaveBeenCalledWith(
        String(lagos._id),
        {tags: ['travel', 'beach']},
        user.id,
      );
    });

    it('renames a story', async () => {
      const user = await createUserFixture();
      const lagos = await story(user.id, 'Trip to Lagos');

      const outcome = await runVoiceServerTool(user.id, 'rename_story', {
        query: 'Lagos',
        title: 'Lagos, 2019',
      });

      expect(memoryService.updateMemory).toHaveBeenCalledWith(
        String(lagos._id),
        {title: 'Lagos, 2019'},
        user.id,
      );
      expect(outcome.result).toContain('Offer to change it back');
    });

    it("never touches another user's story", async () => {
      const user = await createUserFixture();
      const other = await createUserFixture();
      await story(other.id, 'Trip to Lagos');

      const outcome = await runVoiceServerTool(user.id, 'rename_story', {
        query: 'Lagos',
        title: 'Mine now',
      });

      expect(memoryService.updateMemory).not.toHaveBeenCalled();
      expect(outcome.result).toMatch(/No story matched/);
    });

    it('drafts a capsule for a beneficiary by name, without scheduling it', async () => {
      const user = await createUserFixture();
      const ada = await Beneficiary.create({
        benefactor: user.id,
        name: 'Ada',
        email: 'ada@example.com',
      });

      const outcome = await runVoiceServerTool(user.id, 'draft_capsule', {
        title: 'For Ada at 18',
        message: 'I am so proud of you.',
        recipient: 'ada',
      });

      expect(capsuleService.createCapsule).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'draft',
          recipients: [
            {
              beneficiary_id: String(ada._id),
              email: 'ada@example.com',
              display_name: 'Ada',
            },
          ],
        }),
        user.id,
      );
      expect(capsuleService.scheduleCapsule).not.toHaveBeenCalled();
      expect(outcome.result).toMatch(/draft and not scheduled/);
    });

    it('asks who a capsule is for when the name is not a beneficiary', async () => {
      const user = await createUserFixture();
      const outcome = await runVoiceServerTool(user.id, 'draft_capsule', {
        title: 'Hi',
        message: 'Hello',
        recipient: 'Zed',
      });
      expect(capsuleService.createCapsule).not.toHaveBeenCalled();
      expect(outcome.result).toMatch(/not one of their beneficiaries/);
    });

    it('says plainly when a service refuses', async () => {
      const user = await createUserFixture();
      vi.mocked(memoryService.quickCaptureMemory).mockRejectedValueOnce(
        new Error('Storage is full'),
      );

      const outcome = await runVoiceServerTool(user.id, 'quick_note', {
        text: 'x',
      });

      expect(outcome.result).toContain('That did not work: Storage is full');
    });
  });

  describe('confirmed first', () => {
    it('adds a beneficiary only after the host confirms the read-back', async () => {
      const user = await createUserFixture();
      const args = {
        name: 'Emeka',
        email: 'emeka@example.com',
        relationship: 'brother',
      };

      const first = await runVoiceServerTool(user.id, 'add_beneficiary', args);
      expect(first.result).toContain('Nothing has happened yet');
      expect(first.result).toContain(
        'emails an invitation to emeka@example.com',
      );
      expect(beneficiaryService.create).not.toHaveBeenCalled();

      const second = await runVoiceServerTool(user.id, 'add_beneficiary', {
        ...args,
        confirmation: codeIn(first.result),
      });
      expect(beneficiaryService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Emeka',
          email: 'emeka@example.com',
          relationship: 'brother',
        }),
        user.id,
      );
      expect(second.effects).toContainEqual({
        type: 'open',
        destination: 'beneficiaries',
      });
    });

    it('will not use a code for different details than were read back', async () => {
      const user = await createUserFixture();
      const first = await runVoiceServerTool(user.id, 'add_beneficiary', {
        name: 'Emeka',
        email: 'emeka@example.com',
      });

      const swapped = await runVoiceServerTool(user.id, 'add_beneficiary', {
        name: 'Emeka',
        email: 'attacker@example.com',
        confirmation: codeIn(first.result),
      });

      expect(beneficiaryService.create).not.toHaveBeenCalled();
      expect(swapped.result).toContain('Nothing has happened yet');
    });

    it('will not use a made-up code', async () => {
      const user = await createUserFixture();
      await runVoiceServerTool(user.id, 'send_feedback', {
        message: 'Love it',
        confirmation: 'AAAAAAAA',
      });
      expect(feedbackService.createFeedback).not.toHaveBeenCalled();
    });

    it('deletes a story only after confirmation, and only the one read back', async () => {
      const user = await createUserFixture();
      const lagos = await story(user.id, 'Trip to Lagos');

      const first = await runVoiceServerTool(user.id, 'delete_story', {
        query: 'Lagos',
      });
      expect(first.result).toContain('Delete the story "Trip to Lagos"');
      expect(memoryService.deleteMemory).not.toHaveBeenCalled();

      await runVoiceServerTool(user.id, 'delete_story', {
        query: 'Lagos',
        confirmation: codeIn(first.result),
      });
      expect(memoryService.deleteMemory).toHaveBeenCalledWith(
        {memory_id: String(lagos._id)},
        user.id,
      );
    });

    it('schedules a draft capsule for a future date after confirmation', async () => {
      const user = await createUserFixture();
      const capsule = await Capsule.create({
        user: user.id,
        title: 'For Ada at 18',
        status: 'draft',
      });
      const date = new Date(Date.now() + 400 * 24 * 60 * 60_000)
        .toISOString()
        .slice(0, 10);

      const first = await runVoiceServerTool(user.id, 'schedule_capsule', {
        capsule: 'Ada',
        date,
      });
      expect(capsuleService.scheduleCapsule).not.toHaveBeenCalled();

      await runVoiceServerTool(user.id, 'schedule_capsule', {
        capsule: 'Ada',
        date,
        confirmation: codeIn(first.result),
      });
      expect(capsuleService.updateCapsule).toHaveBeenCalledWith(
        String(capsule._id),
        {schedule_date: `${date}T09:00:00.000Z`},
        user.id,
      );
      expect(capsuleService.scheduleCapsule).toHaveBeenCalledWith(
        String(capsule._id),
        user.id,
      );
    });

    it('refuses a delivery date in the past, before asking anything', async () => {
      const user = await createUserFixture();
      await Capsule.create({user: user.id, title: 'For Ada', status: 'draft'});

      const outcome = await runVoiceServerTool(user.id, 'schedule_capsule', {
        capsule: 'Ada',
        date: '2020-01-01',
      });

      expect(outcome.result).toMatch(/future/);
      expect(outcome.result).not.toContain('confirmation');
    });

    it('sends feedback from the host account after confirmation', async () => {
      const user = await createUserFixture();
      const first = await runVoiceServerTool(user.id, 'send_feedback', {
        message: 'Voice mode is great',
      });
      await runVoiceServerTool(user.id, 'send_feedback', {
        message: 'Voice mode is great',
        confirmation: codeIn(first.result),
      });

      expect(feedbackService.createFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'General Feedback',
          email: user.email,
          message: 'Voice mode is great',
        }),
        user.id,
      );
    });
  });
});
