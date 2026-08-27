import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import File from '../../src/module/database/model/file';
import {
  backfillThumbnailKeys,
  extractThumbnailKey,
} from '../../src/scripts/backfill-thumbnail-keys';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';

const BACKEND_URL = 'https://api.mymemento.io';

describe('thumbnail key backfill', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it.each([
    ['https://api.mymemento.io/files/thumb_photo.jpg', 'thumb_photo.jpg'],
    [
      'https://api.mymemento.io/files/thumbnails%2Fusers%2Fowner%2Fphoto.jpg?old=1',
      'thumbnails/users/owner/photo.jpg',
    ],
    ['/files/thumb_relative.jpg', 'thumb_relative.jpg'],
    ['thumb_raw.jpg', 'thumb_raw.jpg'],
    ['thumbnails/users/owner/raw.jpg', 'thumbnails/users/owner/raw.jpg'],
  ])('extracts a durable key from %s', (value, expected) => {
    expect(extractThumbnailKey(value, BACKEND_URL)).toBe(expected);
  });

  it.each([
    null,
    '',
    'https://res.cloudinary.com/demo/image/upload/thumb_photo.jpg',
    'https://storage.example.com/thumbnails/photo.jpg',
    'https://attacker.invalid/files/thumb_photo.jpg',
    'photo.jpg',
  ])('does not guess a key from %s', value => {
    expect(extractThumbnailKey(value, BACKEND_URL)).toBeNull();
  });

  it('defaults to dry-run, commits explicitly, and is idempotent', async () => {
    const recoverable = await File.create({
      user: '507f1f77bcf86cd799439011',
      name: 'photo.jpg',
      type: 'image/jpeg',
      size: 10,
      thumbnail:
        'https://api.mymemento.io/files/thumbnails%2Fusers%2Fowner%2Fphoto.jpg',
      access_mode: 'legacy_public',
    });
    await File.create({
      user: '507f1f77bcf86cd799439011',
      name: 'cloudinary-photo.jpg',
      type: 'image/jpeg',
      size: 10,
      thumbnail: 'https://res.cloudinary.com/demo/image/upload/thumb_photo.jpg',
    });

    const dryRun = await backfillThumbnailKeys({backendUrl: BACKEND_URL});
    expect(dryRun).toEqual({
      commit: false,
      scanned: 2,
      matched: 1,
      updated: 0,
      unmatched: 1,
    });
    expect((await File.findById(recoverable.id))?.thumbnail_key).toBeNull();

    const committed = await backfillThumbnailKeys({
      backendUrl: BACKEND_URL,
      commit: true,
    });
    expect(committed.updated).toBe(1);
    const updated = await File.findById(recoverable.id);
    expect(updated?.thumbnail_key).toBe('thumbnails/users/owner/photo.jpg');
    expect(updated?.access_mode).toBe('legacy_public');

    const rerun = await backfillThumbnailKeys({
      backendUrl: BACKEND_URL,
      commit: true,
    });
    expect(rerun).toMatchObject({scanned: 1, matched: 0, updated: 0});
  });
});
