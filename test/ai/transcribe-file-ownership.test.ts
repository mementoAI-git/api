import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import File from '../../src/module/database/model/file';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

/** A voice note whose transcript is already cached, so no model is called. */
async function voiceNote(ownerId: string) {
  return File.create({
    user: ownerId,
    name: `voice-${ownerId}.webm`,
    type: 'audio/webm',
    size: 1024,
    url: 'https://provider.invalid/voice.webm',
    provider: 's3',
    transcription: {full_text: 'A private memory.'},
  });
}

const transcribe = (token: string, fileId: string) =>
  request(createTestApp())
    .post('/ai/transcribe-audio')
    .set('Authorization', `Bearer ${token}`)
    .send({file_id: fileId});

describe('POST /ai/transcribe-audio with a stored file', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it("gives the owner their recording's transcript", async () => {
    const owner = await createUserFixture();
    const file = await voiceNote(owner.id);

    const response = await transcribe(issueLegacyAccessToken(owner), file.id);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      full_text: 'A private memory.',
    });
  });

  it("does not reveal someone else's recording", async () => {
    const owner = await createUserFixture();
    const stranger = await createUserFixture();
    const file = await voiceNote(owner.id);

    const response = await transcribe(
      issueLegacyAccessToken(stranger),
      file.id,
    );

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('A private memory');
  });
});
