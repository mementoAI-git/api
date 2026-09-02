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

const {deleteFileFromS3, uploadToS3} = vi.hoisted(() => ({
  deleteFileFromS3: vi.fn(async () => undefined),
  uploadToS3: vi.fn(),
}));

vi.mock('../../src/services/storage/s3', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/services/storage/s3')>()),
  deleteFileFromS3,
  uploadToS3,
}));

import {
  persistUploadedFiles,
  removeFile,
} from '../../src/module/api/file/service';
import {uploadPicture} from '../../src/module/api/user/service';
import {replyPrompt} from '../../src/module/api/prompt/service';
import {getStorageUsageSummary} from '../../src/module/api/billing/storage-quota';
import File from '../../src/module/database/model/file';
import StorageReservation from '../../src/module/database/model/storage-reservation';
import Prompt from '../../src/module/database/model/prompt';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

function textUpload(name: string, contents: string): Express.Multer.File {
  const buffer = Buffer.from(contents);
  return {
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: 'text/plain',
    size: buffer.length,
    buffer,
    stream: null as never,
    destination: '',
    filename: '',
    path: '',
  };
}

function imageUpload(): Express.Multer.File {
  const file = textUpload('pixel.png', '');
  file.mimetype = 'image/png';
  file.buffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  file.size = file.buffer.length;
  return file;
}

