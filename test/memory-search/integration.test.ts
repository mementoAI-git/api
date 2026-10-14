import {Readable} from 'node:stream';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';
import {createTestApp} from '../helpers/app';
import Memory from '../../src/module/database/model/memory';
import File from '../../src/module/database/model/file';
import Message from '../../src/module/database/model/message';
import {indexMemory} from '../../src/services/memory-search/indexing';
import {
  fingerprint,
  VECTOR_VERSION,
} from '../../src/services/memory-search/source';
import {embedInputs, embedQuery} from '../../src/services/memory-search/engine';
import {queueMemorySearch} from '../../src/services/queues/memory-search';
import {getFile} from '../../src/services/storage';
import {hasFreshIndex} from '../../src/services/memory-search/source';
import {loadSearchPhotos} from '../../src/services/memory-search/load';

const vector = [1, ...Array(767).fill(0)];
vi.mock('../../src/services/memory-search/engine', () => ({
  embedInputs: vi.fn(),
  embedQuery: vi.fn(),
}));
vi.mock('../../src/services/queues/memory-search', () => ({
  queueMemorySearch: vi.fn(async () => true),
}));
vi.mock('../../src/services/storage', async importOriginal => ({
  ...(await importOriginal<object>()),
  getFile: vi.fn(async () => ({
    Body: Readable.from([Buffer.from('not an image')]),
  })),
}));

