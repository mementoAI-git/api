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
import Subscription from '../../src/module/database/model/subscription';
import VoiceUsage from '../../src/module/database/model/voice-usage';
import {
  FREE_VOICE_SECONDS_PER_MONTH,
  nextVoiceAllowanceReset,
  recordEndedVoiceCall,
  voiceUsageMonth,
} from '../../src/module/api/billing/voice-allowance';

async function createProUser() {
  const user = await createUserFixture();
  await Subscription.create({
    user_id: user.id,
    tier: 'pro',
    status: 'active',
    payment_provider: 'polar',
    current_period_end: new Date('2099-01-01'),
  });
  return user;
}

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
    const user = await createProUser();

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
    const user = await createProUser();
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
    const user = await createProUser();
    const startedAnHourAgo = issueCallTicket(user.id, Date.now() - 3_600_000);

    const res = await token(issueLegacyAccessToken(user), {
      resume_handle: 'resume-1',
      call_ticket: startedAnHourAgo,
    });

    expect(res.status).toBe(403);
    expect(res.body.details).toMatchObject({reason: 'voice_call_limit'});
  });

  it('sends only the call ticket when no limit is set', async () => {
    delete process.env.VOICE_MAX_CALL_MINUTES;
    const user = await createProUser();

    const res = await token(issueLegacyAccessToken(user));

    expect(res.status).toBe(200);
    // The ticket names the call for reconnects and usage check-ins; no time limit.
    expect(res.body.data).toEqual({
      token: 'gemini-token',
      call_ticket: expect.any(String),
    });
    expect(readCallTicket(user.id, res.body.data.call_ticket)).not.toBeNull();
  });
});

describe('free plan monthly voice minutes', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  const token = (auth: string, query: Record<string, string> = {}) =>
    request(createTestApp())
      .get('/ai/ephemeral-token')
      .query(query)
      .set('Authorization', `Bearer ${auth}`);

  const usedEarlier = (userId: string, seconds: number) =>
    VoiceUsage.create({
      user: userId,
      call_started_at: Date.now() - 86_400_000,
      month: voiceUsageMonth(Date.now()),
      seconds,
    });

  it('lets a free member call, limited to the minutes left this month', async () => {
    delete process.env.VOICE_MAX_CALL_MINUTES;
    const user = await createUserFixture();
    await usedEarlier(user.id, 60 * 60);

    const res = await token(issueLegacyAccessToken(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      token: 'gemini-token',
      call_seconds_left: 30 * 60,
      call_ticket: expect.any(String),
      call_limit_reason: 'free_monthly',
    });
  });

  it('counts a reconnecting call’s time so far against the month', async () => {
    delete process.env.VOICE_MAX_CALL_MINUTES;
    const user = await createUserFixture();
    const startedTenMinutesAgo = Date.now() - 600_000;
    const ticket = issueCallTicket(user.id, startedTenMinutesAgo);

    const res = await token(issueLegacyAccessToken(user), {
      resume_handle: 'resume-1',
      call_ticket: ticket,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.call_ticket).toBe(ticket);
    expect(res.body.data.call_seconds_left).toBeGreaterThan(
      FREE_VOICE_SECONDS_PER_MONTH - 610,
    );
    expect(res.body.data.call_seconds_left).toBeLessThanOrEqual(
      FREE_VOICE_SECONDS_PER_MONTH - 600,
    );
    const call = await VoiceUsage.findOne({
      user: user.id,
      call_started_at: startedTenMinutesAgo,
    }).lean();
    expect(call?.seconds).toBeGreaterThanOrEqual(600);
  });

  it('asks a free member to upgrade once the month’s minutes are used', async () => {
    delete process.env.VOICE_MAX_CALL_MINUTES;
    const user = await createUserFixture();
    await usedEarlier(user.id, FREE_VOICE_SECONDS_PER_MONTH);

    const res = await token(issueLegacyAccessToken(user));

    expect(res.status).toBe(402);
    expect(res.body.details).toMatchObject({
      error: 'subscription_required',
      feature: 'voice_mode',
    });
  });

  it('ignores minutes used in an earlier month', async () => {
    delete process.env.VOICE_MAX_CALL_MINUTES;
    const user = await createUserFixture();
    await VoiceUsage.create({
      user: user.id,
      call_started_at: Date.now() - 40 * 86_400_000,
      month: '2000-01',
      seconds: FREE_VOICE_SECONDS_PER_MONTH,
    });

    const res = await token(issueLegacyAccessToken(user));

    expect(res.status).toBe(200);
    expect(res.body.data.call_seconds_left).toBe(FREE_VOICE_SECONDS_PER_MONTH);
  });

  it('uses the per-call limit when it ends sooner than the free minutes', async () => {
    process.env.VOICE_MAX_CALL_MINUTES = '30';
    const user = await createUserFixture();

    const res = await token(issueLegacyAccessToken(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      call_seconds_left: 1800,
      call_limit_reason: 'call',
    });
  });

  it('counts the reported length of an ended call', async () => {
    delete process.env.VOICE_MAX_CALL_MINUTES;
    const user = await createUserFixture();
    const auth = issueLegacyAccessToken(user);
    const started = await token(auth);
    const ticket = String(started.body.data.call_ticket);
    const startedAt = Number(ticket.split('.')[0]);
    // An older call this month, so the end report has to pick the right one.
    await usedEarlier(user.id, 60);
    // The call ran for four minutes.
    await VoiceUsage.updateOne(
      {user: user.id, call_started_at: startedAt},
      {$set: {call_started_at: startedAt - 240_000}},
    );

    const res = await request(createTestApp())
      .post('/ai/voice/calls/session-1/end')
      .set('Authorization', `Bearer ${auth}`)
      .send({duration_seconds: 235});

    expect(res.status).toBe(200);
    const call = await VoiceUsage.findOne({
      user: user.id,
      call_started_at: startedAt - 240_000,
    }).lean();
    expect(call?.seconds).toBe(235);
  });

  it('never counts more than the call has existed', async () => {
    const user = await createUserFixture();
    const startedAt = Date.now() - 60_000;
    await VoiceUsage.create({
      user: user.id,
      call_started_at: startedAt,
      month: voiceUsageMonth(startedAt),
    });

    await recordEndedVoiceCall(user.id, 65);

    const call = await VoiceUsage.findOne({user: user.id}).lean();
    expect(call?.seconds).toBeGreaterThanOrEqual(59);
    expect(call?.seconds).toBeLessThanOrEqual(61);
  });
});

