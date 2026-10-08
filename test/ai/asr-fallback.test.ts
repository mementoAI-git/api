import assert from 'node:assert/strict';
import test from '../helpers/legacy-test';
import {GenerateContentParameters} from '@google/genai';
import gemini from '../../src/services/gemini';
import {transcribeWithConfiguredAsr} from '../../src/services/asr';
import {ServiceUnavailableException} from '../../src/utils/service-error';

const input = {
  textOnly: true,
  transcriptionPrompt: 'Transcribe the audio.',
  processedFilePart: {inlineData: {mimeType: 'audio/webm', data: 'YXVkaW8='}},
};
void test('uses a different audio model when the primary quota is exhausted', async t => {
  let calls = 0;
  const generate = t.mock.method(gemini.models, 'generateContent', async () => {
    if (++calls === 1)
      throw Object.assign(new Error('Quota exceeded'), {status: 429});
    return {text: JSON.stringify({full_text: 'A warm memory.'})};
  });
  const result = await transcribeWithConfiguredAsr(input);
  const models = generate.mock.calls.map(
    call => (call.arguments[0] as GenerateContentParameters).model,
  );
  assert.notEqual(models[0], models[1]);
  assert.equal(result.usedFallback, true);
  assert.deepEqual(result.data, {full_text: 'A warm memory.'});
});
void test('reports provider exhaustion as temporary unavailability rather than an internal error', async t => {
  t.mock.method(gemini.models, 'generateContent', async () => {
    throw Object.assign(new Error('Quota exceeded'), {status: 429});
  });
  await assert.rejects(transcribeWithConfiguredAsr(input), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException);
    assert.equal(error.statusCode, 503);
    assert.match(error.message, /temporarily.*try again later/i);
    return true;
  });
});

void test('transcribes dictation directly with the low-latency model in one request', async t => {
  const generate = t.mock.method(
    gemini.models,
    'generateContent',
    async () => ({
      text: JSON.stringify({full_text: 'A warm memory.'}),
    }),
  );
  const result = await transcribeWithConfiguredAsr(input);
  assert.equal(generate.mock.calls.length, 1);
  assert.equal(result.model, 'gemini-3.5-flash-lite');
  assert.equal(result.usedFallback, false);
});
