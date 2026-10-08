import assert from 'node:assert/strict';
import {test, mock, after} from '../helpers/legacy-test';
import Persona from '../../src/module/database/model/persona';
import {updateContext} from '../../src/module/api/user/service';
import validator from '../../src/module/api/user/validator';
import {validationResult} from 'express-validator';

void test('manual social updates use authenticated user scope and per-platform changes', async () => {
  const calls: unknown[][] = [];
  const update = mock.method(
    Persona,
    'findOneAndUpdate',
    async (...args: unknown[]) => {
      calls.push(args);
      return {user: 'owner'};
    },
  );
  try {
    await updateContext(
      {social_accounts: {x: 'https://twitter.com/memento', facebook: null}},
      'owner',
    );
    assert.deepEqual(calls[0][0], {user: 'owner'});
    const changes = calls[0][1] as Record<
      string,
      {url: string; source: string} | null
    >;
    assert.equal(changes['social_accounts.x']?.url, 'https://x.com/memento');
    assert.equal(changes['social_accounts.x']?.source, 'user');
    assert.equal(changes['social_accounts.facebook'], null);
    assert.equal('social_accounts.linkedin' in changes, false);
    await assert.rejects(
      updateContext({social_accounts: {x: 'javascript:alert(1)'}}, 'owner'),
    );
    assert.equal(calls.length, 1);
  } finally {
    update.mock.restore();
  }
});
void test('schema preserves explicit removal markers', () => {
  const persona = new Persona({
    user: 'owner',
    social_accounts: {
      x: null,
      linkedin: {
        url: 'https://www.linkedin.com/in/me',
        source: 'user',
        confirmed_at: new Date(),
      },
    },
  });
  assert.equal(persona.validateSync(), undefined);
  assert.equal(persona.toObject().social_accounts?.x, null);
});
void test('route validator rejects forged metadata and unknown platforms', async () => {
  for (const value of [
    {x: {url: 'https://x.com/me', source: 'ai'}},
    {instagram: 'https://instagram.com/me'},
    {x: 'https://x.com/me/status/123'},
  ]) {
    const request = {body: {social_accounts: value}};
    await Promise.all(validator.updateContext.map(rule => rule.run(request)));
    assert.equal(validationResult(request).isEmpty(), false);
  }
});

// Service imports initialize shared queue clients; disconnect them after this suite.
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
