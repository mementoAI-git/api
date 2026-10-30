import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/services/user-context-cache', () => ({
  forgetUserContext: vi.fn(async () => {}),
  cachedUserContext: vi.fn(
    async (_kind: string, _user: string, load: () => Promise<unknown>) =>
      load(),
  ),
}));
vi.mock('../../src/services/queues/memory-search', () => ({
  queueMemorySearch: vi.fn(async () => {}),
}));

import {forgetUserContext} from '../../src/services/user-context-cache';
import {recordVoiceTurns} from '../../src/module/api/ai/voice/turns';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('voice turns and the call context cache', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  // Calls save their turns every few seconds. Clearing the cached overview
  // and memory summaries on each one meant the next call never found them
  // (every call start rebuilt both, ~0.7 s).
  it('does not clear the cached context for new lines in a call', async () => {
    const user = await createUserFixture();
    await recordVoiceTurns(user.id, {
      session_id: 'call-1',
      turns: [
        {index: 0, role: 'user', text: 'Hello Memento, how are you today?'},
        {index: 1, role: 'ai', text: 'I am well, thank you for asking.'},
      ],
    });

    expect(forgetUserContext).not.toHaveBeenCalled();
  });
});
