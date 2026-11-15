/**
 * One-off: records the PostHog signup event (growth_account_created) for
 * accounts created while growth analytics was switched off, dated with each
 * account's real created_at. It uses the same event key and ID as the live
 * event, so accounts already recorded are skipped and reruns are safe.
 *
 * Fix the server's PostHog settings first (see check-config.ts); the script
 * refuses to run while analytics is off.
 *
 *   npm run growth:backfill-signups -- --dry-run            (count only)
 *   npm run growth:backfill-signups -- --since=2026-10-30
 *
 * On a server (compiled build):
 *   DOTENV_CONFIG_PATH=/path/to/.env MEMENTO_ENV=prod NODE_ENV=production \
 *     npm run growth:backfill-signups:prod -- --dry-run
 *
 * Invitation and referral attribution is worked out as the live event does,
 * from records as they stand now, so it is close but not guaranteed exact.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {connectMongodb} from '../../module/database/connection';
import AnalyticsEvent from '../../module/database/model/analytics-event';
import User from '../../module/database/model/user';
import {
  flushGrowthAnalytics,
  growthAnalyticsProblems,
  growthAnalyticsWarnings,
} from '../../services/growth-analytics';
import {accountCreated} from '../../services/growth-events';

export function parseSince(argv: string[]): Date | undefined {
  const value = argv.find(arg => arg.startsWith('--since='))?.slice(8);
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()))
    throw new Error('--since must be a date like 2026-10-30');
  return date;
}

/** How the account was created, from the sign-in methods it has. */
export function registrationMethod(providers: unknown): 'email' | 'oauth' {
  const list = Array.isArray(providers) ? providers.map(String) : [];
  return list.length && !list.includes('email') ? 'oauth' : 'email';
}

/** Signups per UTC day, oldest first. */
export function countByDay(dates: Date[]): Array<[string, number]> {
  const days = new Map<string, number>();
  for (const date of dates) {
    const day = date.toISOString().slice(0, 10);
    days.set(day, (days.get(day) || 0) + 1);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const since = parseSince(process.argv);
  const problems = growthAnalyticsProblems();
  if (problems.length && !dryRun) {
    console.error(`Growth analytics is off: ${problems.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  for (const warning of growthAnalyticsWarnings())
    console.warn(`WARNING: ${warning}`);

  await connectMongodb();
  const filter = since ? {created_at: {$gte: since}} : {};
  const users = await User.find(filter)
    .select('_id email created_at providers referred_by')
    .sort({created_at: 1})
    .lean();
  const recorded = new Set(
    (
      await AnalyticsEvent.find({key: /^account:/})
        .select('key')
        .lean()
    ).map(event => String(event.key).slice('account:'.length)),
  );
  const missing = users.filter(user => !recorded.has(String(user._id)));

  console.log(
    `${users.length} accounts${since ? ` since ${since.toISOString().slice(0, 10)}` : ''}; ${missing.length} without a recorded signup event.`,
  );
  console.log('Signups per day (UTC), all accounts in range:');
  for (const [day, count] of countByDay(
    users.map(user => new Date(user.created_at)),
  ))
    console.log(`  ${day}  ${count}`);

  if (!dryRun) {
    for (const user of missing)
      await accountCreated(
        user as Parameters<typeof accountCreated>[0],
        registrationMethod(user.providers),
      );
    console.log(`Queued ${missing.length} signup events; sending to PostHog…`);
    for (let round = 0; round < 60; round++) {
      await flushGrowthAnalytics();
      const left = await AnalyticsEvent.countDocuments({
        deliveredAt: {$exists: false},
      });
      if (!left) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    const left = await AnalyticsEvent.countDocuments({
      deliveredAt: {$exists: false},
    });
    console.log(
      left
        ? `${left} events are still waiting; the API's publisher will keep retrying them.`
        : 'All events sent.',
    );
  }
  await mongoose.disconnect();
}

if (require.main === module)
  main().catch(async error => {
    console.error(error);
    process.exitCode = 1;
    await mongoose.disconnect().catch(() => undefined);
  });
