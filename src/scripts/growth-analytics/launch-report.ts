/**
 * Read-only launch report: day-by-day signups, sign-ins and activity straight
 * from the database, for the period before analytics was recording.
 *
 * It only reads, prints counts, and never prints names, emails, IDs or any
 * memory or message content. Nothing is sent anywhere.
 *
 *   npm run growth:launch-report -- --since=2026-11-13
 *
 * On a server (compiled build):
 *   DOTENV_CONFIG_PATH=/path/to/.env MEMENTO_ENV=prod NODE_ENV=production \
 *     npm run growth:launch-report:prod -- --since=2026-11-13
 *
 * "Active" means the user signed in, saved a memory, or sent a chat message
 * that day. Staying signed in and only reading does not leave a record, so
 * active counts are a floor, not a ceiling. All days are UTC.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {connectMongodb} from '../../module/database/connection';
import AuthSession from '../../module/database/model/auth-session';
import Memory from '../../module/database/model/memory';
import Message from '../../module/database/model/message';
import User from '../../module/database/model/user';
import {parseSince} from './backfill-signups';

const SAVED_STATUSES = ['save', 'queued', 'on_chain', 'published'];
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReportInput = {
  since: Date;
  now: Date;
  users: Array<{id: string; createdAt: Date}>;
  signIns: Array<{userId: string; at: Date; client: string}>;
  memories: Array<{userId: string; at: Date}>;
  messages: Array<{userId: string; at: Date}>;
};

export type DayRow = {
  day: string;
  signups: number;
  activeUsers: number;
  returningUsers: number;
  signIns: Record<string, number>;
  memoryUsers: number;
  memories: number;
  chatUsers: number;
  chatMessages: number;
};

export type CohortRow = {
  day: string;
  signups: number;
  savedMemory: number;
  backNextDay: number;
  backWithin7Days: number;
  backAnyLaterDay: number;
  /** False while the cohort is too young for the 7-day figure to be final. */
  week1Complete: boolean;
};

const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const dayStart = (day: string) => new Date(`${day}T00:00:00Z`).getTime();

/** All report numbers, computed from plain records so it can be tested. */
export function buildLaunchReport(input: ReportInput) {
  const days: string[] = [];
  for (
    let t = dayStart(dayOf(input.since));
    t <= input.now.getTime();
    t += DAY_MS
  )
    days.push(dayOf(new Date(t)));

  const signupDay = new Map(input.users.map(u => [u.id, dayOf(u.createdAt)]));
  // Every UTC day each user did something recorded.
  const activeDays = new Map<string, Set<string>>();
  const markActive = (userId: string, at: Date) => {
    if (!activeDays.has(userId)) activeDays.set(userId, new Set());
    activeDays.get(userId)!.add(dayOf(at));
  };
  for (const s of input.signIns) markActive(s.userId, s.at);
  for (const m of input.memories) markActive(m.userId, m.at);
  for (const m of input.messages) markActive(m.userId, m.at);
  for (const u of input.users) markActive(u.id, u.createdAt);

  const rows: DayRow[] = days.map(day => {
    const inDay = <T extends {at: Date}>(list: T[]) =>
      list.filter(x => dayOf(x.at) === day);
    const active = [...activeDays]
      .filter(([, set]) => set.has(day))
      .map(([id]) => id);
    const signIns: Record<string, number> = {};
    for (const s of inDay(input.signIns))
      signIns[s.client] = (signIns[s.client] || 0) + 1;
    const memories = inDay(input.memories);
    const messages = inDay(input.messages);
    return {
      day,
      signups: input.users.filter(u => dayOf(u.createdAt) === day).length,
      activeUsers: active.length,
      // Signed up on an earlier day, or before the report period began.
      returningUsers: active.filter(id => (signupDay.get(id) ?? '') < day)
        .length,
      signIns,
      memoryUsers: new Set(memories.map(m => m.userId)).size,
      memories: memories.length,
      chatUsers: new Set(messages.map(m => m.userId)).size,
      chatMessages: messages.length,
    };
  });

  const cohorts: CohortRow[] = days
    .map(day => {
      const ids = input.users
        .filter(u => dayOf(u.createdAt) === day)
        .map(u => u.id);
      const start = dayStart(day);
      const laterDays = (id: string) =>
        [...(activeDays.get(id) || [])].filter(d => d > day).map(dayStart);
      return {
        day,
        signups: ids.length,
        savedMemory: new Set(
          input.memories.filter(m => ids.includes(m.userId)).map(m => m.userId),
        ).size,
        backNextDay: ids.filter(id => laterDays(id).includes(start + DAY_MS))
          .length,
        backWithin7Days: ids.filter(id =>
          laterDays(id).some(t => t <= start + 7 * DAY_MS),
        ).length,
        backAnyLaterDay: ids.filter(id => laterDays(id).length > 0).length,
        week1Complete: input.now.getTime() >= start + 8 * DAY_MS,
      };
    })
    .filter(c => c.signups > 0);

  return {rows, cohorts};
}

