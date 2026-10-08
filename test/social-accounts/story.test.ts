import assert from 'node:assert/strict';
import {test, mock, after} from '../helpers/legacy-test';
import Memory from '../../src/module/database/model/memory';
import Persona from '../../src/module/database/model/persona';
import ai from '../../src/services/ai';
import {extractStoryInsights} from '../../src/workers/insight/story';

void test('text stories use the provider fallback and ground links in the body rather than AI titles', async () => {
  let body = 'My X account is https://x.com/memento.';
  const memory = mock.method(Memory, 'findOne', () => ({
    populate: async () => ({
      body,
      title: 'My X account is https://x.com/invented.',
      attachments: [],
    }),
  }));
  const persona = mock.method(Persona, 'findOne', async () => null);
  const writes: unknown[][] = [];
  const update = mock.method(
    Persona,
    'updateOne',
    async (...args: unknown[]) => {
      writes.push(args);
      return {};
    },
  );
  const generation = mock.method(ai, 'generateText', async () =>
    JSON.stringify({
      social_accounts: [
        {
          platform: 'x',
          url: 'https://x.com/memento',
          ownership_confirmed: true,
          evidence: 'My X account is https://x.com/memento.',
        },
      ],
    }),
  );
  try {
    await extractStoryInsights('story-id', 'owner');
    assert.deepEqual(memory.mock.calls[0].arguments[0], {
      _id: 'story-id',
      user: 'owner',
    });
    assert.equal(generation.mock.calls.length, 1);
    assert.equal(writes.length, 2);
    body = 'An unrelated story.';
    writes.length = 0;
    await extractStoryInsights('story-id', 'owner');
    assert.equal(writes.length, 0);
  } finally {
    memory.mock.restore();
    persona.mock.restore();
    update.mock.restore();
    generation.mock.restore();
  }
});
after(async () => {
  const {insightQueue} = await import('../../src/services/queues/insights');
  const {summarizationQueue} = await import(
    '../../src/services/queues/summarization'
  );
  const {systemQueue} = await import('../../src/services/queues/system');
  const {exploreQuestionQueue} = await import(
    '../../src/services/queues/explore-questions'
  );
  const {quickCaptureQueue} = await import(
    '../../src/services/queues/quick-capture'
  );
  await Promise.all(
    [
      insightQueue,
      summarizationQueue,
      systemQueue,
      exploreQuestionQueue,
      quickCaptureQueue,
    ].map(queue => queue?.disconnect()),
  );
});
