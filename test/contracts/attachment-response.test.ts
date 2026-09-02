import {describe, expect, it} from 'vitest';
import {
  applyAttachmentContract,
  serializeAttachment,
} from '../../src/utils/attachment-response';

describe('attachment response contract', () => {
  it('preserves field names while issuing signed original and thumbnail URLs', () => {
    const response = serializeAttachment({
      _id: '507f1f77bcf86cd799439011',
      name: 'users/owner/photo.jpg',
      thumbnail_key: 'thumbnails/users/owner/photo.jpg',
      thumbnail: 'https://legacy.invalid/thumbnail.jpg',
      backup_url: 'https://provider.invalid/private-object',
      type: 'image/jpeg',
      size: 1024,
      status: 'ready',
    })!;
    const originalUrl = new URL(response.url);
    const thumbnailUrl = new URL(response.thumbnail!);

    expect(originalUrl.searchParams.get('fid')).toBe(
      '507f1f77bcf86cd799439011',
    );
    expect(originalUrl.searchParams.get('variant')).toBe('original');
    expect(thumbnailUrl.searchParams.get('variant')).toBe('thumbnail');
    expect(response.access).toEqual({
      expires_at: expect.any(String),
      refresh_endpoint: '/files/507f1f77bcf86cd799439011/access',
    });
    expect(Object.keys(response)).toEqual([
      '_id',
      'url',
      'thumbnail',
      'name',
      'type',
      'duration',
      'width',
      'height',
      'size',
      'status',
      'access',
    ]);
  });

  it('does not expose provider backup URLs or durable derivative keys', () => {
    const transformed = applyAttachmentContract({
      _id: '507f1f77bcf86cd799439011',
      name: 'photo.jpg',
      type: 'image/jpeg',
      backup_url: 'https://provider.invalid/private-object',
      thumbnail_key: 'thumbnails/photo.jpg',
    });

    expect(transformed).not.toHaveProperty('backup_url');
    expect(transformed).not.toHaveProperty('thumbnail_key');
  });
});
