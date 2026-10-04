import {afterAll, beforeAll, expect, test} from 'vitest';
import mongoose from 'mongoose';
import {connectTestDatabase, closeTestDatabase} from '../helpers/database';
import Prompt from '../../src/module/database/model/prompt';
import {runExploreTopicsMigration} from '../../src/module/database/migrations/explore-topics-v2';
import {seedExploreStarterQuestions} from '../../src/module/database/seed/explore-prompts.seed';
import {MIGRATIONS} from '../../src/migrations/definitions';

beforeAll(connectTestDatabase);
afterAll(closeTestDatabase);

test('deployment migration preserves legacy answer references and seeds starters idempotently', async () => {
  const legacy = await Prompt.create({
    title: 'Old work question?',
    category: 'career',
  });
  const memories = mongoose.connection.db.collection('memories');
  const answer = await memories.insertOne({
    prompt: String(legacy._id),
    user: 'user-1',
    body: 'My saved answer',
  });
  const dryRun = await runExploreTopicsMigration({
    apply: false,
    reverse: false,
  });
  expect(dryRun.mode).toBe('dry-run');
  expect((await Prompt.findById(legacy._id)).category).toBe('career');

  const rollout = MIGRATIONS.find(
    migration =>
      migration.id === '202610030001_explore_topics_starters_and_compatibility',
  );
  expect(rollout).toBeDefined();
  await rollout.up(mongoose.connection.db);
  await rollout.up(mongoose.connection.db);

  const migrated = await Prompt.findById(legacy._id);
  expect(migrated.category).toBe('work-purpose');
  expect(migrated.legacy_category).toBe('career');
  expect(migrated.active).toBe(false);
  expect(await memories.findOne({_id: answer.insertedId})).toMatchObject({
    prompt: String(legacy._id),
    body: 'My saved answer',
  });
  expect(await Prompt.countDocuments({source: 'starter'})).toBe(110);
  const idsBefore = (
    await Prompt.find({source: 'starter'}).select('_id').lean()
  )
    .map(prompt => String(prompt._id))
    .sort();
  await seedExploreStarterQuestions();
  const idsAfter = (await Prompt.find({source: 'starter'}).select('_id').lean())
    .map(prompt => String(prompt._id))
    .sort();
  expect(idsAfter).toEqual(idsBefore);
});
