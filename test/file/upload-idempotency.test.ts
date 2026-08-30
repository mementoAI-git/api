import {describe, expect, it} from 'vitest';
import {resolveUploadReservationId} from '../../src/module/api/file/upload-idempotency';

describe('upload idempotency keys', () => {
  it('uses a bounded client key and falls back to the server request id', () => {
    expect(
      resolveUploadReservationId(' upload.abc-123 ', 'request-id', 'memory'),
    ).toBe('memory:upload.abc-123');
    expect(resolveUploadReservationId(undefined, 'request-id', 'memory')).toBe(
      'memory:request-id',
    );
    expect(resolveUploadReservationId(undefined, undefined)).toBeUndefined();
  });

  it('separates the same client key across upload operations', () => {
    expect(
      resolveUploadReservationId('same-key', 'request-id', 'profile'),
    ).not.toBe(resolveUploadReservationId('same-key', 'request-id', 'memory'));
  });

  it('rejects oversized or unsafe client keys instead of storing them', () => {
    expect(() =>
      resolveUploadReservationId('x'.repeat(129), 'request-id'),
    ).toThrow(/idempotency key/i);
    expect(() =>
      resolveUploadReservationId('unsafe key/with spaces', 'request-id'),
    ).toThrow(/idempotency key/i);
  });
});
