import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';

import Memory from '../../src/module/database/model/memory';
import User from '../../src/module/database/model/user';
import {
  SERVER_TOOL_NAMES,
  UnknownVoiceToolError,
  runVoiceServerTool,
} from '../../src/module/api/ai/voice/server-tools';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('voice server tools', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  describe('update_profile', () => {
    it('changes the host profile and asks the app to refresh and show it', async () => {
      const user = await createUserFixture();

      const outcome = await runVoiceServerTool(user.id, 'update_profile', {
        nickname: 'Yo',
        country: 'Nigeria',
      });

      const saved = await User.findById(user.id).lean();
      expect(saved?.nickname).toBe('Yo');
      expect(saved?.country).toBe('Nigeria');
      expect(outcome.result).toMatch(/nickname.*Yo/i);
      // So "what was it before?" and "change it back" work.
      expect(outcome.result).toContain(
        `nickname from "${user.nickname}" to "Yo"`,
      );
      expect(outcome.effects).toEqual([
        {type: 'refresh', what: 'profile'},
        {type: 'open', destination: 'profile'},
      ]);
    });

    it('never changes fields voice may not touch, such as email or phone', async () => {
      const user = await createUserFixture({
        email: 'keep@example.com',
        phone_number: '+2348000000000',
      } as never);

      const outcome = await runVoiceServerTool(user.id, 'update_profile', {
        email: 'evil@example.com',
        phone_number: '+10000000000',
        password: 'x',
      });

      const saved = await User.findById(user.id).lean();
      expect(saved?.email).toBe('keep@example.com');
      expect(saved?.phone_number).toBe('+2348000000000');
      expect(outcome.result).toMatch(/nothing to change/i);
      expect(outcome.effects).toEqual([]);
    });

    it('rejects a birthday that is not a real date', async () => {
      const user = await createUserFixture();

      const outcome = await runVoiceServerTool(user.id, 'update_profile', {
        birthday: 'next tuesday',
      });

      expect(outcome.result).toMatch(/birthday/i);
      expect(outcome.effects).toEqual([]);
    });

    it('rejects a date that does not exist, such as 31 February', async () => {
      const user = await createUserFixture();
      const outcome = await runVoiceServerTool(user.id, 'update_profile', {
        birthday: '1990-02-31',
      });
      expect(outcome.effects).toEqual([]);
    });

    it('saves a birthday given as YYYY-MM-DD', async () => {
      const user = await createUserFixture();

      await runVoiceServerTool(user.id, 'update_profile', {
        birthday: '1990-04-12',
      });

      const saved = await User.findById(user.id).lean();
      expect(new Date(String(saved?.dob)).toISOString().slice(0, 10)).toBe(
        '1990-04-12',
      );
    });
  });

  describe('open_story', () => {
    it("opens the host's best-matching story", async () => {
      const user = await createUserFixture();
      const story = await Memory.create({
        user: user.id,
        type: 'story',
        status: 'save',
        title: 'Trip to Lagos',
      });
      await Memory.create({
        user: user.id,
        type: 'story',
        status: 'save',
        title: 'First day at work',
      });

      const outcome = await runVoiceServerTool(user.id, 'open_story', {
        query: 'Lagos trip',
      });

      expect(outcome.effects).toEqual([
        {type: 'open_story', id: String(story._id)},
      ]);
      expect(outcome.result).toContain('Trip to Lagos');
    });

    it("never opens another user's story, a draft or a deleted one", async () => {
      const user = await createUserFixture();
      const other = await createUserFixture();
      await Memory.create({
        user: other.id,
        type: 'story',
        status: 'save',
        title: 'Lagos',
      });
      await Memory.create({
        user: user.id,
        type: 'story',
        status: 'deleted',
        title: 'Lagos',
      });

      const outcome = await runVoiceServerTool(user.id, 'open_story', {
        query: 'Lagos',
      });

      expect(outcome.effects).toEqual([]);
      expect(outcome.result).toMatch(/no story/i);
    });
  });

  it('refuses tools it does not know', async () => {
    const user = await createUserFixture();
    await expect(
      runVoiceServerTool(user.id, 'delete_account', {}),
    ).rejects.toBeInstanceOf(UnknownVoiceToolError);
    expect(SERVER_TOOL_NAMES).not.toContain('delete_account');
  });
});

describe('read tools shared with chat', () => {
  it('offers voice the same read lookups as chat, in Gemini form', async () => {
    const {SERVER_TOOL_DECLARATIONS, SHARED_READ_TOOL_NAMES} = await import(
      '../../src/module/api/ai/voice/server-tool-declarations'
    );
    const names = SERVER_TOOL_DECLARATIONS.map(d => d.name);
    for (const name of SHARED_READ_TOOL_NAMES) expect(names).toContain(name);
    const list = SERVER_TOOL_DECLARATIONS.find(d => d.name === 'list_stories');
    expect(JSON.stringify(list?.parameters)).toContain('"OBJECT"');
    expect(
      SERVER_TOOL_DECLARATIONS.find(d => d.name === 'suggest_topics')
        ?.parameters,
    ).toBeUndefined();
  });

  it('never reads links aloud', async () => {
    const {forSpeech} = await import(
      '../../src/module/api/ai/voice/server-tools'
    );
    const text = forSpeech(
      'Story "Lagos" [link: /stories/64b7f0c2a1b2c3d4e5f60711] [share link: https://mymemento.io/post/64b7f0c2a1b2c3d4e5f60711]. Its share link works for anyone: https://mymemento.io/post/64b7f0c2a1b2c3d4e5f60711 . Give that link on its own line.',
    );
    expect(text).not.toMatch(/https?:|\/stories\//);
    expect(text).toContain("copy from the story's Share option");
    expect(text).toContain('Never read a link aloud.');
  });
});
