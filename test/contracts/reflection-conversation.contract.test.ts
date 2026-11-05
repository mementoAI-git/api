vi.mock('../../src/services/ai/critical-chat-stream', async original => ({
  ...(await original<
    typeof import('../../src/services/ai/critical-chat-stream')
  >()),
  streamCriticalChatResponse: vi.fn(async () => ({
    stream: (async function* () {
      yield {text: 'A thoughtful response.'};
    })(),
    modelLabel: 'test',
    recordUserMessageInDb: true,
  })),
}));
import {prompts} from '../../src/utils';
import {prompt as sendChatPrompt} from '../../src/module/api/ai/service';
import {streamCriticalChatResponse} from '../../src/services/ai/critical-chat-stream';
import request from 'supertest';
import {afterAll, afterEach, beforeAll, expect, it, vi} from 'vitest';
import User from '../../src/module/database/model/user';
import Memory from '../../src/module/database/model/memory';
import Bookmark from '../../src/module/database/model/bookmarks';
import Prompt from '../../src/module/database/model/prompt';
import ActivePrompt from '../../src/module/database/model/active-prompt';
import DailyAiPromptCache from '../../src/module/database/model/daily-ai-prompt-cache';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';
import {createTestApp} from '../helpers/app';
beforeAll(connectTestDatabase);
afterEach(async () => {
  vi.restoreAllMocks();
  await clearTestDatabase();
});
afterAll(closeTestDatabase);
const day = '2026-10-31';
it('opens and resumes a private draft thread for the assigned daily question', async () => {
  const user = await createUserFixture();
  const prompt = await Prompt.create({
    title: 'What made today memorable?',
    source: 'starter',
  });
  await ActivePrompt.create({user: user.id, prompt: prompt.id, day_key: day});
  const open = () =>
    request(createTestApp())
      .post('/prompts/reflection/conversation')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({
        prompt_type: 'static',
        prompt_id: prompt.id,
        reflection_day_key: day,
      });
  const [first, second] = await Promise.all([open(), open()]);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(first.body.data).toMatchObject({
    type: 'conversation',
    status: 'draft',
    visibility: 'private',
    prompt_text: prompt.title,
  });
  expect(second.body.data._id).toBe(first.body.data._id);
  expect(await Memory.countDocuments()).toBe(1);
  expect((await User.findById(user.id)).primary_conversation_id).toBeFalsy();
});
it('reopens a legacy response without losing or duplicating its answer', async () => {
  const user = await createUserFixture();
  const prompt = await Prompt.create({
    title: 'A happy memory?',
    source: 'starter',
  });
  await ActivePrompt.create({user: user.id, prompt: prompt.id, day_key: day});
  const memory = await Memory.create({
    user: user.id,
    prompt: prompt.id,
    prompt_type: 'static',
    prompt_text: prompt.title,
    reflection_day_key: day,
    body: '<p>My original answer.</p>',
    status: 'save',
  });
  const response = await request(createTestApp())
    .post('/prompts/reflection/conversation')
    .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
    .send({
      prompt_type: 'static',
      prompt_id: prompt.id,
      reflection_day_key: day,
    });
  expect(response.status).toBe(200);
  expect(response.body.data._id).toBe(memory.id);
  expect(response.body.data.body).toBe('<p>My original answer.</p>');
  expect(await Memory.countDocuments()).toBe(1);
});
it('uses only the signed-in user’s cached AI question', async () => {
  const user = await createUserFixture();
  await DailyAiPromptCache.create({
    user: user.id,
    date_key: day,
    prompt_text: 'What brought you joy?',
    expires_at: new Date(Date.now() + 86400000),
  });
  const open = (text: string) =>
    request(createTestApp())
      .post('/prompts/reflection/conversation')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({
        prompt_type: 'ai-generated',
        prompt_text: text,
        reflection_day_key: day,
      });
  expect((await open('A fabricated question?')).status).toBe(400);
  const response = await open('What brought you joy?');
  expect(response.status).toBe(200);
  expect(response.body.data.prompt_text).toBe('What brought you joy?');
});
it('requires authentication and rejects invalid dates', async () => {
  const app = createTestApp();
  expect(
    (await request(app).post('/prompts/reflection/conversation').send({}))
      .status,
  ).toBe(401);
  const user = await createUserFixture();
  expect(
    (
      await request(app)
        .post('/prompts/reflection/conversation')
        .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
        .send({
          prompt_type: 'ai-generated',
          reflection_day_key: '2026-99-99',
          prompt_text: 'Question?',
        })
    ).status,
  ).toBe(422);
});

