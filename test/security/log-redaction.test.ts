import {describe, expect, it} from 'vitest';
import {
  redactSensitiveQuery,
  sanitizeUrlForLogs,
} from '../../src/utils/sanitize-url';

describe('capability log redaction', () => {
  it('redacts secrets without hiding useful request identity', () => {
    const sanitized = sanitizeUrlForLogs(
      '/files/photo.jpg?fid=file-1&sig=secret&token=bearer&code=invite',
    );
    const parsed = new URL(sanitized, 'http://localhost');

    expect(parsed.pathname).toBe('/files/photo.jpg');
    expect(parsed.searchParams.get('fid')).toBe('file-1');
    expect(parsed.searchParams.get('sig')).toBe('[REDACTED]');
    expect(parsed.searchParams.get('token')).toBe('[REDACTED]');
    expect(parsed.searchParams.get('code')).toBe('[REDACTED]');
  });

  it('redacts the structured query logged by the HTTP serializer', () => {
    expect(
      redactSensitiveQuery({fid: 'file-1', sig: 'secret', variant: 'original'}),
    ).toEqual({fid: 'file-1', sig: '[REDACTED]', variant: 'original'});
  });
});