describe('voice months in the member’s time zone', () => {
  it('counts a call towards the month where the member is', () => {
    const lateOnTheLast = Date.parse('2026-11-30T23:30:00Z');
    expect(voiceUsageMonth(lateOnTheLast)).toBe('2026-11');
    // Lagos is an hour ahead: it is already 00:30 on 1 December there.
    expect(voiceUsageMonth(lateOnTheLast, 'Africa/Lagos')).toBe('2026-12');
    expect(voiceUsageMonth(lateOnTheLast, 'America/New_York')).toBe('2026-11');
  });

  it('resets at midnight on the 1st, local time', () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    expect(nextVoiceAllowanceReset(now).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
    expect(nextVoiceAllowanceReset(now, 'Africa/Lagos').toISOString()).toBe(
      '2026-11-30T23:00:00.000Z',
    );
    expect(nextVoiceAllowanceReset(now, 'America/New_York').toISOString()).toBe(
      '2026-12-01T05:00:00.000Z',
    );
    // December rolls over into the next year.
    expect(
      nextVoiceAllowanceReset(Date.parse('2026-12-10T12:00:00Z')).toISOString(),
    ).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('voice minutes for every plan', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('records a Pro member’s calls too, with no limit', async () => {
    delete process.env.VOICE_MAX_CALL_MINUTES;
    const user = await createProUser();
    const res = await request(createTestApp())
      .get('/ai/ephemeral-token')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.call_seconds_left).toBeUndefined();
    expect(await VoiceUsage.countDocuments({user: user.id})).toBe(1);
  });

  it('a check-in records the call’s length from its ticket and the server clock', async () => {
    const user = await createUserFixture();
    const auth = issueLegacyAccessToken(user);
    const startedAt = Date.now() - 125_000;

    const res = await request(createTestApp())
      .post('/ai/voice/usage')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        call_ticket: issueCallTicket(user.id, startedAt),
        timezone: 'Africa/Lagos',
      });

    expect(res.status).toBe(200);
    const call = await VoiceUsage.findOne({
      user: user.id,
      call_started_at: startedAt,
    }).lean();
    expect(call?.seconds).toBeGreaterThanOrEqual(124);
    expect(call?.seconds).toBeLessThanOrEqual(126);
    expect(call?.month).toBe(voiceUsageMonth(startedAt, 'Africa/Lagos'));
  });

  it('refuses a check-in with a ticket it did not issue to this member', async () => {
    const user = await createUserFixture();
    const other = await createUserFixture();
    const res = await request(createTestApp())
      .post('/ai/voice/usage')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({call_ticket: issueCallTicket(other.id, Date.now() - 60_000)});

    expect(res.status).toBe(400);
    expect(await VoiceUsage.countDocuments()).toBe(0);
  });

  it('reports this month and all time, with the free allowance on the free plan', async () => {
    const user = await createUserFixture();
    const now = Date.now();
    await VoiceUsage.create([
      {
        user: user.id,
        call_started_at: now - 3_600_000,
        month: voiceUsageMonth(now),
        seconds: 600,
      },
      {
        user: user.id,
        call_started_at: now - 7_200_000,
        month: voiceUsageMonth(now),
        seconds: 300,
      },
      {user: user.id, call_started_at: 1, month: '2020-01', seconds: 1200},
    ]);

    const res = await request(createTestApp())
      .get('/ai/voice/usage')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      month: voiceUsageMonth(now),
      month_seconds: 900,
      all_time_seconds: 2100,
      free_seconds_limit: FREE_VOICE_SECONDS_PER_MONTH,
      free_seconds_left: FREE_VOICE_SECONDS_PER_MONTH - 900,
      month_resets_at: expect.any(String),
    });
  });

  it('has no allowance on a paid plan', async () => {
    const user = await createProUser();
    const res = await request(createTestApp())
      .get('/ai/voice/usage')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`);

    expect(res.body.data).toMatchObject({
      month_seconds: 0,
      all_time_seconds: 0,
      free_seconds_limit: null,
      free_seconds_left: null,
    });
  });
});
