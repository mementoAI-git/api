import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {test, afterEach} from 'vitest';
afterEach(() => mock.restoreAll());
import Memory from '../../src/module/database/model/memory';
import File from '../../src/module/database/model/file';
import {EXCLUDED_STORAGE_PROVIDER} from '../../src/utils/constant';
import {checkVoiceMessageAccess} from '../../src/module/api/memory/voice-message-access';
import {addMessageToMemorySchema} from '../../src/module/api/memory/dto';

void test('voice messages cannot target another account conversation', async () => {
  mock.method(Memory, 'findOne', async filter => {
    assert.deepEqual(filter, {_id: 'memory-a', user: 'user-b'});
    return null;
  });
  await assert.rejects(
    checkVoiceMessageAccess({memory_id: 'memory-a', messages: []}, 'user-b'),
    /Memory not found/,
  );
});
void test('attachments must belong to the caller and must not be deleted', async () => {
  mock.method(File, 'find', filter => {
    assert.deepEqual(filter, {
      _id: {$in: ['507f1f77bcf86cd799439011']},
      user: 'user-b',
      deleted: {$ne: true},
      provider: {$ne: EXCLUDED_STORAGE_PROVIDER},
    });
    return {select: async () => []};
  });
  await assert.rejects(
    checkVoiceMessageAccess(
      {
        session_id: 's',
        messages: [
          {
            role: 'user',
            text: 'Photo',
            attachments: ['507f1f77bcf86cd799439011'],
          },
        ],
      },
      'user-b',
    ),
    /File not found/,
  );
});
void test('accepts owned attachments and validates attachment IDs at the boundary', async () => {
  mock.method(File, 'find', () => ({
    select: async () => [{_id: '507f1f77bcf86cd799439011'}],
  }));
  const attachment = '507f1f77bcf86cd799439011';
  const payload = {
    session_id: 's',
    messages: [
      {role: 'user' as const, text: 'Photo', attachments: [attachment]},
    ],
  };
  assert.equal(
    addMessageToMemorySchema.safeParse({body: payload}).success,
    true,
  );
  assert.deepEqual(
    (await checkVoiceMessageAccess(payload, 'user')).attachmentIds,
    [attachment],
  );
  assert.equal(
    addMessageToMemorySchema.safeParse({
      body: {
        ...payload,
        messages: [{...payload.messages[0], attachments: ['invalid']}],
      },
    }).success,
    false,
  );
});
