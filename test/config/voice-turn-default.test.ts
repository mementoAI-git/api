import {afterEach, describe, expect, it, vi} from 'vitest';

// Staging has run every call on the 450 ms turn arm since October, and that
// is the speed people know. Production had no setting, so it fell back to
// 0% and waited 800 ms of silence before every reply.
describe('voice turn-taking default', () => {
  const original = process.env.VOICE_TURN_AB_PERCENT;
  afterEach(() => {
    if (original === undefined) delete process.env.VOICE_TURN_AB_PERCENT;
    else process.env.VOICE_TURN_AB_PERCENT = original;
    vi.resetModules();
  });

  it('puts everyone on the fast arm when the server sets nothing', async () => {
    delete process.env.VOICE_TURN_AB_PERCENT;
    vi.resetModules();
    const {VOICE_TURN_AB_PERCENT} = await import('../../src/utils/config');
    const {chooseVoiceTurnDetection} = await import(
      '../../src/module/api/ai/live-session-config'
    );
    expect(VOICE_TURN_AB_PERCENT).toBe(100);
    for (const user of ['user-a', 'user-b', 'user-c', 'user-d']) {
      expect(
        chooseVoiceTurnDetection(user, VOICE_TURN_AB_PERCENT).variant,
      ).toBe('silence-450');
    }
  });

  it('still lets a server roll back to 800 ms', async () => {
    process.env.VOICE_TURN_AB_PERCENT = '0';
    vi.resetModules();
    const {VOICE_TURN_AB_PERCENT} = await import('../../src/utils/config');
    expect(VOICE_TURN_AB_PERCENT).toBe(0);
  });
});
