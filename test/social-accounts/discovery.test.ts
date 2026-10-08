import assert from 'node:assert/strict';
import {test, mock, after} from '../helpers/legacy-test';
import Persona from '../../src/module/database/model/persona';
import Message from '../../src/module/database/model/message';
import Memory from '../../src/module/database/model/memory';
import * as extraction from '../../src/workers/insight/persona';
import {discoverExistingSocialAccounts} from '../../src/workers/insight/social-discovery';

function sourceQuery<T>(filter: unknown, items: T[]) {
  void filter;
  const query = {
    select: () => query,
    populate: () => query,
    sort: () => query,
    lean: () => query,
    cursor: () =>
      Object.assign(
        (async function* () {
          for (const item of items) yield item;
        })(),
        {close: async () => undefined},
      ),
  };
  return query;
}
void test('scans only owned user messages and saved stories, with grounded evidence and completion marker', async () => {
  const evidence = 'My X account is https://x.com/memento.';
  const persona = mock.method(Persona, 'findOne', async () => ({
    self_description: '',
  }));
  const messages = mock.method(Message, 'find', (_filter: unknown) =>
    sourceQuery(_filter, [{text: evidence, memory: 'owned'}]),
  );
  const stories = mock.method(Memory, 'find', (_filter: unknown) =>
    sourceQuery(_filter, [{body: 'My friend uses YouTube.', attachments: []}]),
  );
  const ai = mock.method(extraction, 'extractBatchInsights', async () => ({
    social_accounts: [
      {
        platform: 'x',
        url: 'https://x.com/memento',
        ownership_confirmed: true,
        evidence,
      },
    ],
  }));
  const updates: unknown[][] = [];
  const update = mock.method(
    Persona,
    'updateOne',
    async (...args: unknown[]) => {
      updates.push(args);
      return {};
    },
  );
  try {
    await discoverExistingSocialAccounts('owner');
    assert.equal(ai.mock.calls.length, 1);
    assert.equal(
      (messages.mock.calls[0].arguments[0] as {user: string}).user,
      'owner',
    );
    assert.equal(
      (messages.mock.calls[0].arguments[0] as {role: string}).role,
      'user',
    );
    assert.equal(
      (stories.mock.calls[0].arguments[0] as {user: string}).user,
      'owner',
    );
    assert.deepEqual(updates[1][0], {
      user: 'owner',
      'social_accounts.x': {$exists: false},
    });
    assert.ok(
      (updates.at(-1)?.[1] as {$set: {social_accounts_discovered_at: Date}})
        .$set.social_accounts_discovered_at instanceof Date,
    );
  } finally {
    persona.mock.restore();
    messages.mock.restore();
    stories.mock.restore();
    ai.mock.restore();
    update.mock.restore();
  }
});
void test('does not rescan a completed persona', async () => {
  const persona = mock.method(Persona, 'findOne', async () => ({
    social_accounts_discovered_at: new Date(),
  }));
  const messages = mock.method(Message, 'find', (_filter: unknown) =>
    sourceQuery(_filter, []),
  );
  try {
    await discoverExistingSocialAccounts('owner');
    assert.equal(messages.mock.calls.length, 0);
  } finally {
    persona.mock.restore();
    messages.mock.restore();
  }
});
void test('provider failure leaves the scan incomplete so the queue can retry', async () => {
  const persona = mock.method(Persona, 'findOne', async () => ({
    self_description: 'My X is https://x.com/me.',
  }));
  const messages = mock.method(Message, 'find', (_filter: unknown) =>
    sourceQuery(_filter, []),
  );
  const stories = mock.method(Memory, 'find', (_filter: unknown) =>
    sourceQuery(_filter, []),
  );
  const ai = mock.method(
    extraction,
    'extractBatchInsights',
    async () => undefined,
  );
  const update = mock.method(Persona, 'updateOne', async () => ({}));
  try {
    await assert.rejects(discoverExistingSocialAccounts('owner'));
    assert.equal(update.mock.calls.length, 0);
  } finally {
    persona.mock.restore();
    messages.mock.restore();
    stories.mock.restore();
    ai.mock.restore();
    update.mock.restore();
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
