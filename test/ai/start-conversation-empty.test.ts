import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/redis', () => ({
  default: null,
  getRedisConnection: () => null,
  getCachedJson: async () => null,
  setCachedJson: async () => {},
  deleteCacheValue: async () => {},
}));

import Memory from '../../src/module/database/model/memory';
import Message from '../../src/module/database/model/message';
import User from '../../src/module/database/model/user';
import {
  readAttachments,
  startConversation,
} from '../../src/module/api/ai/service';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('starting a chat with nothing to say yet', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('creates the conversation and returns it, without a reply', async () => {
    const user = await createUserFixture();
    const {data} = await startConversation({} as never, user.id);

    expect(data.response).toBe('');
    const memory = await Memory.findById(data.memory_id);
    expect(memory?.type).toBe('conversation');
    expect((await User.findById(user.id))?.primary_conversation_id).toBe(
      data.memory_id,
    );
    expect(await Message.countDocuments({memory: data.memory_id})).toBe(0);
  });

  it('reuses the existing conversation', async () => {
    const user = await createUserFixture();
    const first = await startConversation({} as never, user.id);
    const second = await startConversation({} as never, user.id);
    expect(second.data.memory_id).toBe(first.data.memory_id);
  });
});

describe('sending an attachment when Gemini is failing', () => {
  it('says what happened instead of a generic server error', async () => {
    await expect(
      readAttachments(() => Promise.reject(new Error('API key not valid'))),
    ).rejects.toMatchObject({
      message: expect.stringContaining('can’t read attachments right now'),
    });
  });

  it('passes a successful reply straight through', async () => {
    await expect(readAttachments(async () => 'reply')).resolves.toBe('reply');
  });
});
