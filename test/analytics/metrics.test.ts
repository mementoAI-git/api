import {describe, expect, it} from 'vitest';
import {buildGrowthManifest} from '../../src/scripts/growth-analytics/manifest';

type Event = {
  event: string;
  user: string;
  day: number;
  props?: Record<string, string | number | boolean>;
};
const e = (event: string, user: string, day: number, props = {}): Event => ({
  event,
  user,
  day,
  props:
    event === 'invitation_converted'
      ? {
          ...props,
          invitation_id: `${(props as Record<string, unknown>).inviter_id}:${(props as Record<string, unknown>).invitee_key}`,
        }
      : props,
});
const account = (user: string, day = 0, source = 'organic', inviter = '') =>
  e('account_created', user, day, {
    acquisition_source: source,
    inviter_id: inviter,
  });
const invite = (user: string, key: string, day: number, existing = false) =>
  e('invitation_sent', user, day, {
    invitee_key: key,
    existing_user: existing,
    invitation_id: `${user}:${key}`,
  });
const ratio = (n: number, d: number) => (d === 0 ? null : n / d);

/** Independent executable definition over tiny fixtures, not a SQL parser/mock.
 * Event names omit growth_ for readability. Days are exact elapsed 24h periods.
 */
function calculate(input: Event[], asOf: number) {
  const events = input.filter(x => x.day <= asOf && x.props?.is_test !== true);
  const users = new Map<string, Event>();
  for (const x of [...events].sort((a, b) => a.day - b.day)) {
    if (x.event === 'account_created' && !users.has(x.user))
      users.set(x.user, x);
  }
  const invited = (x: Event) =>
    ['invitation', 'referral'].includes(String(x.props?.acquisition_source));
  const mature = (days: number) =>
    [...users.values()].filter(x => x.day <= asOf - days);
  const within = (x: Event, u: Event, start: number, end: number) =>
    x.user === u.user && x.day >= u.day + start && x.day < u.day + end;
  const activated = mature(7).filter(u => {
    const first = events
      .filter(
        x =>
          ['memory_captured', 'reflection_added'].includes(x.event) &&
          x.user === u.user &&
          x.day >= u.day,
      )
      .sort((a, b) => a.day - b.day)[0];
    return first !== undefined && first.day < u.day + 7;
  });
  const retained = (u: Event) =>
    events.some(x => x.event === 'user_active' && within(x, u, 28, 35));
  const recipients = new Map<string, Event>();
  for (const x of [...events].sort((a, b) => a.day - b.day)) {
    if (
      x.event === 'invitation_sent' &&
      x.props?.existing_user === false &&
      x.props.invitee_key &&
      !recipients.has(String(x.props.invitee_key))
    )
      recipients.set(String(x.props.invitee_key), x);
  }
  const eligibleInvites = [...recipients.values()].filter(
    x => x.day <= asOf - 30,
  );
  const conversions = eligibleInvites.filter(i =>
    events.some(c => {
      const u = users.get(c.user);
      return (
        c.event === 'invitation_converted' &&
        c.props?.existing_user === false &&
        c.props.invitee_key === i.props?.invitee_key &&
        u !== undefined &&
        invited(u) &&
        events.some(
          r =>
            r.event === 'invitation_sent' &&
            r.props?.existing_user === false &&
            r.props.invitee_key === i.props?.invitee_key &&
            r.user === c.props?.inviter_id &&
            r.props.invitation_id === c.props?.invitation_id &&
            r.day <= u.day &&
            r.day <= c.day,
        ) &&
        u.day >= i.day &&
        u.day < i.day + 30 &&
        c.day >= i.day &&
        c.day < i.day + 30
      );
    }),
  );
  const parents = mature(30);
  const children = parents.flatMap(p =>
    [...users.values()].filter(
      c =>
        c.user !== p.user &&
        invited(c) &&
        c.props?.inviter_id === p.user &&
        c.day >= p.day &&
        c.day < p.day + 30,
    ),
  );
  const invitedUsers = parents.filter(invited);
  const inviters = invitedUsers.filter(
    u =>
      events.some(
        x =>
          x.event === 'invitation_sent' &&
          x.props?.existing_user === false &&
          x.props.invitee_key &&
          within(x, u, 0, 30),
      ) ||
      [...users.values()].some(
        c =>
          c.user !== u.user &&
          c.props?.acquisition_source === 'referral' &&
          c.props.inviter_id === u.user &&
          c.day >= u.day &&
          c.day < u.day + 30,
      ),
  );
  const connected = (u: Event) =>
    events.some(
      a =>
        a.event === 'connection_activated' &&
        within(a, u, 0, 7) &&
        events.some(
          g =>
            g.event === 'connection_engaged' &&
            within(g, u, 0, 7) &&
            g.props?.connection_id === a.props?.connection_id &&
            g.day >= a.day,
        ),
    );
  const connectedUsers = mature(35).filter(connected);
  const unconnectedUsers = mature(35).filter(u => !connected(u));
  const connectedRate = ratio(
    connectedUsers.filter(retained).length,
    connectedUsers.length,
  );
  const unconnectedRate = ratio(
    unconnectedUsers.filter(retained).length,
    unconnectedUsers.length,
  );
  return {
    activation: {
      numerator: activated.length,
      denominator: mature(7).length,
      rate: ratio(activated.length, mature(7).length),
    },
    retention: {
      numerator: mature(35).filter(retained).length,
      denominator: mature(35).length,
    },
    conversion: {
      numerator: conversions.length,
      denominator: eligibleInvites.length,
      rate: ratio(conversions.length, eligibleInvites.length),
    },
    k: {
      numerator: children.length,
      denominator: parents.length,
      rate: ratio(children.length, parents.length),
    },
    invitee: {
      numerator: inviters.length,
      denominator: invitedUsers.length,
      rate: ratio(inviters.length, invitedUsers.length),
    },
    connection: {
      connected: connectedUsers.length,
      unconnected: unconnectedUsers.length,
      connectedRate,
      unconnectedRate,
      lift:
        connectedRate === null ||
        unconnectedRate === null ||
        unconnectedRate === 0
          ? null
          : connectedRate / unconnectedRate - 1,
    },
  };
}

