import {Readable} from 'stream';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

const storage = vi.hoisted(() => ({
  getFile: vi.fn(),
  uploadToS3: vi.fn(),
  generatePresignedUrl: vi.fn(),
  queueArchiveExport: vi.fn(async () => true),
  uploadedBody: Buffer.alloc(0),
}));

vi.mock('../../src/services/storage', () => ({
  getFile: storage.getFile,
}));
vi.mock('../../src/services/storage/s3', () => ({
  uploadToS3: storage.uploadToS3,
  generatePresignedUrl: storage.generatePresignedUrl,
}));
vi.mock('../../src/services/queues/system', () => ({
  queueArchiveExport: storage.queueArchiveExport,
}));

import {
  buildArchiveExport,
  createArchiveExport,
  getArchiveDownload,
  getArchiveExport,
} from '../../src/module/api/archive/service';
import ArchiveExport from '../../src/module/database/model/archive-export';
import Capsule from '../../src/module/database/model/capsule';
import File from '../../src/module/database/model/file';
import Memory from '../../src/module/database/model/memory';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('archive export', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.clearAllMocks();
    storage.uploadedBody = Buffer.alloc(0);
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('builds every owned story, capsule, and readable attachment into one ZIP', async () => {
    const user = await createUserFixture();
    const owned = await File.create({
      user: user.id,
      name: 'owned-photo.jpg',
      type: 'image/jpeg',
      provider: 's3',
      size: 5,
    });
    const foreignUser = await createUserFixture();
    const foreign = await File.create({
      user: foreignUser.id,
      name: 'foreign-photo.jpg',
      type: 'image/jpeg',
      provider: 's3',
      size: 7,
    });
    await Memory.create([
      {
        user: user.id,
        type: 'story',
        status: 'save',
        title: 'First story',
        body: '<p>First body</p>',
        attachments: [owned.id, foreign.id],
      },
      {
        user: user.id,
        type: 'story',
        status: 'save',
        title: 'Second story',
        body: '<p>Second body</p>',
      },
    ]);
    await Capsule.create({
      user: user.id,
      title: 'Future letter',
      body: 'Full capsule body',
      status: 'draft',
      attachments: [owned.id],
    });
    storage.getFile.mockResolvedValue({
      Body: Readable.from([Buffer.from('photo')]),
      ContentType: 'image/jpeg',
    });
    storage.uploadToS3.mockImplementation(async (_key, body) => {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      storage.uploadedBody = Buffer.concat(chunks);
      return {key: 'archive.zip'};
    });

    const created = await createArchiveExport(user.id);
    await buildArchiveExport(created.data.id);

    expect(storage.queueArchiveExport).toHaveBeenCalledWith(created.data.id);
    expect(storage.getFile).toHaveBeenCalledTimes(1);
    expect(storage.getFile).toHaveBeenCalledWith(
      'owned-photo.jpg',
      undefined,
      's3',
      'image/jpeg',
    );
    const uploaded = storage.uploadToS3.mock.calls[0];
    expect(uploaded[0]).toContain(`exports/${user.id}/`);
    expect(typeof uploaded[1].pipe).toBe('function');
    expect(storage.uploadedBody.subarray(0, 2).toString()).toBe('PK');
    const completed = await ArchiveExport.findById(created.data.id).lean();
    expect(completed).toMatchObject({
      status: 'complete',
      progress: {
        stories_total: 2,
        stories_exported: 2,
        capsules_total: 1,
        capsules_exported: 1,
        attachments_total: 2,
        attachments_exported: 1,
      },
    });
    expect(completed?.warnings).toContain(
      '1 attachment record(s) were unavailable.',
    );
  });

  it('scopes status and download URLs to the authenticated owner', async () => {
    const owner = await createUserFixture();
    const stranger = await createUserFixture();
    const job = await ArchiveExport.create({
      user_id: owner.id,
      status: 'complete',
      object_key: `exports/${owner.id}/archive.zip`,
      expires_at: new Date(Date.now() + 60_000),
    });
    storage.generatePresignedUrl.mockResolvedValue(
      'https://signed.example/archive',
    );

    await expect(getArchiveExport(stranger.id, job.id)).rejects.toThrow(
      'Archive export not found',
    );
    await expect(getArchiveDownload(stranger.id, job.id)).rejects.toThrow(
      'Archive is not ready',
    );
    await expect(getArchiveDownload(owner.id, job.id)).resolves.toMatchObject({
      data: {url: 'https://signed.example/archive'},
    });
  });

  it('records attachment stream failures as visible warnings', async () => {
    const user = await createUserFixture();
    const file = await File.create({
      user: user.id,
      name: 'missing.jpg',
      type: 'image/jpeg',
      provider: 's3',
      size: 5,
    });
    await Memory.create({
      user: user.id,
      type: 'story',
      status: 'save',
      title: 'Story',
      attachments: [file.id],
    });
    storage.getFile.mockRejectedValue(new Error('provider unavailable'));
    storage.uploadToS3.mockResolvedValue({key: 'archive.zip'});
    const created = await createArchiveExport(user.id);

    await buildArchiveExport(created.data.id);

    expect(await ArchiveExport.findById(created.data.id).lean()).toMatchObject({
      status: 'complete',
      progress: {attachments_total: 1, attachments_exported: 0},
      warnings: [`Attachment ${file.id} could not be included.`],
    });
  });
});
