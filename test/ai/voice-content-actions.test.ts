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
vi.mock('../../src/module/api/persona/observations', () => ({
  findObservation: vi.fn(async () => ({kind: 'none', headings: []})),
  forgetObservation: vi.fn(async () => ({data: null})),
  getObservationSources: vi.fn(async () => ({data: {sources: []}})),
  updateObservation: vi.fn(
    async (
      _user: string,
      id: string,
      edit: {heading: string; note: string},
    ) => ({
      data: {id, field: 'values', ...edit},
    }),
  ),
}));

import * as beneficiaryService from '../../src/module/api/beneficiary/service';
import * as capsuleService from '../../src/module/api/capsule/service';
import * as feedbackService from '../../src/module/api/feedback/service';
import * as memoryService from '../../src/module/api/memory/service';
import * as observations from '../../src/module/api/persona/observations';
import Beneficiary from '../../src/module/database/model/beneficiary';
import Bookmark from '../../src/module/database/model/bookmarks';
import Capsule from '../../src/module/database/model/capsule';
import Group from '../../src/module/database/model/group';
import Memory from '../../src/module/database/model/memory';
import ObservationView from '../../src/module/database/model/observation-view';
import {SERVER_TOOL_DECLARATIONS} from '../../src/module/api/ai/voice/server-tool-declarations';
import {runVoiceServerTool} from '../../src/module/api/ai/voice/server-tools';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import {ServiceError} from '../../src/utils/service-error';

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

    it('saves photos sent with the message, even without words', async () => {
      const user = await createUserFixture();
      const photo = '64b7f0c2a1b2c3d4e5f60aaa';
      const outcome = await runVoiceServerTool(user.id, 'save_story', {
        attachments: [photo, 'not-an-id'],
      });
      expect(memoryService.createMemory).toHaveBeenCalledWith(
        expect.objectContaining({attachments: [photo], body: ''}),
        user.id,
      );
      expect(outcome.result).toContain('the photo or file they sent');
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
      // The service is mocked, so record the bookmark it would have made.
      await Bookmark.create({memory: String(lagos._id), user: user.id});
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
        new ServiceError(
          'Storage quota exceeded',
          413,
          null,
          'failed',
          undefined,
          'storage_quota_exceeded',
        ),
      );

      const outcome = await runVoiceServerTool(user.id, 'quick_note', {
        text: 'x',
      });

      expect(outcome.result).toContain(
        'That did not work: their Memento storage is full',
      );
    });
  });

  describe('observations', () => {
    const card = {
      kind: 'one' as const,
      id: '64b7f0c2a1b2c3d4e5f60799',
      heading: 'Loves early mornings',
      note: 'They do their best thinking before sunrise.',
    };

    it('explains where an observation came from, changing nothing', async () => {
      const user = await createUserFixture();
      vi.mocked(observations.findObservation).mockResolvedValueOnce(card);
      vi.mocked(observations.getObservationSources).mockResolvedValueOnce({
        message: '',
        data: {
          sources: [
            {
              id: 's1',
              title: 'Sunrise runs',
              type: 'story',
              created_at: '2026-03-02T10:00:00.000Z',
              thumbnail: null,
            },
            {
              id: 's2',
              title: 'Morning chat',
              type: 'conversation',
              created_at: null,
              thumbnail: null,
            },
          ],
        },
      });

      const outcome = await runVoiceServerTool(user.id, 'explain_observation', {
        query: 'early mornings',
      });

      expect(outcome.result).toContain(
        'the story "Sunrise runs" from March 2026',
      );
      expect(outcome.result).toContain('a conversation "Morning chat"');
      expect(outcome.effects).toEqual([]);
      expect(observations.updateObservation).not.toHaveBeenCalled();
    });

    it('says when an observation has no linked stories', async () => {
      const user = await createUserFixture();
      vi.mocked(observations.findObservation).mockResolvedValueOnce(card);
      const outcome = await runVoiceServerTool(user.id, 'explain_observation', {
        query: 'early mornings',
      });
      expect(outcome.result).toMatch(/not linked to a particular story/);
    });

    it('asks which one when the description is unsure', async () => {
      const user = await createUserFixture();
      vi.mocked(observations.findObservation).mockResolvedValueOnce({
        kind: 'unsure',
        headings: ['Loves early mornings', 'Early riser'],
      });
      const outcome = await runVoiceServerTool(user.id, 'correct_observation', {
        query: 'early',
        note: 'Not any more.',
      });
      expect(outcome.result).toContain('Nothing was changed.');
      expect(outcome.result).toContain('"Early riser"');
      expect(observations.updateObservation).not.toHaveBeenCalled();
    });

    it('opens one observation, falling back to Insights for older apps', async () => {
      const user = await createUserFixture();
      vi.mocked(observations.findObservation).mockResolvedValueOnce(card);
      const outcome = await runVoiceServerTool(user.id, 'open_insight', {
        query: 'early mornings',
      });
      expect(outcome.effects).toEqual([
        {type: 'open', destination: 'insights'},
        {type: 'open_insight', id: card.id},
      ]);
    });

    it('corrects an observation in the host words, keeping its heading, and undoes it', async () => {
      const user = await createUserFixture();
      await ObservationView.create({
        user: user.id,
        items: [
          {
            _id: card.id,
            field: 'values',
            heading: card.heading,
            note: card.note,
            category: 'personal_growth',
          },
        ],
      });
      vi.mocked(observations.findObservation).mockResolvedValueOnce(card);

      const outcome = await runVoiceServerTool(user.id, 'correct_observation', {
        query: 'early mornings',
        note: 'I prefer late nights now.',
      });

      expect(observations.updateObservation).toHaveBeenCalledWith(
        user.id,
        card.id,
        {heading: card.heading, note: 'I prefer late nights now.'},
      );
      expect(outcome.effects).toEqual([
        {type: 'refresh', what: 'observations'},
      ]);

      // The mocked service did not change the card, so record what it would have.
      await ObservationView.updateOne(
        {user: user.id, 'items._id': card.id},
        {$set: {'items.$.note': 'I prefer late nights now.'}},
      );
      const undone = await runVoiceServerTool(user.id, 'undo_last_action', {});
      expect(undone.result).toMatch(/^Undone/);
      expect(observations.updateObservation).toHaveBeenLastCalledWith(
        user.id,
        card.id,
        {heading: card.heading, note: card.note},
      );
    });
  });

  describe('editing and sharing stories', () => {
    it('adds the host words to the end of an editor story as a paragraph', async () => {
      const user = await createUserFixture();
      const lagos = await story(user.id, 'Trip to Lagos', {
        body: '<p>We landed at night.</p>',
      });

      const outcome = await runVoiceServerTool(user.id, 'edit_story', {
        query: 'Lagos',
        text: 'The air smelled of rain & suya.',
      });

      expect(memoryService.updateMemory).toHaveBeenCalledWith(
        String(lagos._id),
        {
          body: '<p>We landed at night.</p><p>The air smelled of rain &amp; suya.</p>',
        },
        user.id,
      );
      expect(outcome.result).not.toContain('Nothing has happened yet');
      expect(outcome.effects).toContainEqual({
        type: 'open_story',
        id: String(lagos._id),
      });
    });

    it('adds to a plain-text story as plain text', async () => {
      const user = await createUserFixture();
      const lagos = await story(user.id, 'Trip to Lagos', {body: 'We landed.'});
      await runVoiceServerTool(user.id, 'edit_story', {
        query: 'Lagos',
        text: 'Then we slept.',
        mode: 'append',
      });
      expect(memoryService.updateMemory).toHaveBeenCalledWith(
        String(lagos._id),
        {body: 'We landed.\n\nThen we slept.'},
        user.id,
      );
    });

    it('replaces the whole text only after confirmation', async () => {
      const user = await createUserFixture();
      const lagos = await story(user.id, 'Trip to Lagos', {
        body: '<p>We landd at nite.</p>',
      });
      const args = {
        query: 'Lagos',
        text: 'We landed at night.',
        mode: 'replace',
      };

      const first = await runVoiceServerTool(user.id, 'edit_story', args);
      expect(first.result).toContain(
        'Replace all the words of "Trip to Lagos"',
      );
      expect(memoryService.updateMemory).not.toHaveBeenCalled();

      await runVoiceServerTool(user.id, 'edit_story', {
        ...args,
        confirmation: codeIn(first.result),
      });
      expect(memoryService.updateMemory).toHaveBeenCalledWith(
        String(lagos._id),
        {body: '<p>We landed at night.</p>'},
        user.id,
      );
    });

    it('shares with a beneficiary and a group by name after confirmation, never publicly', async () => {
      const user = await createUserFixture();
      const lagos = await story(user.id, 'Trip to Lagos');
      const ada = await Beneficiary.create({
        benefactor: user.id,
        name: 'Ada',
        email: 'ada@example.com',
      });
      const family = await Group.create({user: user.id, name: 'Family'});
      const args = {query: 'Lagos', with: ['ada', 'family']};

      const first = await runVoiceServerTool(user.id, 'share_story', args);
      expect(first.result).toContain(
        'Share "Trip to Lagos" with Ada, the group Family',
      );
      expect(first.result).toContain('stays off public');
      expect(memoryService.updateMemory).not.toHaveBeenCalled();

      await runVoiceServerTool(user.id, 'share_story', {
        ...args,
        confirmation: codeIn(first.result),
      });
      expect(memoryService.updateMemory).toHaveBeenCalledWith(
        String(lagos._id),
        {
          groups: [String(family._id)],
          beneficiaries: [String(ada._id)],
          visibility: 'private',
        },
        user.id,
      );
    });

    it('warns that sharing a story visible to everyone narrows who sees it', async () => {
      const user = await createUserFixture();
      await story(user.id, 'Trip to Lagos', {visibility: 'everyone'});
      await Beneficiary.create({
        benefactor: user.id,
        name: 'Ada',
        email: 'ada@example.com',
      });
      const first = await runVoiceServerTool(user.id, 'share_story', {
        query: 'Lagos',
        with: ['Ada'],
      });
      expect(first.result).toContain('only the people it is shared with');
    });

    it('will not share with someone who is not a beneficiary or group', async () => {
      const user = await createUserFixture();
      await story(user.id, 'Trip to Lagos');
      const outcome = await runVoiceServerTool(user.id, 'share_story', {
        query: 'Lagos',
        with: ['Zed'],
      });
      expect(outcome.result).toContain('"Zed" is not one of their');
      expect(outcome.result).not.toContain('confirmation');
      expect(memoryService.updateMemory).not.toHaveBeenCalled();
    });

    it('makes a shared story private straight away', async () => {
      const user = await createUserFixture();
      const ada = await Beneficiary.create({
        benefactor: user.id,
        name: 'Ada',
        email: 'ada@example.com',
      });
      const lagos = await story(user.id, 'Trip to Lagos', {
        beneficiaries: [String(ada._id)],
      });

      const outcome = await runVoiceServerTool(
        user.id,
        'set_story_visibility',
        {
          query: 'Lagos',
          visibility: 'only_me',
        },
      );

      expect(memoryService.updateMemory).toHaveBeenCalledWith(
        String(lagos._id),
        {groups: [], beneficiaries: [], visibility: 'private'},
        user.id,
      );
      expect(outcome.result).toContain('It was shared only with Ada');
    });

    it('makes a story visible to everyone only after confirmation', async () => {
      const user = await createUserFixture();
      const lagos = await story(user.id, 'Trip to Lagos');
      const args = {query: 'Lagos', visibility: 'everyone'};

      const first = await runVoiceServerTool(
        user.id,
        'set_story_visibility',
        args,
      );
      expect(first.result).toContain('Nothing has happened yet');
      expect(memoryService.updateMemory).not.toHaveBeenCalled();

      await runVoiceServerTool(user.id, 'set_story_visibility', {
        ...args,
        confirmation: codeIn(first.result),
      });
      expect(memoryService.updateMemory).toHaveBeenCalledWith(
        String(lagos._id),
        {groups: [], beneficiaries: [], visibility: 'everyone'},
        user.id,
      );
    });

    it('says when a story is already private', async () => {
      const user = await createUserFixture();
      await story(user.id, 'Trip to Lagos');
      const outcome = await runVoiceServerTool(
        user.id,
        'set_story_visibility',
        {
          query: 'Lagos',
          visibility: 'only_me',
        },
      );
      expect(outcome.result).toContain('already private');
      expect(memoryService.updateMemory).not.toHaveBeenCalled();
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
