import {beforeEach, describe, expect, it, vi} from 'vitest';

const {uploadToS3} = vi.hoisted(() => ({
  uploadToS3: vi.fn(async (key: string) => ({
    key,
    location: `https://provider.invalid/${key}`,
  })),
}));

vi.mock('../../src/services/storage/s3', () => ({
  uploadToS3,
}));

import File from '../../src/module/database/model/file';
import {uploadFile} from '../../src/services/storage';

describe('stored file contract', () => {
  beforeEach(() => uploadToS3.mockClear());

  it('keeps legacy records public until the measured backfill', () => {
    const legacy = new File({
      user: '507f1f77bcf86cd799439011',
      name: 'legacy.txt',
      type: 'text/plain',
      size: 4,
    });

    expect(legacy.access_mode).toBe('legacy_public');
    expect(legacy.thumbnail_key).toBeNull();
  });

  it('marks every new upload signed-only and stores object identity', async () => {
    const uploaded = await uploadFile(
      {
        fieldname: 'file',
        originalname: 'note.txt',
        encoding: '7bit',
        mimetype: 'text/plain',
        size: 4,
        buffer: Buffer.from('note'),
        stream: null as never,
        destination: '',
        filename: '',
        path: '',
      },
      '507f1f77bcf86cd799439011',
    );

    expect(uploaded).toMatchObject({
      access_mode: 'signed_only',
      thumbnail_key: null,
      name: expect.any(String),
      provider: 's3',
    });
  });
});
