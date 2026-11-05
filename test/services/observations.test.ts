import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import request from 'supertest';
import {createTestApp} from '../helpers/app';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';
import Memory from '../../src/module/database/model/memory';
import PendingInsight from '../../src/module/database/model/pending-insight';
import Persona from '../../src/module/database/model/persona';
import {filterForgottenInsights} from '../../src/workers/insight/forgotten';

async function member() {
  const user = await createUserFixture();
  return {
    userId: user.id as string,
    auth: {Authorization: `Bearer ${issueLegacyAccessToken(user)}`},
  };
}

async function memory(userId: string, title: string, status = 'save') {
  return Memory.create({
    user: userId,
    type: 'story',
    status,
    title,
    body: 'Body',
  });
}

function pending(
  userId: string,
  memoryId: unknown,
  content: string,
  field = 'important_notes',
) {
  return PendingInsight.create({
    user: userId,
    memory: String(memoryId),
    source: 'story',
    field,
    content,
  });
}

async function list(auth: Record<string, string>) {
  const response = await request(createTestApp())
    .get('/persona/observations')
    .set(auth)
    .expect(200);
  return response.body.data.observations as {
    id: string;
    field: string;
    content: string;
    reviewed: boolean;
    source_count: number;
  }[];
}

describe('persona observations', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('requires authentication', async () => {
    await request(createTestApp()).get('/persona/observations').expect(401);
  });

  it('merges saved and unreviewed observations by wording', async () => {
    const {userId, auth} = await member();
    const first = await memory(userId, 'First');
    const second = await memory(userId, 'Second');
    await Persona.create({
      user: userId,
      important_notes: ['You grew up in Lagos'],
    });
    await pending(userId, first._id, 'You grew up in Lagos.');
    await pending(userId, first._id, 'You have two sisters');
    await pending(userId, second._id, 'you have two sisters.');
    await pending(userId, second._id, 'You love tea', 'key_preferences');

    const observations = await list(auth);

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: 'You grew up in Lagos',
          reviewed: true,
          source_count: 1,
        }),
        expect.objectContaining({reviewed: false, source_count: 2}),
        expect.objectContaining({
          field: 'key_preferences',
          content: 'You love tea',
        }),
      ]),
    );
    expect(observations).toHaveLength(3);
  });

  it('hides an unreviewed observation once its memory is deleted', async () => {
    const {userId, auth} = await member();
    const gone = await memory(userId, 'Gone', 'deleted');
    await pending(userId, gone._id, 'You once lived in Accra');

    expect(await list(auth)).toEqual([]);
  });

  it('lists the sources of an observation', async () => {
    const {userId, auth} = await member();
    const first = await memory(userId, 'First');
    const second = await memory(userId, 'Second');
    const gone = await memory(userId, 'Gone', 'deleted');
    await pending(userId, first._id, 'You have two sisters');
    await pending(userId, second._id, 'You have two sisters.');
    await pending(userId, gone._id, 'You have two sisters');
    const [observation] = await list(auth);

    const response = await request(createTestApp())
      .get(`/persona/observations/${observation.id}/sources`)
      .set(auth)
      .expect(200);

    expect(
      response.body.data.sources.map((source: {title: string}) => source.title),
    ).toEqual(expect.arrayContaining(['First', 'Second']));
    expect(response.body.data.sources).toHaveLength(2);
  });

  it('edits saved and unreviewed records together', async () => {
    const {userId, auth} = await member();
    const source = await memory(userId, 'Source');
    await Persona.create({
      user: userId,
      important_notes: ['You have two sisters', 'Unrelated'],
      memory_insights_summary: 'stale',
    });
    await pending(userId, source._id, 'You have two sisters');
    const target = (await list(auth)).find(item =>
      item.content.includes('sisters'),
    )!;

    const response = await request(createTestApp())
      .patch(`/persona/observations/${target.id}`)
      .set(auth)
      .send({content: 'You have three sisters'})
      .expect(200);

    expect(response.body.data.content).toBe('You have three sisters');
    const persona = await Persona.findOne({user: userId}).lean();
    expect(persona!.important_notes).toEqual([
      'You have three sisters',
      'Unrelated',
    ]);
    expect(persona!.memory_insights_summary).toBeUndefined();
    const row = await PendingInsight.findOne({user: userId}).lean();
    expect(row!.content).toBe('You have three sisters');
  });

  it('forgets every record of an observation and keeps its memories', async () => {
    const {userId, auth} = await member();
    const source = await memory(userId, 'Source');
    await Persona.create({
      user: userId,
      important_notes: ['You have two sisters', 'Unrelated'],
    });
    await pending(userId, source._id, 'You have two sisters.');
    const target = (await list(auth)).find(item =>
      item.content.includes('sisters'),
    )!;

    await request(createTestApp())
      .delete(`/persona/observations/${target.id}`)
      .set(auth)
      .expect(200);

    expect((await list(auth)).map(item => item.content)).toEqual(['Unrelated']);
    expect(await Memory.countDocuments({user: userId})).toBe(1);
  });

  it('does not bring back what was forgotten when it is extracted again', async () => {
    const {userId, auth} = await member();
    const source = await memory(userId, 'Source');
    await pending(userId, source._id, 'You have two sisters');
    const [target] = await list(auth);
    await request(createTestApp())
      .delete(`/persona/observations/${target.id}`)
      .set(auth)
      .expect(200);

    const filtered = await filterForgottenInsights(userId, {
      important_notes: ['You have two sisters.', 'You love sailing'],
    });

    expect(filtered.important_notes).toEqual(['You love sailing']);
  });

  it('lets a member restore wording they forgot by choosing it again', async () => {
    const {userId, auth} = await member();
    await Persona.create({
      user: userId,
      important_notes: ['Wording A', 'Wording B'],
    });
    const items = await list(auth);
    const [a, b] = items;
    await request(createTestApp())
      .delete(`/persona/observations/${a.id}`)
      .set(auth)
      .expect(200);
    await request(createTestApp())
      .patch(`/persona/observations/${b.id}`)
      .set(auth)
      .send({content: 'Wording A'})
      .expect(200);

    const filtered = await filterForgottenInsights(userId, {
      important_notes: ['Wording A', 'Wording B'],
    });

    expect(filtered.important_notes).toEqual(['Wording A']);
  });

  it.each([
    ['patch', {content: 'Anything'}],
    ['delete', undefined],
  ] as const)('keeps %s scoped to the member', async (method, body) => {
    const owner = await member();
    const other = await member();
    await Persona.create({user: owner.userId, important_notes: ['Private']});
    const [target] = await list(owner.auth);

    await request(createTestApp())
      [method](`/persona/observations/${target.id}`)
      .set(other.auth)
      .send(body)
      .expect(404);

    expect((await list(owner.auth))[0].content).toBe('Private');
  });

  it.each([
    [
      'an empty edit',
      'patch',
      'important_notes-' + 'a'.repeat(24),
      {content: '   '},
    ],
    [
      'an overlong edit',
      'patch',
      'important_notes-' + 'a'.repeat(24),
      {content: 'x'.repeat(501)},
    ],
    ['a malformed id', 'delete', 'not-an-id', undefined],
    [
      'an unknown field',
      'delete',
      'social_accounts-' + 'a'.repeat(24),
      undefined,
    ],
  ] as const)('rejects %s', async (_name, method, id, body) => {
    const {auth} = await member();
    await request(createTestApp())
      [method](`/persona/observations/${id}`)
      .set(auth)
      .send(body)
      .expect(422);
  });
});