describe('uploaded file storage reservations', () => {
  beforeAll(connectTestReplicaSet);
  beforeEach(() => {
    uploadToS3.mockReset();
    deleteFileFromS3.mockReset();
    deleteFileFromS3.mockResolvedValue(undefined);
  });
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('returns the committed files when an upload idempotency key is replayed', async () => {
    const user = await createUserFixture();
    uploadToS3.mockImplementation(async (key: string, buffer: Buffer) => ({
      key,
      location: `https://provider.invalid/${key}`,
      size: buffer.length,
    }));

    const first = await persistUploadedFiles(
      [textUpload('journal.txt', 'a small memory')],
      user.id,
      undefined,
      'upload-replay',
    );
    const replay = await persistUploadedFiles(
      [textUpload('journal.txt', 'a small memory')],
      user.id,
      undefined,
      'upload-replay',
    );

    expect(replay.map(file => file.id)).toEqual(first.map(file => file.id));
    expect(await File.countDocuments({user: user.id})).toBe(1);
    expect(uploadToS3).toHaveBeenCalledTimes(1);
  });

  it('rejects idempotency-key reuse for different equal-sized content', async () => {
    const user = await createUserFixture();
    uploadToS3.mockImplementation(async (key: string, buffer: Buffer) => ({
      key,
      location: `https://provider.invalid/${key}`,
      size: buffer.length,
    }));

    await persistUploadedFiles(
      [textUpload('journal.txt', 'first')],
      user.id,
      undefined,
      'upload-content-conflict',
    );

    await expect(
      persistUploadedFiles(
        [textUpload('journal.txt', 'other')],
        user.id,
        undefined,
        'upload-content-conflict',
      ),
    ).rejects.toMatchObject({statusCode: 409});
    expect(uploadToS3).toHaveBeenCalledTimes(1);
  });

  it('releases accounted storage when an unreferenced file is deleted', async () => {
    const user = await createUserFixture();
    uploadToS3.mockImplementation(async (key: string) => ({
      key,
      location: `https://provider.invalid/${key}`,
    }));
    const [file] = await persistUploadedFiles(
      [textUpload('temporary.txt', 'temporary bytes')],
      user.id,
    );

    await removeFile(file.name, user.id);

    expect(await getStorageUsageSummary(user.id)).toMatchObject({
      used_bytes: 0,
      reserved_bytes: 0,
    });
  });

  it('accounts for profile-picture uploads through the durable file contract', async () => {
    const user = await createUserFixture();
    uploadToS3.mockImplementation(async (key: string) => ({
      key,
      location: `https://provider.invalid/${key}`,
    }));

    const {data} = await uploadPicture(
      [textUpload('portrait.txt', 'profile image bytes')],
      user.id,
    );

    expect(data).toMatchObject({access_mode: 'signed_only'});
    expect(await getStorageUsageSummary(user.id)).toMatchObject({
      used_bytes: Buffer.byteLength('profile image bytes'),
      reserved_bytes: 0,
    });
  });

  it('accounts for prompt-response attachments through the durable file contract', async () => {
    const user = await createUserFixture();
    const prompt = await Prompt.create({
      title: 'A favorite day',
      type: 'story',
      category: 'reflection',
      tags: [],
    });
    uploadToS3.mockImplementation(async (key: string) => ({
      key,
      location: `https://provider.invalid/${key}`,
    }));

    const {data} = await replyPrompt(
      {
        prompt_id: prompt.id,
        body: 'The answer',
        tags: [],
        level: 1,
        attachments: [],
      },
      user.id,
      [textUpload('answer.txt', 'prompt attachment')],
    );

    const attachment = await File.findById(data?.attachments[0]);
    expect(attachment).toMatchObject({access_mode: 'signed_only'});
    expect(await getStorageUsageSummary(user.id)).toMatchObject({
      used_bytes: Buffer.byteLength('prompt attachment'),
      reserved_bytes: 0,
    });
  });

  it('removes partial database and provider writes when file persistence fails', async () => {
    const user = await createUserFixture();
    uploadToS3.mockResolvedValue({
      key: 'duplicate-object-key',
      location: 'https://provider.invalid/duplicate-object-key',
    });

    await expect(
      persistUploadedFiles(
        [textUpload('first.txt', 'first'), textUpload('second.txt', 'second')],
        user.id,
        undefined,
        'upload-rollback',
      ),
    ).rejects.toBeDefined();

    expect(await File.countDocuments({user: user.id})).toBe(0);
    expect(
      await StorageReservation.findOne({
        reservation_id: 'upload-rollback',
      }).lean(),
    ).toMatchObject({
      status: 'released',
    });
    expect(await getStorageUsageSummary(user.id)).toMatchObject({
      used_bytes: 0,
      reserved_bytes: 0,
    });
    expect(deleteFileFromS3).toHaveBeenCalledWith(
      'duplicate-object-key',
      'both',
    );
  });

  it('records a durable cleanup retry when batch rollback deletion fails', async () => {
    const user = await createUserFixture();
    uploadToS3.mockResolvedValue({
      key: 'orphaned-duplicate-key',
      location: 'https://provider.invalid/orphaned-duplicate-key',
    });
    deleteFileFromS3.mockRejectedValueOnce(new Error('cleanup unavailable'));

    await expect(
      persistUploadedFiles(
        [textUpload('first.txt', 'first'), textUpload('second.txt', 'second')],
        user.id,
        undefined,
        'upload-cleanup-retry',
      ),
    ).rejects.toBeDefined();

    expect(
      await File.findOne({
        user: user.id,
        name: 'orphaned-duplicate-key',
        deleted: true,
      }).lean(),
    ).toMatchObject({
      type: 'text/plain',
      size: 0,
      status: 'failed',
      access_mode: 'signed_only',
    });
  });

  it('waits for concurrent provider uploads before cleaning up a failed batch', async () => {
    const user = await createUserFixture();
    let finishFirstUpload:
      | ((value: {key: string; location: string}) => void)
      | undefined;
    uploadToS3
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishFirstUpload = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('provider unavailable'));

    const uploading = persistUploadedFiles(
      [textUpload('first.txt', 'first'), textUpload('second.txt', 'second')],
      user.id,
      undefined,
      'upload-provider-rollback',
    );
    const rejectedUpload = expect(uploading).rejects.toThrow(
      'provider unavailable',
    );
    await vi.waitFor(() => expect(uploadToS3).toHaveBeenCalledTimes(2));
    const firstKey = String(uploadToS3.mock.calls[0][0]);
    finishFirstUpload?.({
      key: firstKey,
      location: `https://provider.invalid/${firstKey}`,
    });
    await rejectedUpload;
    await vi.waitFor(() =>
      expect(deleteFileFromS3).toHaveBeenCalledWith(firstKey, 'both'),
    );
  });

  it('removes a generated thumbnail when the primary object upload fails', async () => {
    const user = await createUserFixture();
    uploadToS3
      .mockResolvedValueOnce({
        key: 'thumbnail-key',
        location: 'https://provider.invalid/thumbnail-key',
      })
      .mockRejectedValueOnce(new Error('primary upload failed'));

    await expect(
      persistUploadedFiles(
        [imageUpload()],
        user.id,
        undefined,
        'upload-thumbnail-rollback',
      ),
    ).rejects.toThrow('primary upload failed');

    expect(deleteFileFromS3).toHaveBeenCalledWith(
      expect.stringMatching(/^thumb_pixel_/),
      'both',
    );
  });

  it('records a durable cleanup retry when derivative deletion fails', async () => {
    const user = await createUserFixture();
    uploadToS3
      .mockResolvedValueOnce({
        key: 'thumbnail-key',
        location: 'https://provider.invalid/thumbnail-key',
      })
      .mockRejectedValueOnce(new Error('primary upload failed'));
    deleteFileFromS3.mockRejectedValueOnce(new Error('cleanup unavailable'));

    await expect(
      persistUploadedFiles(
        [imageUpload()],
        user.id,
        undefined,
        'upload-thumbnail-cleanup-retry',
      ),
    ).rejects.toThrow('primary upload failed');

    expect(
      await File.findOne({
        user: user.id,
        name: {$regex: /^thumb_pixel_/},
        deleted: true,
      }).lean(),
    ).toMatchObject({
      type: 'image/jpeg',
      size: 0,
      status: 'failed',
      access_mode: 'signed_only',
    });
  });
});
