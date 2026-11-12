import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/module/api/billing/service', async original => ({
  ...(await original<typeof import('../../src/module/api/billing/service')>()),
  assertAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/module/api/ai/service', async original => ({
  ...(await original<typeof import('../../src/module/api/ai/service')>()),
  createEphemeralToken: vi.fn().mockResolvedValue({
    message: 'Voice session ready',
    data: {token: 'gemini-token'},
  }),
}));

import {
  issueCallTicket,
  readCallTicket,
  voiceCallLimitSeconds,
} from '../../src/module/api/ai/voice/call-limit';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

const ORIGINAL = process.env.VOICE_MAX_CALL_MINUTES;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VOICE_MAX_CALL_MINUTES;
  else process.env.VOICE_MAX_CALL_MINUTES = ORIGINAL;
});

describe('voice call time limit settings', () => {
  it('is off unless VOICE_MAX_CALL_MINUTES is set', () => {
    delete process.env.VOICE_MAX_CALL_MINUTES;
    expect(voiceCallLimitSeconds()).toBeNull();
    process.env.VOICE_MAX_CALL_MINUTES = '0';
    expect(voiceCallLimitSeconds()).toBeNull();
    process.env.VOICE_MAX_CALL_MINUTES = '30';
    expect(voiceCallLimitSeconds()).toBe(1800);
  });

  it('trusts only tickets it issued, for the member it issued them to', () => {
    const ticket = issueCallTicket('user-a', 1_000);
    expect(readCallTicket('user-a', ticket)).toBe(1_000);
    expect(readCallTicket('user-b', ticket)).toBeNull();
    expect(
      readCallTicket('user-a', ticket.replace(/^1000/, '9000')),
    ).toBeNull();
    expect(readCallTicket('user-a', 'garbage')).toBeNull();
  });
});

describe('GET /ai/ephemeral-token with a time limit', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  const token = (auth: string, query: Record<string, string> = {}) =>
    request(createTestApp())
      .get('/ai/ephemeral-token')
      .query(query)
      .set('Authorization', `Bearer ${auth}`);

  it('starts the clock on a new call and tells the app the limit', async () => {
    process.env.VOICE_MAX_CALL_MINUTES = '30';
    const user = await createUserFixture();

    const res = await token(issueLegacyAccessToken(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      token: 'gemini-token',
      max_call_seconds: 1800,
      call_seconds_left: 1800,
      call_ticket: expect.any(String),
    });
  });

  it('keeps the original start time when the call reconnects', async () => {
    process.env.VOICE_MAX_CALL_MINUTES = '30';
    const user = await createUserFixture();
    const startedTenMinutesAgo = issueCallTicket(user.id, Date.now() - 600_000);

    const res = await token(issueLegacyAccessToken(user), {
      resume_handle: 'resume-1',
      call_ticket: startedTenMinutesAgo,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.call_ticket).toBe(startedTenMinutesAgo);
    expect(res.body.data.call_seconds_left).toBeGreaterThan(1190);
    expect(res.body.data.call_seconds_left).toBeLessThanOrEqual(1200);
  });

  it('refuses to reconnect a call past its limit', async () => {
    process.env.VOICE_MAX_CALL_MINUTES = '30';
    const user = await createUserFixture();
    const startedAnHourAgo = issueCallTicket(user.id, Date.now() - 3_600_000);

    const res = await token(issueLegacyAccessToken(user), {
      resume_handle: 'resume-1',
      call_ticket: startedAnHourAgo,
    });

    expect(res.status).toBe(403);
    expect(res.body.details).toMatchObject({reason: 'voice_call_limit'});
  });

  it('adds nothing when no limit is set', async () => {
    delete process.env.VOICE_MAX_CALL_MINUTES;
    const user = await createUserFixture();

    const res = await token(issueLegacyAccessToken(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({token: 'gemini-token'});
  });
});