describe('owner-only description search', () => {
  beforeAll(connectTestDatabase);
  afterAll(closeTestDatabase);
  afterEach(async () => {
    vi.unstubAllEnvs();
    await clearTestDatabase();
  });
  beforeEach(() => {
    vi.mocked(embedInputs).mockImplementation(async batches =>
      batches.map(batch => batch.inputs.map(() => vector)),
    );
    vi.mocked(embedQuery).mockResolvedValue(vector);
    vi.mocked(queueMemorySearch).mockResolvedValue(true);
  });

  async function setup() {
    const owner = await createUserFixture();
    vi.stubEnv('MEMORY_SEARCH_ENABLED', 'true');
    vi.stubEnv('MEMORY_SEARCH_USER_IDS', owner.id);
    vi.stubEnv('MEMORY_SEARCH_DIGUP_PATH', '/trial/digup');
    vi.stubEnv('MEMORY_SEARCH_MODELS_DIR', '/trial/models');
    const memory = await Memory.create({
      user: owner.id,
      title: 'Starting out',
      body: 'A tiny apartment above a bakery.',
      type: 'story',
      status: 'save',
    });
    const token = issueLegacyAccessToken(owner);
    return {owner, memory, token, app: createTestApp()};
  }

  it('retrieves a synonym match and returns the normal safe attachment contract', async () => {
    const {owner, memory, token, app} = await setup();
    expect(await indexMemory(owner.id, memory.id)).toBe(true);
    const result = await request(app)
      .get('/memories/search?q=our%20first%20home')
      .auth(token, {type: 'bearer'});
    expect(result.status).toBe(200);
    expect(result.body.data.docs.map((row: {_id: string}) => row._id)).toEqual([
      memory.id,
    ]);
    expect(result.body.data.search).toMatchObject({
      mode: 'hybrid',
      preparing: false,
    });
    expect(JSON.stringify(result.body)).not.toContain('search_index');
    expect(JSON.stringify(result.body)).not.toContain('vector');
  });

  it('prepares story text without reading photos and invalidates it when photos are reenabled', async () => {
    const {owner, memory} = await setup();
    const file = await File.create({
      user: owner.id,
      name: 'private.jpg',
      type: 'image/jpeg',
      size: 200,
      provider: 's3',
      status: 'ready',
    });
    await memory.updateOne({attachments: [file.id]});
    await expect(indexMemory(owner.id, memory.id)).rejects.toThrow();
    vi.mocked(getFile).mockClear();
    vi.stubEnv('MEMORY_SEARCH_PHOTOS_ENABLED', 'false');
    expect(await indexMemory(owner.id, memory.id)).toBe(true);
    expect(getFile).not.toHaveBeenCalled();
    const current = await Memory.findById(memory.id)
      .select('+search_index')
      .lean();
    const files = await loadSearchPhotos(owner.id, [current]);
    expect(
      current.search_index.chunks.every(chunk => chunk.kind === 'story'),
    ).toBe(true);
    expect(hasFreshIndex(current, files)).toBe(true);
    vi.stubEnv('MEMORY_SEARCH_PHOTOS_ENABLED', 'true');
    expect(hasFreshIndex(current, files)).toBe(false);
  });

  it('searches saved chat messages by meaning and invalidates changed or deleted messages', async () => {
    const {owner, memory, token, app} = await setup();
    await memory.updateOne({
      type: 'conversation',
      title: 'An afternoon conversation',
      body: '',
    });
    const message = await Message.create({
      user: owner.id,
      memory: memory.id,
      role: 'user',
      text: 'We rented a tiny apartment above a bakery.',
    });
    expect(await indexMemory(owner.id, memory.id)).toBe(true);
    let response = await request(app)
      .get('/memories/search?q=our%20first%20home')
      .auth(token, {type: 'bearer'});
    expect(
      response.body.data.docs.map((doc: {_id: string}) => doc._id),
    ).toEqual([memory.id]);
    expect(JSON.stringify(response.body)).not.toContain('chat_source');
    await message.updateOne({text: 'A different experience'});
    response = await request(app)
      .get('/memories/search?q=our%20first%20home')
      .auth(token, {type: 'bearer'});
    expect(response.body.data.docs).toEqual([]);
    expect(response.body.data.search.preparing).toBe(true);
    await indexMemory(owner.id, memory.id);
    await message.deleteOne();
    response = await request(app)
      .get('/memories/search?q=our%20first%20home')
      .auth(token, {type: 'bearer'});
    expect(response.body.data.docs).toEqual([]);
  });

  it('finds words in owned chat messages without exposing other owners or deleted chats', async () => {
    const {owner, memory, token, app} = await setup();
    await memory.updateOne({
      type: 'conversation',
      title: 'A conversation',
      body: '',
    });
    const other = await createUserFixture();
    const hidden = await Memory.create({
      user: other.id,
      type: 'conversation',
      title: 'Hidden',
      status: 'save',
    });
    const deleted = await Memory.create({
      user: owner.id,
      type: 'conversation',
      title: 'Deleted',
      status: 'deleted',
    });
    await Message.insertMany([
      {
        user: owner.id,
        memory: memory.id,
        role: 'user',
        text: 'A visit to the observatory',
      },
      {user: other.id, memory: hidden.id, role: 'user', text: 'observatory'},
      {user: owner.id, memory: deleted.id, role: 'user', text: 'observatory'},
      {user: other.id, memory: memory.id, role: 'user', text: 'secretplanet'},
    ]);
    vi.stubEnv('MEMORY_SEARCH_ENABLED', 'false');
    let response = await request(app)
      .get('/memories/search?q=observatory')
      .auth(token, {type: 'bearer'});
    expect(
      response.body.data.docs.map((doc: {_id: string}) => doc._id),
    ).toEqual([memory.id]);
    response = await request(app)
      .get('/memories/search?q=secretplanet')
      .auth(token, {type: 'bearer'});
    expect(response.body.data.docs).toEqual([]);
  });

  it('rechecks chat content changed while the query model was running', async () => {
    const {owner, memory, token, app} = await setup();
    await memory.updateOne({
      type: 'conversation',
      title: 'A conversation',
      body: '',
    });
    const message = await Message.create({
      user: owner.id,
      memory: memory.id,
      role: 'user',
      text: 'Our tiny apartment above a bakery.',
    });
    await indexMemory(owner.id, memory.id);
    vi.mocked(embedQuery).mockImplementationOnce(async () => {
      await message.updateOne({text: 'A different experience'});
      return vector;
    });
    const response = await request(app)
      .get('/memories/search?q=our%20first%20home')
      .auth(token, {type: 'bearer'});
    expect(response.body.data.docs).toEqual([]);
  });

  it('keeps full-message word search when a chat exceeds preparation limits', async () => {
    const {owner, memory, token, app} = await setup();
    await memory.updateOne({
      type: 'conversation',
      title: 'A conversation',
      body: '',
    });
    await Message.create({
      user: owner.id,
      memory: memory.id,
      role: 'user',
      text: 'x'.repeat(8100) + ' observatory',
    });
    vi.mocked(embedQuery).mockClear();
    const response = await request(app)
      .get('/memories/search?q=observatory')
      .auth(token, {type: 'bearer'});
    expect(
      response.body.data.docs.map((doc: {_id: string}) => doc._id),
    ).toEqual([memory.id]);
    expect(response.body.data.search).toMatchObject({
      mode: 'keyword',
      limited: true,
    });
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it('does not let repeated matches or deleted chats hide another matching conversation', async () => {
    const {owner, memory, token, app} = await setup();
    await memory.updateOne({type: 'conversation', title: 'One chat', body: ''});
    const deleted = await Memory.create({
      user: owner.id,
      type: 'conversation',
      status: 'deleted',
      title: 'Deleted',
    });
    const another = await Memory.create({
      user: owner.id,
      type: 'conversation',
      status: 'save',
      title: 'Another chat',
    });
    await Message.insertMany([
      ...Array.from({length: 200}, () => ({
        user: owner.id,
        memory: deleted.id,
        role: 'user',
        text: 'observatory',
      })),
      ...Array.from({length: 200}, () => ({
        user: owner.id,
        memory: memory.id,
        role: 'user',
        text: 'observatory',
      })),
      {user: owner.id, memory: another.id, role: 'user', text: 'observatory'},
    ]);
    vi.stubEnv('MEMORY_SEARCH_ENABLED', 'false');
    const response = await request(app)
      .get('/memories/search?q=observatory')
      .auth(token, {type: 'bearer'});
    const ids = response.body.data.docs.map((doc: {_id: string}) => doc._id);
    expect(ids).toEqual(expect.arrayContaining([memory.id, another.id]));
    expect(ids).not.toContain(deleted.id);
  });

  it('never searches another owner, drafts, deleted memories or capsule text', async () => {
    const {owner, memory, token, app} = await setup();
    const other = await createUserFixture();
    for (const fields of [
      {user: other.id, status: 'save'},
      {user: owner.id, status: 'draft'},
      {user: owner.id, status: 'deleted'},
    ]) {
      const hidden = await Memory.create({
        ...fields,
        title: 'A home',
        body: 'private',
        type: 'story',
      });
      await hidden.updateOne({
        search_index: {
          fingerprint: fingerprint(hidden, []),
          version: VECTOR_VERSION,
          chunks: [{kind: 'story', vector}],
        },
      });
    }
    await indexMemory(owner.id, memory.id);
    const result = await request(app)
      .get(`/memories/search?q=home&user=${other.id}&status=draft`)
      .auth(token, {type: 'bearer'});
    expect(result.body.data.docs.map((row: {_id: string}) => row._id)).toEqual([
      memory.id,
    ]);
    expect(vi.mocked(embedQuery)).toHaveBeenCalledWith('home');
  });

  it('excludes edited source vectors immediately and schedules repair', async () => {
    const {owner, memory, token, app} = await setup();
    await indexMemory(owner.id, memory.id);
    await memory.updateOne({body: 'A different experience'});
    const result = await request(app)
      .get('/memories/search?q=our%20first%20home')
      .auth(token, {type: 'bearer'});
    expect(result.body.data.docs).toEqual([]);
    expect(result.body.data.search.preparing).toBe(true);
    expect(queueMemorySearch).toHaveBeenCalledWith(owner.id, memory.id);
  });

  it('preserves a confident collection match when rechecking the selected source', async () => {
    const {owner, memory, token, app} = await setup();
    const target = [0.7, Math.sqrt(0.51), ...Array(766).fill(0)];
    await memory.updateOne({
      search_index: {
        fingerprint: fingerprint(memory, []),
        version: VECTOR_VERSION,
        chunks: [{kind: 'story', vector: target}],
      },
    });
    for (let i = 0; i < 5; i++) {
      const other = await Memory.create({
        user: owner.id,
        title: `Other ${i}`,
        body: 'An unrelated event',
        status: 'save',
        type: 'story',
      });
      await other.updateOne({
        search_index: {
          fingerprint: fingerprint(other, []),
          version: VECTOR_VERSION,
          chunks: [{kind: 'story', vector: [0, 1, ...Array(766).fill(0)]}],
        },
      });
    }
    const response = await request(app)
      .get('/memories/search?q=our%20first%20home')
      .auth(token, {type: 'bearer'});
    expect(
      response.body.data.docs.map((row: {_id: string}) => row._id),
    ).toEqual([memory.id]);
  });

  it('hides deleted/replaced photos even if their old vectors are still stored', async () => {
    const {owner, memory, token, app} = await setup();
    const photo = await File.create({
      user: owner.id,
      name: 'photo.jpg',
      type: 'image/jpeg',
      size: 100,
      provider: 's3',
      status: 'ready',
    });
    memory.attachments = [photo.id];
    await memory.save();
    await memory.updateOne({
      search_index: {
        fingerprint: fingerprint(memory, [photo]),
        version: VECTOR_VERSION,
        chunks: [{kind: 'photo', file_id: photo.id, vector}],
      },
    });
    await photo.updateOne({deleted: true});
    const result = await request(app)
      .get('/memories/search?q=a%20cat')
      .auth(token, {type: 'bearer'});
    expect(result.body.data.docs).toEqual([]);
  });

  it('returns word matches when the model is down or the account is not in the pilot', async () => {
    const {owner, memory, token, app} = await setup();
    await indexMemory(owner.id, memory.id);
    vi.mocked(embedQuery).mockRejectedValue(new Error('Unavailable'));
    let result = await request(app)
      .get('/memories/search?q=bakery')
      .auth(token, {type: 'bearer'});
    expect(result.body.data.docs[0]._id).toBe(memory.id);
    expect(result.body.data.search.mode).toBe('keyword');
    vi.stubEnv('MEMORY_SEARCH_USER_IDS', 'someone-else');
    result = await request(app)
      .get('/memories/search?q=bakery')
      .auth(token, {type: 'bearer'});
    expect(result.body.data.docs[0]._id).toBe(memory.id);
    expect(result.body.data.search.mode).toBe('keyword');
  });

  it('does not persist embeddings if the story changes during preparation', async () => {
    const {owner, memory} = await setup();
    vi.mocked(embedInputs).mockImplementationOnce(async batches => {
      await Memory.updateOne(
        {_id: memory.id},
        {body: 'Changed while preparing'},
      );
      return batches.map(batch => batch.inputs.map(() => vector));
    });
    expect(await indexMemory(owner.id, memory.id)).toBe(false);
    expect(
      (await Memory.findById(memory.id).select('+search_index')).search_index,
    ).toBeUndefined();
  });

  it('rejects malformed queries and unauthenticated requests', async () => {
    const {token, app} = await setup();
    expect((await request(app).get('/memories/search?q=home')).status).toBe(
      401,
    );
    for (const q of ['', 'x'.repeat(201)]) {
      expect(
        (
          await request(app)
            .get('/memories/search')
            .query({q})
            .auth(token, {type: 'bearer'})
        ).status,
      ).toBe(422);
    }
    expect(
      (
        await request(app)
          .get('/memories/search?q[x]=home')
          .auth(token, {type: 'bearer'})
      ).status,
    ).toBe(422);
  });

  it('cools down an unindexable source and retries after its content changes', async () => {
    const {owner, memory, token, app} = await setup();
    await memory.updateOne({body: 'x'.repeat(500_000)});
    await expect(indexMemory(owner.id, memory.id)).rejects.toThrow(/large/);
    vi.mocked(queueMemorySearch).mockClear();
    let response = await request(app)
      .get('/memories/search?q=home')
      .auth(token, {type: 'bearer'});
    expect(queueMemorySearch).not.toHaveBeenCalled();
    expect(response.body.data.search).toMatchObject({
      preparing: false,
      limited: true,
    });
    await memory.updateOne({body: 'A new short story'});
    response = await request(app)
      .get('/memories/search?q=home')
      .auth(token, {type: 'bearer'});
    expect(queueMemorySearch).toHaveBeenCalledWith(owner.id, memory.id);
    expect(response.body.data.search.preparing).toBe(true);
  });

  it('does not spend model work on an account above the pilot size limit', async () => {
    const {owner, memory} = await setup();
    await Memory.insertMany(
      Array.from({length: 200}, (_, i) => ({
        user: owner.id,
        title: `Story ${i}`,
        body: 'A memory',
        type: 'story',
        status: 'save',
      })),
    );
    expect(await indexMemory(owner.id, memory.id)).toBe(false);
    expect(embedInputs).not.toHaveBeenCalled();
  });
});
