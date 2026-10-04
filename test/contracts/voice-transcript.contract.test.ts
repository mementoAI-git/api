import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import Memory from '../../src/module/database/model/memory';
import Message from '../../src/module/database/model/message';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

describe('voice call transcript contract', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('preserves multiline transcript text and voice metadata through retrieval', async () => {
    const user = await createUserFixture();
    const token = issueLegacyAccessToken(user);
    const memory = await Memory.create({
      user: user.id,
      title: 'Voice conversation',
      type: 'conversation',
      status: 'save',
    });
    const transcript = [
      'Voice call completed (02:15)',
      '',
      '--- Transcript ---',
      'You: I was thinking about home.',
      'Memento: What part of home feels most vivid?',
    ].join('\n');

    const createResponse = await request(createTestApp())
      .post('/memories/add-message')
      .set('Authorization', `Bearer ${token}`)
      .send({
        memory_id: memory.id,
        session_id: 'voice-session-1',
        messages: [
          {
            role: 'ai',
            text: transcript,
            is_voice: true,
            duration: 135,
          },
        ],
      });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body.data).toHaveLength(1);
    expect(createResponse.body.data[0]).toMatchObject({
      text: transcript,
      role: 'ai',
      is_voice: true,
      duration: 135,
    });

    const getResponse = await request(createTestApp())
      .get(`/ai/prompt/messages/${memory.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.messages).toHaveLength(1);
    expect(getResponse.body.data.messages[0]).toMatchObject({
      text: transcript,
      role: 'ai',
      is_voice: true,
      duration: 135,
    });
    expect(await Message.countDocuments({memory: memory.id})).toBe(1);
  });

  it.each(['', '   \n\t  '])(
    'rejects an empty transcript instead of storing an empty card',
    async text => {
      const user = await createUserFixture();
      const token = issueLegacyAccessToken(user);

      const response = await request(createTestApp())
        .post('/memories/add-message')
        .set('Authorization', `Bearer ${token}`)
        .send({
          session_id: 'voice-session-empty',
          messages: [{role: 'ai', text, is_voice: true, duration: 12}],
        });

      expect(response.status).toBe(422);
      expect(await Message.countDocuments()).toBe(0);
    },
  );
});
