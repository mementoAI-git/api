import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import request from 'supertest';
import {createTestApp} from '../helpers/app';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';
import * as speech from '../../src/services/spoken-replies';

vi.mock('../../src/services/spoken-replies', () => ({
  synthesizeSpokenReply: vi.fn(),
}));

describe('spoken replies', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.clearAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('requires authentication before synthesis', async () => {
    const response = await request(createTestApp())
      .post('/ai/spoken-reply')
      .send({text: 'Hello'});
    expect(response.status).toBe(401);
    expect(speech.synthesizeSpokenReply).not.toHaveBeenCalled();
  });

  it('uses the authenticated user’s saved voice-mode preference', async () => {
    const user = await createUserFixture({
      chat_voice: 'sue',
      chat_voice_provider: 'gemini',
    });
    vi.mocked(speech.synthesizeSpokenReply).mockResolvedValue({
      audioBase64: 'YXVkaW8=',
      mimeType: 'audio/wav',
      voiceName: 'Kore',
    });
    const response = await request(createTestApp())
      .post('/ai/spoken-reply')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send({text: 'Hello, welcome back.'});
    expect(response.status).toBe(200);
    expect(speech.synthesizeSpokenReply).toHaveBeenCalledWith(
      'Hello, welcome back.',
      'Kore',
      expect.any(AbortSignal),
    );
    expect(response.body.data.voiceName).toBe('Kore');
  });

  it.each([
    {text: ''},
    {text: 'a'.repeat(2001)},
    {text: 'Hello', voiceName: 'untrusted'},
  ])('rejects invalid or client-selected voice input', async body => {
    const user = await createUserFixture();
    const response = await request(createTestApp())
      .post('/ai/spoken-reply')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(user)}`)
      .send(body);
    expect(response.status).toBe(422);
    expect(speech.synthesizeSpokenReply).not.toHaveBeenCalled();
  });
});
