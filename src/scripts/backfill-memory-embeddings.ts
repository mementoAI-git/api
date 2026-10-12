/**
 * One-off: embeds every user's existing saved stories and their own chat
 * and voice lines, so in-house memory search covers the past, not only what
 * is written after the deploy. Safe to rerun: unchanged text is skipped.
 *
 *   npm run memory:backfill-embeddings -- --dry-run   (count only)
 *   npm run memory:backfill-embeddings
 *
 * Needs MONGODB_URL and GEMINI_API_KEY (paid tier).
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Memory from '../module/database/model/memory';
import Message from '../module/database/model/message';
import {connectMongodb} from '../module/database/connection';
import {indexMessages, indexStories} from '../services/embeddings/indexer';

const PAGE = 400;

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
  for (const [index, user] of everyone.entries()) {
    // Repeat until a page embeds nothing new: limits are per call.
    for (;;) {
      const count =
        (await indexStories({user, limit: PAGE})) +
        (await indexMessages({user, limit: PAGE}));
      embedded += count;
      if (count < PAGE) break;
    }
    if ((index + 1) % 25 === 0) {
      console.log(
        `${index + 1}/${everyone.length} users, ${embedded} embedded`,
      );
    }
  }
  console.log(`Done: ${embedded} items embedded.`);
  await mongoose.disconnect();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
