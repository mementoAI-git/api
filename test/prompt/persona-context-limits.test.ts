import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

// No Redis in tests: caches are skipped.
vi.mock('../../src/services/redis', () => ({
  default: null,
  getRedisConnection: () => null,
  getCachedJson: async () => null,
  setCachedJson: async () => {},
  deleteCacheValue: async () => {},
}));

import {prompts} from '../../src/utils';
import {PERSONA_PROMPT_LIMITS} from '../../src/utils/ai-prompt';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const numbered = (label: string, count: number) =>
  Array.from({length: count}, (_, i) => `${label} ${i + 1}.`);

describe('stored host lists in the prompt', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('includes only the most recent items of each list', async () => {
    const user = await createUserFixture();
    const persona = {
      important_notes: numbered('note', 40),
      key_preferences: numbered('preference', 30),
      goals_and_aspirations: numbered('goal', 43),
      emotional_state_trends: numbered('trend', 53),
    };

    const context = await prompts.createSystemContext(
      user as never,
      undefined,
      persona as never,
    );

    for (const [label, field, total] of [
      ['note', 'important_notes', 40],
      ['preference', 'key_preferences', 30],
      ['goal', 'goals_and_aspirations', 43],
      ['trend', 'emotional_state_trends', 53],
    ] as const) {
      const limit = PERSONA_PROMPT_LIMITS[field];
      expect(context).toContain(`- ${label} ${total}.`);
      expect(context).toContain(`- ${label} ${total - limit + 1}.`);
      expect(context).not.toContain(`- ${label} ${total - limit}.`);
    }
  });

  it('still says when nothing is stored', async () => {
    const user = await createUserFixture();
    const context = await prompts.createSystemContext(
      user as never,
      undefined,
      {
        important_notes: [],
      } as never,
    );
    expect(context).toContain('- None stored');
  });
});
