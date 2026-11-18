import {describe, expect, it} from 'vitest';
import {
  buildLaunchReport,
  formatLaunchReport,
} from '../../src/scripts/growth-analytics/launch-report';

const at = (iso: string) => new Date(iso);

function sample() {
  return buildLaunchReport({
    since: at('2026-11-13T00:00:00Z'),
    now: at('2026-11-22T12:00:00Z'),
    users: [
      {id: 'a', createdAt: at('2026-11-13T09:00:00Z')},
      {id: 'b', createdAt: at('2026-11-13T22:00:00Z')},
      {id: 'c', createdAt: at('2026-11-14T10:00:00Z')},
    ],
    signIns: [
      {userId: 'a', at: at('2026-11-13T09:00:00Z'), client: 'web'},
      {userId: 'a', at: at('2026-11-14T08:00:00Z'), client: 'ios'},
      {userId: 'b', at: at('2026-11-20T08:00:00Z'), client: 'web'},
      // Signed up before the report period.
      {userId: 'old', at: at('2026-11-14T12:00:00Z'), client: 'android'},
    ],
    memories: [
      {userId: 'a', at: at('2026-11-13T09:30:00Z')},
      {userId: 'a', at: at('2026-11-13T10:00:00Z')},
    ],
    messages: [{userId: 'c', at: at('2026-11-14T10:05:00Z')}],
  });
}

describe('launch report', () => {
  it('counts each day by UTC day, including days with nothing', () => {
    const {rows} = sample();
    expect(rows.map(r => r.day)).toEqual([
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    expect(rows[0]).toMatchObject({
      signups: 2,
      activeUsers: 2,
      returningUsers: 0,
      signIns: {web: 1},
      memoryUsers: 1,
      memories: 2,
    });
    expect(rows[2]).toMatchObject({signups: 0, activeUsers: 0});
  });

  it('treats earlier signups and pre-period accounts as returning', () => {
    const day2 = sample().rows[1];
    expect(day2).toMatchObject({
      signups: 1,
      activeUsers: 3,
      returningUsers: 2,
      signIns: {ios: 1, android: 1},
      chatUsers: 1,
      chatMessages: 1,
    });
  });

  it('follows each signup cohort by calendar day', () => {
    const [nov13, nov14] = sample().cohorts;
    expect(nov13).toEqual({
      day: '2026-11-13',
      signups: 2,
      savedMemory: 1,
      backNextDay: 1,
      backWithin7Days: 2,
      backAnyLaterDay: 2,
      week1Complete: true,
    });
    expect(nov14).toMatchObject({
      signups: 1,
      backAnyLaterDay: 0,
      week1Complete: true,
    });
  });

  it('marks week-one figures that can still change', () => {
    const report = buildLaunchReport({
      since: at('2026-11-18T00:00:00Z'),
      now: at('2026-11-18T12:00:00Z'),
      users: [{id: 'a', createdAt: at('2026-11-18T09:00:00Z')}],
      signIns: [],
      memories: [],
      messages: [],
    });
    expect(report.cohorts[0].week1Complete).toBe(false);
    expect(formatLaunchReport(report)).toContain('0 (0%) *');
  });

  it('prints counts only, never user IDs', () => {
    const text = formatLaunchReport(sample());
    expect(text).toContain(
      'Total: 3 signups; 1 (33%) saved a memory; 2 (67%) came back on a later day.',
    );
    expect(text).not.toMatch(/\bold\b/);
  });
});
