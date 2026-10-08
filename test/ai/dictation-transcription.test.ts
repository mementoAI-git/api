import assert from 'node:assert/strict';
import test from '../helpers/legacy-test';
import {GenerateContentParameters} from '@google/genai';
import gemini from '../../src/services/gemini';
import {GeminiAsrProvider} from '../../src/services/asr/gemini-provider';
import {AsrTranscriptionInput} from '../../src/services/asr/types';

void test('dictation requests only transcript text without reasoning or timestamps', async t => {
  const generate = t.mock.method(
    gemini.models,
    'generateContent',
    async () => ({
      text: JSON.stringify({full_text: 'A warm memory.'}),
    }),
  );
  const input: AsrTranscriptionInput & {textOnly: boolean} = {
    transcriptionPrompt: 'Transcribe this audio.',
    processedFilePart: {inlineData: {mimeType: 'audio/webm', data: 'YXVkaW8='}},
    textOnly: true,
  };
  const result = await new GeminiAsrProvider(
    'gemini',
    'gemini-2.5-flash',
  ).transcribe(input);
  assert.deepEqual(result.data, {full_text: 'A warm memory.'});
  const request = generate.mock.calls[0]
    .arguments[0] as GenerateContentParameters;
  assert.deepEqual(request.config, {
    responseMimeType: 'application/json',
    thinkingConfig: {thinkingBudget: 0},
  });
});

void test('stored audio keeps segment transcription and its existing model settings', async t => {
  const data = {
    full_text: 'A warm memory.',
    segments: [{start: 0, end: 2, text: 'A warm memory.'}],
  };
  const generate = t.mock.method(
    gemini.models,
    'generateContent',
    async () => ({text: JSON.stringify(data)}),
  );
  const result = await new GeminiAsrProvider().transcribe({
    transcriptionPrompt: 'Transcribe with segments.',
    processedFilePart: {inlineData: {mimeType: 'audio/webm', data: 'YXVkaW8='}},
  });
  assert.deepEqual(result.data, data);
  assert.equal(
    (generate.mock.calls[0].arguments[0] as GenerateContentParameters).config,
    undefined,
  );
});