it('saves an answer in Stories and the matching Explore category using the same thread', async () => {
  const user = await createUserFixture();
  const prompt = await Prompt.create({
    title: 'A childhood memory?',
    category: 'growing-up',
    source: 'starter',
    active: true,
  });
  await ActivePrompt.create({user: user.id, prompt: prompt.id, day_key: day});
  const app = createTestApp();
  const token = issueLegacyAccessToken(user);
  const open = await request(app)
    .post('/prompts/reflection/conversation')
    .set('Authorization', `Bearer ${token}`)
    .send({
      prompt_type: 'static',
      prompt_id: prompt.id,
      reflection_day_key: day,
    });
  const id = open.body.data._id;
  const category = () =>
    request(app)
      .get('/prompts/categories/growing-up?answered=true')
      .set('Authorization', `Bearer ${token}`);
  expect((await category()).body.data.docs).toHaveLength(0);
  vi.spyOn(prompts, 'createSystemContext').mockResolvedValue('Base context');
  const result = await sendChatPrompt(
    {memory: id, text: 'A joyful day.'},
    user.id,
  );
  await result.userMessageSaved;
  expect(
    vi.mocked(streamCriticalChatResponse).mock.calls.at(-1)?.[0]
      .systemInstruction,
  ).toContain(prompt.title);
  expect((await Memory.findById(id))?.status).toBe('save');
  expect((await Memory.findById(id))?.category).toBe('growing-up');
  expect(
    (await category()).body.data.docs.map((p: {_id: string}) => p._id),
  ).toContain(prompt.id);
  const fromExplore = await request(app)
    .get(`/memories/prompt/${prompt.id}`)
    .set('Authorization', `Bearer ${token}`);
  expect(fromExplore.body.data._id).toBe(id);
  const stories = await request(app)
    .get('/memories/stories')
    .set('Authorization', `Bearer ${token}`);
  expect(stories.body.data.docs.map((m: {_id: string}) => m._id)).toContain(id);
  expect(await Memory.countDocuments()).toBe(1);
});
it('keeps personalised answers in Stories without adding a topic category', async () => {
  const user = await createUserFixture();
  await DailyAiPromptCache.create({
    user: user.id,
    date_key: day,
    prompt_text: 'A moment to remember?',
    expires_at: new Date(Date.now() + 86400000),
  });
  const open = await request(createTestApp())
    .post('/prompts/reflection/conversation')
    .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
    .send({
      prompt_type: 'ai-generated',
      prompt_text: 'A moment to remember?',
      reflection_day_key: day,
    });
  vi.spyOn(prompts, 'createSystemContext').mockResolvedValue('Base context');
  const result = await sendChatPrompt(
    {memory: open.body.data._id, text: 'A joyful day.'},
    user.id,
  );
  await result.userMessageSaved;
  const memory = await Memory.findById(open.body.data._id);
  expect(memory?.status).toBe('save');
  expect(memory?.category).toBeFalsy();
  expect(memory?.prompt).toBeFalsy();
  const stories = await request(createTestApp())
    .get('/memories/stories')
    .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`);
  expect(stories.body.data.docs.map((m: {_id: string}) => m._id)).toContain(
    memory!.id,
  );
});
it('does not let another account access or send into a private reflection', async () => {
  const owner = await createUserFixture();
  const other = await createUserFixture();
  const memory = await Memory.create({
    user: owner.id,
    prompt_type: 'ai-generated',
    prompt_text: 'Private question?',
    visibility: 'private',
    status: 'save',
  });
  expect(
    (
      await request(createTestApp())
        .get(`/memories/${memory.id}`)
        .set('Authorization', `Bearer ${issueLegacyAccessToken(other)}`)
    ).status,
  ).toBe(404);
  await expect(
    sendChatPrompt({memory: memory.id, text: 'Hello'}, other.id),
  ).rejects.toThrow();
});

it('opens a shared starter fallback even when daily AI generation supplied no assigned first slot', async () => {
  const user = await createUserFixture();
  const prompt = await Prompt.create({
    title: 'What made you smile?',
    source: 'starter',
  });
  const response = await request(createTestApp())
    .post('/prompts/reflection/conversation')
    .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
    .send({
      prompt_type: 'static',
      prompt_id: prompt.id,
      reflection_day_key: day,
    });
  expect(response.status).toBe(200);
  expect(response.body.data.prompt).toBe(prompt.id);
});

it('lists and counts saved reflection threads in Stories with ownership and lifecycle filters', async () => {
  const user = await createUserFixture();
  const other = await createUserFixture();
  const saved = await Memory.create({
    user: user.id,
    type: 'conversation',
    prompt_type: 'ai-generated',
    status: 'save',
  });
  const deleted = await Memory.create({
    user: user.id,
    type: 'conversation',
    prompt_type: 'static',
    status: 'deleted',
    deleted_at: new Date(),
    delete_after: new Date(Date.now() + 86400000),
  });
  const story = await Memory.create({
    user: user.id,
    type: 'story',
    status: 'save',
  });
  await Memory.create([
    {user: user.id, type: 'conversation', status: 'save'},
    {
      user: user.id,
      type: 'conversation',
      prompt_type: 'ai-generated',
      status: 'draft',
    },
    {
      user: other.id,
      type: 'conversation',
      prompt_type: 'ai-generated',
      status: 'save',
    },
    {
      user: user.id,
      type: 'conversation',
      prompt_type: 'static',
      status: 'deleted',
      purge_requested_at: new Date(),
    },
  ]);
  await Bookmark.create({user: user.id, memory: saved.id});
  const get = (path: string) =>
    request(createTestApp())
      .get(path)
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`);
  const ids = (response: request.Response) =>
    response.body.data.docs.map((m: {_id: string}) => m._id).sort();
  expect(ids(await get('/memories/stories'))).toEqual(
    [saved.id, story.id].sort(),
  );
  expect(ids(await get('/memories/stories?bookmarked=true'))).toEqual([
    saved.id,
  ]);
  expect(ids(await get('/memories/stories?deleted=true'))).toEqual([
    deleted.id,
  ]);
  expect((await get('/memories/stats')).body.data).toMatchObject({
    stories_count: 2,
    stories_bookmarked_count: 1,
    stories_deleted_count: 1,
  });
});
