import assert from 'node:assert/strict';
import test from '../helpers/legacy-test';
import {getTranscriptionInput} from '../../src/module/api/ai/transcription-input';

const recording = (mimetype: string, bytes = 4) =>
  ({mimetype, buffer: Buffer.alloc(bytes), size: bytes}) as Express.Multer.File;
void test('accepts in-memory browser audio and normalizes codec parameters', () => {
  const file = recording('audio/webm;codecs=opus');
  assert.deepEqual(getTranscriptionInput({}, file), {
    kind: 'recording',
    file,
    mimeType: 'audio/webm',
  });
});
void test('continues to accept stored recording IDs', () => {
  assert.deepEqual(
    getTranscriptionInput({file_id: '507f1f77bcf86cd799439011'}),
    {kind: 'stored', fileId: '507f1f77bcf86cd799439011'},
  );
});
void test('rejects missing, ambiguous, invalid and empty inputs before ASR', () => {
  assert.throws(() => getTranscriptionInput({}), /recording or file_id/i);
  assert.throws(() => getTranscriptionInput({file_id: 'bad'}), /file_id/i);
  assert.throws(
    () =>
      getTranscriptionInput(
        {file_id: '507f1f77bcf86cd799439011'},
        recording('audio/webm'),
      ),
    /either/i,
  );
  assert.throws(
    () => getTranscriptionInput({}, recording('image/png')),
    /audio/i,
  );
  assert.throws(
    () => getTranscriptionInput({}, recording('audio/webm', 0)),
    /empty/i,
  );
  assert.throws(
    () =>
      getTranscriptionInput({}, recording('audio/webm', 15 * 1024 * 1024 + 1)),
    /15 MB/i,
  );
});
