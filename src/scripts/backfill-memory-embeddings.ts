/**
 * One-off: embeds every user's existing saved stories and their own chat
 * and voice lines, so in-house memory search covers the past, not only what
 * is written after the deploy. Safe to rerun: unchanged text is skipped.
 *
 *   npm run memory:backfill-embeddings -- --dry-run   (count only)
 *   npm run memory:backfill-embeddings
 *
 * On a server (compiled build, no TypeScript sources):
 *   DOTENV_CONFIG_PATH=/opt/memento/backend-dev/.env NODE_ENV=production \
 *     npm run memory:backfill-embeddings:prod -- --dry-run
 *
 * Needs MONGODB_URL and GEMINI_API_KEY on the paid tier (the free tier
 * allows 100 embedding requests a minute and may use content to improve
 * Google's products). Rate limits are retried; a user that still fails is
 * reported and skipped, and the next run picks them up.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Memory from '../module/database/model/memory';
import Message from '../module/database/model/message';
import {connectMongodb} from '../module/database/connection';
import {indexMessages, indexStories} from '../services/embeddings/indexer';

const PAGE = 100;
/** Breathing room between pages, to stay under per-minute limits. */
const PAUSE_MS = 1_000;
const pause = () => new Promise(resolve => setTimeout(resolve, PAUSE_MS));

/** Pages through all of one user's stories, then messages. */
async function backfillUser(user: string): Promise<number> {
  let embedded = 0;
  for (const index of [indexStories, indexMessages]) {
    for (let skip = 0; ; skip += PAGE) {
      const page = await index({user, limit: PAGE, skip});
      embedded += page.embedded;
      if (page.seen < PAGE) break;
      await pause();
    }
  }
  return embedded;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await connectMongodb();
  const users = await Memory.distinct('user', {type: 'story'});
  const speakers = await Message.distinct('user', {role: 'user'});
  const everyone = [...new Set([...users, ...speakers].map(String))];
  console.log(`${everyone.length} users with stories or messages`);
  if (dryRun) {
    const stories = await Memory.countDocuments({
      type: 'story',
      status: {$nin: ['draft', 'deleted']},
    });
    const lines = await Message.countDocuments({role: 'user'});
    console.log(
      `Would embed up to ${stories} stories and ${lines} message lines.`,
    );
    await mongoose.disconnect();
    return;
  }
  let embedded = 0;
  const failed: string[] = [];
  for (const [index, user] of everyone.entries()) {
    try {
      embedded += await backfillUser(user);
    } catch (error) {
      failed.push(user);
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `User ${index + 1}/${everyone.length} failed and was skipped: ${reason.slice(0, 200)}`,
      );
    }
    if ((index + 1) % 5 === 0 || index + 1 === everyone.length) {
      console.log(
        `${index + 1}/${everyone.length} users, ${embedded} embedded`,
      );
    }
  }
  console.log(
    failed.length
      ? `Finished, but ${failed.length} user(s) failed: run again to retry them. ${embedded} items embedded.`
      : `Done: ${embedded} items embedded.`,
  );
  if (failed.length) process.exitCode = 1;
  await mongoose.disconnect();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
