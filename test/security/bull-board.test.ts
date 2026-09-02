import type {Application} from 'express';
import {describe, expect, it, vi} from 'vitest';
import {setupBullBoard} from '../../src/services/queues';

describe('Bull Board mounting', () => {
  it('does not mount the dashboard when explicitly disabled', () => {
    const use = vi.fn();
    const mounted = setupBullBoard({use} as unknown as Application);
    expect(mounted).toBe(false);
    expect(use).not.toHaveBeenCalled();
  });
});