describe('growth metric calculation reference', () => {
  it('uses first persisted memory/reflection, exclusive day 7, maturity, and unique accounts', () => {
    const result = calculate(
      [
        account('a'),
        account('a', 2),
        account('b'),
        account('c', 36),
        e('memory_captured', 'a', -1),
        e('reflection_added', 'a', 6.9),
        e('memory_captured', 'a', 20),
        e('memory_captured', 'b', 7),
        e('memory_captured', 'c', 37),
      ],
      40,
    );
    expect(result.activation).toEqual({
      numerator: 1,
      denominator: 2,
      rate: 0.5,
    });
  });
  it('uses exact D30 [28,35) activity and requires the full 35 days', () => {
    const result = calculate(
      [
        account('a'),
        account('b'),
        account('c'),
        account('immature', 6),
        e('user_active', 'a', 28),
        e('user_active', 'a', 34.9),
        e('user_active', 'b', 35),
        e('user_active', 'c', 27.99),
        e('user_active', 'immature', 34),
      ],
      40,
    );
    expect(result.retention).toEqual({numerator: 1, denominator: 3});
  });
  it('joins sender invitations to actual invitee accounts, deduplicates resends and excludes existing users', () => {
    const result = calculate(
      [
        account('sender'),
        invite('sender', 'key', 1),
        invite('sender', 'key', 10),
        invite('other', 'key', 12),
        invite('sender', 'unconverted', 2),
        invite('sender', 'old-user', 1, true),
        invite('sender', 'immature', 20),
        account('child', 5, 'invitation', 'sender'),
        e('invitation_converted', 'child', 5, {
          invitee_key: 'key',
          inviter_id: 'sender',
          existing_user: false,
        }),
        e('invitation_converted', 'missing-account', 4, {
          invitee_key: 'unconverted',
          inviter_id: 'sender',
          existing_user: false,
        }),
      ],
      40,
    );
    expect(result.conversion).toEqual({
      numerator: 1,
      denominator: 2,
      rate: 0.5,
    });
  });
  it('does not count late conversion or conversion without a matching sender receipt', () => {
    const result = calculate(
      [
        invite('a', 'late', 0),
        invite('a', 'wrong', 0),
        account('late', 30, 'invitation', 'a'),
        account('wrong', 2, 'invitation', 'b'),
        e('invitation_converted', 'late', 30, {
          invitee_key: 'late',
          inviter_id: 'a',
          existing_user: false,
        }),
        e('invitation_converted', 'wrong', 2, {
          invitee_key: 'wrong',
          inviter_id: 'b',
          existing_user: false,
        }),
      ],
      40,
    );
    expect(result.conversion.numerator).toBe(0);
  });
  it('counts one recipient converted through a later sender or referral-attributed signup', () => {
    const result = calculate(
      [
        invite('expired-first-sender', 'recipient', 0),
        invite('actual-sender', 'recipient', 5),
        account('child', 6, 'referral', 'referrer'),
        e('invitation_converted', 'child', 6, {
          invitee_key: 'recipient',
          inviter_id: 'actual-sender',
          existing_user: false,
        }),
        e('invitation_converted', 'child', 6, {
          invitee_key: 'recipient',
          inviter_id: 'expired-first-sender',
          existing_user: false,
        }),
      ],
      40,
    );
    expect(result.conversion).toEqual({numerator: 1, denominator: 1, rate: 1});
  });
  it('uses observed mature parents for K-factor, unique attributed signups, and parent-relative windows', () => {
    const result = calculate(
      [
        account('p'),
        account('q', 10),
        account('x', 2, 'referral', 'p'),
        account('x', 3, 'referral', 'p'),
        account('late', 30, 'invitation', 'p'),
        account('historic-child', 4, 'invitation', 'unobserved-parent'),
        account('young', 35),
        account('young-child', 36, 'invitation', 'young'),
      ],
      40,
    );
    expect(result.k).toEqual({numerator: 1, denominator: 4, rate: 0.25});
  });
  it('counts invited users who invite new recipients, including referral acquisition', () => {
    const result = calculate(
      [
        account('a', 0, 'invitation'),
        account('b', 0, 'referral'),
        account('c', 0, 'invitation'),
        account('young', 20, 'invitation'),
        invite('a', 'new', 29.9),
        invite('a', 'new', 29.95),
        invite('b', 'existing', 1, true),
        invite('c', 'late', 30),
        invite('young', 'new2', 21),
      ],
      40,
    );
    expect(result.invitee).toEqual({numerator: 1, denominator: 3, rate: 1 / 3});
  });
  it('recognizes validated referral offspring as proof an invited user became an inviter', () => {
    const result = calculate(
      [
        account('referrer', 0, 'invitation'),
        account('direct-and-referral', 0, 'referral'),
        account('no-outcome', 0, 'invitation'),
        account('child', 29, 'referral', 'referrer'),
        account('child2', 20, 'referral', 'direct-and-referral'),
        account('late-child', 30, 'referral', 'no-outcome'),
        invite('direct-and-referral', 'recipient', 10),
      ],
      40,
    );
    expect(result.invitee).toEqual({numerator: 2, denominator: 3, rate: 2 / 3});
  });
  it('freezes connection cohorts at day 7 and requires engagement on the same accepted connection', () => {
    const result = calculate(
      [
        account('a'),
        account('b'),
        account('c'),
        account('d'),
        e('connection_activated', 'a', 1, {connection_id: '1'}),
        e('connection_engaged', 'a', 6.9, {connection_id: '1'}),
        e('connection_activated', 'b', 2, {connection_id: '2'}),
        e('connection_engaged', 'b', 7, {connection_id: '2'}),
        e('connection_activated', 'c', 2, {connection_id: '3'}),
        e('connection_engaged', 'c', 3, {connection_id: '4'}),
        e('connection_engaged', 'd', 1, {connection_id: '5'}),
        e('connection_activated', 'd', 2, {connection_id: '5'}),
        e('user_active', 'a', 28),
        e('user_active', 'b', 29),
      ],
      40,
    );
    expect(result.connection).toEqual({
      connected: 1,
      unconnected: 3,
      connectedRate: 1,
      unconnectedRate: 1 / 3,
      lift: 2,
    });
  });
  it('allows a valid engagement after acceptance even when another engagement preceded acceptance', () => {
    const result = calculate(
      [
        account('a'),
        e('connection_engaged', 'a', 1, {connection_id: 'pair'}),
        e('connection_activated', 'a', 2, {connection_id: 'pair'}),
        e('connection_engaged', 'a', 3, {connection_id: 'pair'}),
      ],
      40,
    );
    expect(result.connection.connected).toBe(1);
    expect(result.connection.unconnected).toBe(0);
  });
  it('keeps real zero outcomes distinct from absent denominators and zero-baseline lift', () => {
    const result = calculate(
      [
        account('connected'),
        account('baseline'),
        e('connection_activated', 'connected', 1, {connection_id: 'pair'}),
        e('connection_engaged', 'connected', 2, {connection_id: 'pair'}),
        e('user_active', 'connected', 28),
        invite('connected', 'no-signup', 0),
      ],
      40,
    );
    expect(result.activation.rate).toBe(0);
    expect(result.conversion).toEqual({numerator: 0, denominator: 1, rate: 0});
    expect(result.connection.connectedRate).toBe(1);
    expect(result.connection.unconnectedRate).toBe(0);
    expect(result.connection.lift).toBeNull();
  });
  it('returns unavailable rates as null and excludes test events', () => {
    const result = calculate(
      [account('young', 39), e('account_created', 'test', 0, {is_test: true})],
      40,
    );
    expect(result.activation.rate).toBeNull();
    expect(result.conversion.rate).toBeNull();
    expect(result.k.rate).toBeNull();
    expect(result.invitee.rate).toBeNull();
    expect(result.connection.lift).toBeNull();
  });
});

describe('versioned PostHog manifest contract', () => {
  const manifest = buildGrowthManifest({asOf: '2026-10-29T00:00:00Z'});
  it('exports six table queries with production API isolation and denominator guards', () => {
    expect(manifest.version).toBe(1);
    expect(manifest.insights).toHaveLength(6);
    for (const insight of manifest.insights) {
      const sql = insight.query.source.query;
      expect(insight.query.kind).toBe('DataTableNode');
      expect(sql).toContain("properties.analytics_source = 'api'");
      expect(sql).toContain('properties.analytics_schema_version = 1');
      expect(sql).toContain("properties.environment = 'production'");
      expect(sql).toContain('coalesce(properties.is_test, false) = false');
      expect(sql).toContain('nullIf(');
      expect(sql).not.toContain('{filters}');
      expect(sql).not.toMatch(
        /properties\.(email|title|content|message|transcript)/,
      );
    }
  });
  it('rejects interpolation through the reproducibility timestamp', () => {
    expect(() =>
      buildGrowthManifest({asOf: "'); DROP TABLE events; --"}),
    ).toThrow();
  });
});
