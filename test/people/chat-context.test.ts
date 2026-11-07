import {beforeAll, afterAll, afterEach, it, expect, vi} from 'vitest';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import Beneficiary from '../../src/module/database/model/beneficiary';
import * as settings from '../../src/module/api/people/settings';
import * as people from '../../src/module/api/people/service';
import * as talk from '../../src/module/api/people/talk';
vi.mock('../../src/module/api/memory/service', () => ({
  createMemory: async (payload: Record<string, unknown>, userId: string) => {
    const {default: Model} = await import(
      '../../src/module/database/model/memory'
    );
    return {data: await Model.create({...payload, user: userId})};
  },
}));
beforeAll(connectTestDatabase);
afterEach(clearTestDatabase);
afterAll(closeTestDatabase);
it('keeps a saved name private to the viewer without changing the owner profile', async () => {
  const a = await createUserFixture();
  const b = await createUserFixture({first_name: 'Sarah'});
  await Beneficiary.create({
    benefactor: a.id,
    user: b.id,
    email: b.email,
    status: 'accepted',
    access_scope: 'shared_only',
  });
  await settings.updateLabel(b.id, a.id, 'Friend', 'Dad');
  expect((await people.list(a.id)).connections[0].name).toBe('Dad');
  expect((await people.list(b.id)).connections[0].name).not.toBe('Dad');
  expect((await settings.getSettings(b.id, a.id)).display_name).toBe('Dad');
});
it('uses a different private transcript for each viewer and owner direction', () => {
  expect(talk.conversationId('sarah', 'wisdom')).not.toBe(
    talk.conversationId('wisdom', 'sarah'),
  );
  expect(talk.conversationId('sarah', 'wisdom')).not.toBe(
    talk.conversationId('sarah', 'other'),
  );
});

import * as activation from '../../src/module/api/people/activation';
import * as voice from '../../src/module/api/people/voice';
import Memory from '../../src/module/database/model/memory';
import Turn from '../../src/module/database/model/people-turn';
import Message from '../../src/module/database/model/message';
it('restricts voice to approved shared context and stores transcripts only for the viewer', async () => {
  const owner = await createUserFixture({first_name: 'Sarah'});
  const viewer = await createUserFixture();
  const stranger = await createUserFixture();
  const grant = await Beneficiary.create({
    benefactor: owner.id,
    user: viewer.id,
    email: viewer.email,
    status: 'accepted',
    access_scope: 'shared_only',
  });
  await activation.update(owner.id, {
    approved_context: 'I like music.',
    active: true,
  });
  const shared = await Memory.create({
    user: owner.id,
    type: 'story',
    title: 'Weekend in Lagos',
    body: 'We visited Lagos',
    status: 'save',
    beneficiaries: [grant.id],
  });
  await Memory.create({
    user: owner.id,
    type: 'story',
    title: 'Secret diary',
    body: 'Unrelated private information',
    status: 'save',
    visibility: 'private',
  });
  const session = await voice.prepare(owner.id, viewer.id);
  expect(session.systemInstruction).toContain('Weekend in Lagos');
  expect(session.systemInstruction).not.toContain('Secret diary');
  await expect(voice.prepare(owner.id, stranger.id)).rejects.toMatchObject({
    statusCode: 404,
  });
  const payload = {
    session_id: session.connectionSessionId,
    request_id: crypto.randomUUID(),
    messages: [
      {role: 'user' as const, text: 'Private question'},
      {role: 'ai' as const, text: 'Private response from Weekend in Lagos'},
    ],
  };
  await voice.record(owner.id, viewer.id, payload);
  await voice.record(owner.id, viewer.id, payload);
  expect(await Turn.countDocuments()).toBe(2);
  expect(
    (await talk.history(owner.id, viewer.id)).turns.map(turn => turn.text),
  ).toEqual(['Private question', 'Private response from Weekend in Lagos']);
  expect((await talk.history(viewer.id, owner.id)).turns).toEqual([]);
  expect(
    (await talk.history(owner.id, viewer.id)).turns.at(-1)?.citations,
  ).toEqual([{source_id: shared.id, title: 'Weekend in Lagos'}]);
  expect(await Message.countDocuments()).toBe(0);
  await shared.updateOne({$set: {beneficiaries: []}});
  await expect(
    voice.record(owner.id, viewer.id, {
      ...payload,
      request_id: crypto.randomUUID(),
    }),
  ).rejects.toMatchObject({statusCode: 403});
});

