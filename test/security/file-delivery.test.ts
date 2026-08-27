import {Readable} from 'stream';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getFile: vi.fn(),
  getFileMetadata: vi.fn(),
}));

vi.mock('../../src/services/storage', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/services/storage')>()),
  getFile: storageMocks.getFile,
  getFileMetadata: storageMocks.getFileMetadata,
}));

import File from '../../src/module/database/model/file';
import Memory from '../../src/module/database/model/memory';
import {signFileUrl} from '../../src/services/storage/file-capability';
import {createTestApp} from '../helpers/app';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

describe('signed file delivery', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  beforeEach(() => {
    storageMocks.getFileMetadata.mockReset().mockResolvedValue({
      size: 10,
      etag: 'test-etag',
      lastModified: new Date('2026-08-27T12:00:00.000Z'),
    });
    storageMocks.getFile.mockReset().mockImplementation(async () => ({
      Body: Readable.from(Buffer.from('0123456789')),
    }));
  });

  async function createFileFixture(
    accessMode: 'legacy_public' | 'signed_only' = 'signed_only',
  ) {
    const owner = await createUserFixture();
    const file = await File.create({
      user: owner.id,
      name: 'users/owner/photo.jpg',
      thumbnail_key: 'thumbnails/users/owner/photo.jpg',
      type: 'image/jpeg',
      size: 10,
      provider: 's3',
      access_mode: accessMode,
    });
    return {owner, file};
  }

  function capabilityUrl(
    fileId: string,
    objectKey: string,
    variant: 'original' | 'thumbnail' = 'original',
    ttlSeconds = 3600,
  ) {
    return signFileUrl({fileId, objectKey, variant, ttlSeconds}).url;
  }

  it('delivers a signed original with private, expiry-bounded caching', async () => {
    const {file} = await createFileFixture();
    const response = await request(createTestApp()).get(
      new URL(capabilityUrl(file.id, file.name)).pathname +
        new URL(capabilityUrl(file.id, file.name)).search,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(Buffer.from('0123456789'));
    expect(response.headers['cache-control']).toMatch(
      /^private, max-age=3\d{3}$/,
    );
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(storageMocks.getFileMetadata).toHaveBeenCalledWith(
      file.name,
      's3',
      'image/jpeg',
    );
  });

  it('honors an explicit byte range', async () => {
    const {file} = await createFileFixture();
    const signed = new URL(capabilityUrl(file.id, file.name));
    storageMocks.getFile.mockResolvedValueOnce({
      Body: Readable.from(Buffer.from('0123')),
    });

    const response = await request(createTestApp())
      .get(signed.pathname + signed.search)
      .set('Range', 'bytes=0-3');

    expect(response.status).toBe(206);
    expect(response.headers['content-range']).toBe('bytes 0-3/10');
    expect(response.headers['content-length']).toBe('4');
    expect(storageMocks.getFile).toHaveBeenCalledWith(
      file.name,
      'bytes=0-3',
      's3',
      'image/jpeg',
    );
  });

  it('allows only configured browser origins without affecting native requests', async () => {
    const {file} = await createFileFixture();
    const signed = new URL(capabilityUrl(file.id, file.name));

    const allowed = await request(createTestApp())
      .get(signed.pathname + signed.search)
      .set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(allowed.headers.vary).toContain('Origin');

    const disallowed = await request(createTestApp())
      .get(signed.pathname + signed.search)
      .set('Origin', 'https://attacker.invalid');
    expect(disallowed.status).toBe(403);
    expect(disallowed.headers).not.toHaveProperty(
      'access-control-allow-origin',
    );
  });

  it.each(['tampered', 'expired', 'unknown-key', 'malformed-file-id'])(
    'rejects a %s capability before storage access',
    async mode => {
      const {file} = await createFileFixture();
      const signed = new URL(
        capabilityUrl(
          file.id,
          file.name,
          'original',
          mode === 'expired' ? -1 : 3600,
        ),
      );
      if (mode === 'tampered') signed.searchParams.set('sig', 'invalid');
      if (mode === 'unknown-key') signed.searchParams.set('kid', 'unknown');
      if (mode === 'malformed-file-id')
        signed.searchParams.set('fid', 'invalid');

      const response = await request(createTestApp()).get(
        signed.pathname + signed.search,
      );

      expect(response.status).toBe(403);
      expect(storageMocks.getFileMetadata).not.toHaveBeenCalled();
      expect(storageMocks.getFile).not.toHaveBeenCalled();
    },
  );

  it('rejects a bare signed-only request but temporarily permits legacy files', async () => {
    const signedOnly = await createFileFixture();
    const signedResponse = await request(createTestApp()).get(
      `/files/${encodeURIComponent(signedOnly.file.name)}`,
    );
    expect(signedResponse.status).toBe(403);

    await clearTestDatabase();
    const legacy = await createFileFixture('legacy_public');
    const legacyResponse = await request(createTestApp()).get(
      `/files/${encodeURIComponent(legacy.file.name)}`,
    );
    expect(legacyResponse.status).toBe(200);
  });

  it('binds thumbnail access to the owning file and exact derivative key', async () => {
    const {file} = await createFileFixture();
    const signed = new URL(
      capabilityUrl(file.id, file.thumbnail_key!, 'thumbnail'),
    );

    const response = await request(createTestApp()).get(
      signed.pathname + signed.search,
    );
    expect(response.status).toBe(200);
    expect(storageMocks.getFileMetadata).toHaveBeenCalledWith(
      file.thumbnail_key,
      's3',
      'image/jpeg',
    );

    const arbitrary = await request(createTestApp()).get(
      '/files/thumbnails%2Fusers%2Fsomeone-else%2Fphoto.jpg',
    );
    expect(arbitrary.status).not.toBe(200);
  });

  it('refreshes for the owner but not for another user who only knows the id', async () => {
    const {owner, file} = await createFileFixture();
    const stranger = await createUserFixture();

    const ownerResponse = await request(createTestApp())
      .post(`/files/${file.id}/access`)
      .set('Authorization', `Bearer ${issueLegacyAccessToken(owner)}`);
    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.body.data.url).toContain(`fid=${file.id}`);

    const strangerResponse = await request(createTestApp())
      .post(`/files/${file.id}/access`)
      .set('Authorization', `Bearer ${issueLegacyAccessToken(stranger)}`);
    expect(strangerResponse.status).toBe(404);
  });

  it('refreshes for a reader only with a readable memory that references the file', async () => {
    const {file} = await createFileFixture();
    const reader = await createUserFixture();
    const memory = await Memory.create({
      user: file.user,
      title: 'Shared memory',
      status: 'save',
      visibility: 'everyone',
      attachments: [file.id],
    });

    const response = await request(createTestApp())
      .post(`/files/${file.id}/access`)
      .set('Authorization', `Bearer ${issueLegacyAccessToken(reader)}`)
      .send({memory_id: memory.id});

    expect(response.status).toBe(200);
    expect(response.body.data.access.refresh_endpoint).toBe(
      `/files/${file.id}/access`,
    );
  });
});
