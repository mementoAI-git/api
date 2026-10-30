import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/redis', () => ({
  default: null,
  getRedisConnection: () => null,
  getCachedJson: async () => null,
  setCachedJson: async () => {},
  deleteCacheValue: async () => {},
}));
vi.mock('../../src/services/queues/memory-search', () => ({
  queueMemorySearch: vi.fn(async () => false),
}));

import Memory from '../../src/module/database/model/memory';
import Message from '../../src/module/database/model/message';
import {handleStreaming} from '../../src/module/api/ai/service';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

async function* reply(parts: string[]) {
  for (const text of parts) yield {text};
}

describe('streaming a chat reply', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('ends the response before saving, and saves the reply after the host message', async () => {
    const user = await createUserFixture();
    const memory = await Memory.create({
      user: user.id,
      type: 'conversation',
      status: 'save',
    });
    const events: string[] = [];
    const res = {
      write: (chunk: string) => events.push(`write:${chunk}`),
      end: () => events.push('end'),
    };
    let release: () => void = () => undefined;
    const userMessageSaved = new Promise<void>(resolve => {
      release = () => {
        events.push('user saved');
        resolve();
      };
    });

    const done = handleStreaming(
      user.id,
      memory.id,
      reply(['Hello ', 'there.']),
      res as never,
      'test:model',
      {userText: 'Hi', userMessageSaved},
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    // The app already has the whole reply; nothing is saved yet.
    expect(events).toEqual(['write:Hello ', 'write:there.', 'end']);
    expect(await Message.countDocuments({memory: memory.id})).toBe(0);

    release();
    await done;
    expect(events).toEqual([
      'write:Hello ',
      'write:there.',
      'end',
      'user saved',
    ]);
    const saved = await Message.find({memory: memory.id}).lean();
    expect(saved.map(m => [m.role, m.text])).toEqual([['ai', 'Hello there.']]);
  });

  it('still ends the response when saving fails', async () => {
    const user = await createUserFixture();
    const events: string[] = [];
    const res = {write: () => undefined, end: () => events.push('end')};
    await handleStreaming(
      user.id,
      'not-an-id',
      reply(['Hi']),
      res as never,
      'test',
      {
        userText: 'Hi',
        userMessageSaved: Promise.resolve(),
      },
    );
    expect(events).toEqual(['end']);
  });
});