const pct = (n: number, d: number) =>
  d ? ` (${Math.round((n / d) * 100)}%)` : '';

/** Plain-text tables for the terminal. */
export function formatLaunchReport(
  report: ReturnType<typeof buildLaunchReport>,
) {
  const lines: string[] = [];
  const clients = [
    ...new Set(report.rows.flatMap(r => Object.keys(r.signIns))),
  ].sort();
  const table = (head: string[], body: Array<Array<string | number>>) => {
    const all = [head, ...body.map(r => r.map(String))];
    const widths = head.map((_, i) => Math.max(...all.map(r => r[i].length)));
    for (const r of all)
      lines.push(r.map((c, i) => c.padStart(widths[i])).join('  '));
  };

  lines.push('Daily activity (UTC)');
  table(
    [
      'day',
      'signups',
      'active',
      'returning',
      ...clients.map(c => `sign-ins ${c}`),
      'memory users',
      'memories',
      'chat users',
      'messages',
    ],
    report.rows.map(r => [
      r.day,
      r.signups,
      r.activeUsers,
      r.returningUsers,
      ...clients.map(c => r.signIns[c] || 0),
      r.memoryUsers,
      r.memories,
      r.chatUsers,
      r.chatMessages,
    ]),
  );

  lines.push('', 'Signup cohorts: did new users come back?');
  table(
    [
      'signup day',
      'signups',
      'saved a memory',
      'back next day',
      'back within 7 days',
      'back any later day',
    ],
    report.cohorts.map(c => [
      c.day,
      c.signups,
      `${c.savedMemory}${pct(c.savedMemory, c.signups)}`,
      `${c.backNextDay}${pct(c.backNextDay, c.signups)}`,
      `${c.backWithin7Days}${pct(c.backWithin7Days, c.signups)}${c.week1Complete ? '' : ' *'}`,
      `${c.backAnyLaterDay}${pct(c.backAnyLaterDay, c.signups)}`,
    ]),
  );

  const signups = report.cohorts.reduce((n, c) => n + c.signups, 0);
  const saved = report.cohorts.reduce((n, c) => n + c.savedMemory, 0);
  const back = report.cohorts.reduce((n, c) => n + c.backAnyLaterDay, 0);
  lines.push(
    '',
    `Total: ${signups} signups; ${saved}${pct(saved, signups)} saved a memory; ${back}${pct(back, signups)} came back on a later day.`,
    '* fewer than 7 full days have passed, so this can still go up.',
    'Active = signed in, saved a memory or sent a chat message. Reading while already signed in leaves no record, so these are minimums.',
  );
  return lines.join('\n');
}

async function main() {
  const since = parseSince(process.argv) ?? new Date('2026-11-13T00:00:00Z');
  const now = new Date();
  await connectMongodb();
  const range = {$gte: since};

  const [users, sessions, memories, messages] = await Promise.all([
    User.find({created_at: range}).select('_id created_at').lean(),
    AuthSession.find({created_at: range})
      .select('user_id client created_at')
      .lean(),
    Memory.find({
      created_at: range,
      type: {$ne: 'conversation'},
      $or: [
        {status: {$in: SAVED_STATUSES}},
        {status: 'deleted', previous_status: {$in: SAVED_STATUSES}},
      ],
    })
      .select('user created_at')
      .lean(),
    Message.find({created_at: range, role: 'user'})
      .select('user created_at')
      .lean(),
  ]);

  const report = buildLaunchReport({
    since,
    now,
    users: users.map(u => ({
      id: String(u._id),
      createdAt: new Date(u.created_at as unknown as string),
    })),
    signIns: sessions.map(s => ({
      userId: String(s.user_id),
      at: new Date(s.created_at),
      client: String(s.client),
    })),
    memories: memories.map(m => ({
      userId: String(m.user),
      at: new Date(m.created_at),
    })),
    messages: messages.map(m => ({
      userId: String(m.user),
      at: new Date(m.created_at),
    })),
  });
  console.log(formatLaunchReport(report));
  await mongoose.disconnect();
}

if (require.main === module)
  main().catch(async error => {
    console.error(error);
    process.exitCode = 1;
    await mongoose.disconnect().catch(() => undefined);
  });
