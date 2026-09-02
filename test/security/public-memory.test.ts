import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import File from '../../src/module/database/model/file';
import Memory from '../../src/module/database/model/memory';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createTestApp} from '../helpers/app';
import {createUserFixture} from '../helpers/factories';

describe('public memory contract', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('returns a narrow anonymous projection for a public memory', async () => {
    const owner = await createUserFixture();
    const attachment = await File.create({
      user: owner.id,
      name: 'public-photo.jpg',
      type: 'image/jpeg',
      size: 512,
      provider: 's3',
      backup_url: 'https://storage.invalid/private-provider-url',
      transcription: {full_text: 'private transcript', segments: []},
    });
    const memory = await Memory.create({
      user: owner.id,
      title: 'A public story',
      body: '<p>User-authored story</p>',
      tags: ['family'],
      status: 'save',
      visibility: 'everyone',
      attachments: [attachment.id],
      summary: 'private AI summary',
      topics: ['private AI topic'],
      session_id: 'private-session',
      groups: ['private-group-id'],
      beneficiaries: ['private-beneficiary-id'],
      dimensions: ['private-dimension'],
    });

    const response = await request(createTestApp()).get(
      `/memories/public/${memory.id}`,
    );

    expect(response.status).toBe(200);
    const attachmentUrl = new URL(response.body.data.attachments[0].url);

    expect(response.body.data).toEqual({
      _id: memory.id,
      title: 'A public story',
      body: '<p>User-authored story</p>',
      tags: ['family'],
      created_at: expect.any(String),
      attachments: [
        {
          _id: attachment.id,
          url: expect.any(String),
          thumbnail: null,
          name: 'public-photo.jpg',
          type: 'image/jpeg',
          duration: null,
          width: null,
          height: null,
          size: 512,
          status: 'ready',
          access: {
            expires_at: expect.any(String),
            refresh_endpoint: `/files/${attachment.id}/access`,
          },
        },
      ],
    });
    expect(attachmentUrl.pathname).toBe('/files/public-photo.jpg');
    expect(attachmentUrl.searchParams.get('fid')).toBe(attachment.id);
    expect(attachmentUrl.searchParams.get('variant')).toBe('original');
    expect(attachmentUrl.searchParams.get('sig')).toBeTruthy();
  });

  it.each([
    ['private', 'save'],
    ['everyone', 'draft'],
    ['everyone', 'deleted'],
  ])(
    'returns 404 for visibility %s with status %s',
    async (visibility, status) => {
      const owner = await createUserFixture();
      const memory = await Memory.create({
        user: owner.id,
        title: 'Not public',
        status,
        visibility,
      });

      const response = await request(createTestApp()).get(
        `/memories/public/${memory.id}`,
      );

      expect(response.status).toBe(404);
    },
  );
});
