import type {Application} from 'express';
import {describe, expect, it, vi} from 'vitest';
const config = vi.hoisted(() => ({enabled: false}));
vi.mock('../../src/utils/config', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/utils/config')>()),
  get BULL_BOARD_ENABLED() {
    return config.enabled;
  },
}));
vi.mock('../../src/services/queues/summarization', () => ({
  summarizationQueue: {name: 'test'},
  initializeConversationSummary: vi.fn(),
  initializePersonaSummarization: vi.fn(),
}));
vi.mock('@bull-board/api', () => ({createBullBoard: vi.fn()}));
vi.mock('@bull-board/api/bullMQAdapter', () => ({BullMQAdapter: class {}}));
vi.mock('@bull-board/express', () => ({
  ExpressAdapter: class {
    setBasePath() {}
    getRouter() {
      return vi.fn();
    }
  },
}));
import {setupBullBoard} from '../../src/services/queues';
describe('Bull Board privacy boundary', () => {
  it.each([false, true])(
    'never mounts raw job payloads, including when legacy config is %s',
    enabled => {
      config.enabled = enabled;
      const use = vi.fn();
      expect(setupBullBoard({use} as unknown as Application)).toBe(false);
      expect(use).not.toHaveBeenCalled();
    },
  );
});