it('invalidates a voice grant when a prior reply depended on a source outside the latest thirty items', async () => {
  const owner = await createUserFixture();
  const viewer = await createUserFixture();
  const grant = await Beneficiary.create({
    benefactor: owner.id,
    user: viewer.id,
    email: viewer.email,
    status: 'accepted',
    access_scope: 'shared_only',
  });
  await activation.update(owner.id, {
    approved_context: 'Approved introduction',
    active: true,
  });
  const old = await Memory.create({
    user: owner.id,
    type: 'story',
    title: 'Older shared source',
    status: 'save',
    beneficiaries: [grant.id],
    created_at: new Date('2020-01-01'),
  });
  const state = await activation.get(owner.id);
  const user = await (
    await import('../../src/module/database/model/user')
  ).default
    .findById(owner.id)
    .select('+connection_memento');
  const source = (
    await people.space(owner.id, viewer.id, {
      page: 1,
      limit: 1,
      sourceId: old.id,
    })
  ).items[0];
  await Turn.create({
    _id: 'earlier-reply',
    conversation_id: talk.conversationId(owner.id, viewer.id),
    request_id: crypto.randomUUID(),
    role: 'ai',
    text: 'Older source fact',
    base_revision: user!.connection_memento.revision,
    context_source_ids: [old.id],
    context_versions: {[old.id]: source.source_revision},
    source_ids: [old.id],
  });
  await Memory.insertMany(
    Array.from({length: 31}, (_, i) => ({
      user: owner.id,
      type: 'story',
      title: `Newer ${i}`,
      status: 'save',
      beneficiaries: [grant.id],
    })),
  );
  const session = await voice.prepare(owner.id, viewer.id);
  expect(session.systemInstruction).toContain('Older source fact');
  await old.updateOne({$set: {beneficiaries: []}});
  await expect(
    voice.assertCurrent(owner.id, viewer.id, session.connectionSessionId),
  ).rejects.toMatchObject({statusCode: 403});
  expect(state.state).toBe('active');
});

it('supports shared-only voice and shares new viewer input without exposing AI replies or old private turns', async () => {
  const owner = await createUserFixture();
  const viewer = await createUserFixture();
  await Beneficiary.create({
    benefactor: owner.id,
    user: viewer.id,
    email: viewer.email,
    status: 'accepted',
    access_scope: 'shared_only',
  });
  await activation.update(owner.id, {
    approved_context: 'PRIVATE_INACTIVE_PROFILE',
    active: false,
  });
  await expect(voice.prepare(owner.id, viewer.id)).rejects.toMatchObject({
    statusCode: 403,
  });
  const session = await voice.prepare(owner.id, viewer.id, true, true);
  expect(session.systemInstruction).not.toContain('PRIVATE_INACTIVE_PROFILE');
  expect(session.systemInstruction).toContain(
    'listen, communicate, and ask open-ended questions',
  );
  expect(session.greetingInstruction).toContain('ask one open-ended question');
  const payload = {
    session_id: session.connectionSessionId,
    request_id: crypto.randomUUID(),
    messages: [
      {role: 'user' as const, text: 'I remember our walk by the sea.'},
      {role: 'ai' as const, text: 'A private AI reflection.'},
    ],
  };
  await voice.record(owner.id, viewer.id, payload);
  await voice.record(owner.id, viewer.id, payload);
  const shared = await people.space(viewer.id, owner.id, {page: 1, limit: 20});
  expect(shared.items).toHaveLength(1);
  expect(shared.items[0].body).toBe(payload.messages[0].text);
  expect(JSON.stringify(shared)).not.toContain('A private AI reflection.');
  expect((await talk.history(viewer.id, owner.id, true)).turns).toEqual([]);
  expect(
    (await talk.history(owner.id, viewer.id, true)).turns[0].shared_input_id,
  ).toBe(shared.items[0].source_id);
});
