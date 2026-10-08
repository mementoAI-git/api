import Persona from '../../module/database/model/persona';
import Memory from '../../module/database/model/memory';
import Message from '../../module/database/model/message';
import {extractBatchInsights} from './persona';
import {saveConfirmedSocialAccounts} from './social-accounts';

const platformMention = /bluesky|bsky|twitter|\bx\b|youtube|linkedin|facebook/i;
const textOnly = (value: string) =>
  value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

/** One-time scan, newest first; only owner-authored text is evidence. No AI summaries. */
export async function discoverExistingSocialAccounts(
  userId: string,
): Promise<void> {
  const persona = await Persona.findOne({user: userId});
  if (persona?.social_accounts_discovered_at) return;
  let batch: string[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const userContent = batch.join('\n\n');
    const insights = await extractBatchInsights(
      userId,
      batch.map(user => ({user, ai: ''})),
    );
    if (!insights)
      throw new Error('Social account discovery provider unavailable');
    await saveConfirmedSocialAccounts(
      userId,
      'existing-content',
      insights.social_accounts,
      userContent,
    );
    batch = [];
  };
  const include = async (value: string) => {
    if (!value || !platformMention.test(value)) return;
    // Keep model requests bounded while preserving each evidence statement intact.
    for (const paragraph of textOnly(value).split(/\n+/)) {
      if (!platformMention.test(paragraph) || paragraph.length > 12000)
        continue;
      if (batch.join('\n\n').length + paragraph.length > 12000) await flush();
      batch.push(paragraph);
      if (batch.length >= 10) await flush();
    }
  };
  await include(persona?.self_description || '');
  const messages = Message.find({
    user: userId,
    role: 'user',
    text: platformMention,
  })
    .select('text memory')
    .populate({
      path: 'memory',
      match: {user: userId, status: {$ne: 'deleted'}},
      select: '_id',
    })
    .sort({created_at: -1})
    .lean()
    .cursor();
  try {
    for await (const message of messages)
      if (message.memory) await include(message.text);
  } finally {
    await messages.close();
  }
  const stories = Memory.find({
    user: userId,
    type: 'story',
    status: {$in: ['save', 'queued', 'on_chain']},
  })
    .select('body attachments')
    .populate('attachments')
    .sort({created_at: -1})
    .lean()
    .cursor();
  try {
    for await (const story of stories) {
      await include(story.body || '');
      for (const file of story.attachments || [])
        if (typeof file !== 'string')
          await include(file.transcription?.full_text || '');
    }
  } finally {
    await stories.close();
  }
  await flush();
  await Persona.updateOne(
    {user: userId},
    {$set: {social_accounts_discovered_at: new Date()}},
    {upsert: true},
  );
}
