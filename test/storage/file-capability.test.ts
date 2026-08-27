import {createHmac} from 'crypto';
import {describe, expect, it} from 'vitest';
import {
  signFileUrl,
  verifyFileCapability,
} from '../../src/services/storage/file-capability';

describe('file capabilities', () => {
  it('signs a time-limited URL that verifies for the exact file', () => {
    const signed = signFileUrl({
      fileId: '507f1f77bcf86cd799439011',
      objectKey: 'users/owner/photo.jpg',
      variant: 'original',
      ttlSeconds: 300,
    });
    const url = new URL(signed.url);
    const exp = Number(url.searchParams.get('exp'));

    expect(url.pathname).toBe('/files/users%2Fowner%2Fphoto.jpg');
    expect(url.searchParams.get('fid')).toBe('507f1f77bcf86cd799439011');
    expect(url.searchParams.get('kid')).toBe('test-v1');
    expect(url.searchParams.get('variant')).toBe('original');
    expect(
      verifyFileCapability({
        fileId: '507f1f77bcf86cd799439011',
        objectKey: 'users/owner/photo.jpg',
        variant: 'original',
        exp,
        kid: 'test-v1',
        signature: url.searchParams.get('sig')!,
        now: exp - 1,
      }),
    ).toBe(true);
    expect(new Date(signed.expiresAt).getTime()).toBe(exp * 1000);
  });

  it.each([
    ['file ID', {fileId: '507f1f77bcf86cd799439012'}],
    ['object key', {objectKey: 'users/owner/other.jpg'}],
    ['variant', {variant: 'thumbnail' as const}],
  ])('rejects a changed %s', (_label, changes) => {
    const signed = signFileUrl({
      fileId: '507f1f77bcf86cd799439011',
      objectKey: 'users/owner/photo.jpg',
      variant: 'original',
    });
    const url = new URL(signed.url);
    const exp = Number(url.searchParams.get('exp'));

    expect(
      verifyFileCapability({
        fileId: '507f1f77bcf86cd799439011',
        objectKey: 'users/owner/photo.jpg',
        variant: 'original',
        exp,
        kid: 'test-v1',
        signature: url.searchParams.get('sig')!,
        now: exp - 1,
        ...changes,
      }),
    ).toBe(false);
  });

  it('rejects expired, unknown-key, and malformed capabilities', () => {
    const signed = signFileUrl({
      fileId: '507f1f77bcf86cd799439011',
      objectKey: 'photo.jpg',
      variant: 'original',
      ttlSeconds: 60,
    });
    const url = new URL(signed.url);
    const exp = Number(url.searchParams.get('exp'));
    const base = {
      fileId: '507f1f77bcf86cd799439011',
      objectKey: 'photo.jpg',
      variant: 'original' as const,
      exp,
      signature: url.searchParams.get('sig')!,
    };

    expect(verifyFileCapability({...base, kid: 'test-v1', now: exp + 1})).toBe(
      false,
    );
    expect(verifyFileCapability({...base, kid: 'unknown', now: exp - 1})).toBe(
      false,
    );
    expect(() =>
      verifyFileCapability({
        ...base,
        kid: 'test-v1',
        signature: 'not-a-valid-signature',
        now: exp - 1,
      }),
    ).not.toThrow();
    expect(
      verifyFileCapability({
        ...base,
        kid: 'test-v1',
        signature: 'not-a-valid-signature',
        now: exp - 1,
      }),
    ).toBe(false);
  });

  it('verifies a capability signed by the previous rotation key', () => {
    const exp = 2_000_000_000;
    const payload = [
      '507f1f77bcf86cd799439011',
      'photo.jpg',
      'original',
      exp,
      'test-v0',
    ].join('\n');
    const signature = createHmac(
      'sha256',
      'test-previous-file-signing-secret-at-least-32-characters',
    )
      .update(payload)
      .digest('base64url');

    expect(
      verifyFileCapability({
        fileId: '507f1f77bcf86cd799439011',
        objectKey: 'photo.jpg',
        variant: 'original',
        exp,
        kid: 'test-v0',
        signature,
        now: exp - 1,
      }),
    ).toBe(true);
  });
});
