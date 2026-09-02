import request from 'supertest';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  resolveSentryIngestUrl,
  SentryTunnelPolicy,
} from '../../src/module/api/sentry_tunnel/policy';
import {createTestApp} from '../helpers/app';

const policy: SentryTunnelPolicy = {
  allowedHosts: new Set(['o123.ingest.sentry.io']),
  allowedProjectIds: new Set(['456']),
  maxEnvelopeBytes: 1024,
};

function envelope(dsn: string, item = '{}'): Buffer {
  return Buffer.from(`${JSON.stringify({dsn})}\n${item}`);
}

describe('Sentry tunnel destination policy', () => {
  it('resolves an allowlisted Sentry DSN without forwarding credentials', () => {
    expect(
      resolveSentryIngestUrl(
        envelope('https://public-key@o123.ingest.sentry.io/456'),
        policy,
      ).toString(),
    ).toBe('https://o123.ingest.sentry.io/api/456/envelope/');
  });

  it.each([
    ['HTTP', 'http://public-key@o123.ingest.sentry.io/456'],
    ['unlisted host', 'https://public-key@attacker.invalid/456'],
    ['loopback host', 'https://public-key@127.0.0.1/456'],
    ['internal host', 'https://public-key@metadata.internal/456'],
    ['password', 'https://public-key:secret@o123.ingest.sentry.io/456'],
    ['missing public key', 'https://o123.ingest.sentry.io/456'],
    ['non-443 port', 'https://public-key@o123.ingest.sentry.io:444/456'],
    ['unlisted project', 'https://public-key@o123.ingest.sentry.io/999'],
    [
      'query confusion',
      'https://public-key@o123.ingest.sentry.io/456?next=evil',
    ],
    ['fragment confusion', 'https://public-key@o123.ingest.sentry.io/456#evil'],
  ])('rejects %s', (_label, dsn) => {
    expect(() => resolveSentryIngestUrl(envelope(dsn), policy)).toThrow();
  });

  it.each([
    Buffer.from('not-json\n{}'),
    Buffer.from('{}\n{}'),
    Buffer.from('{"dsn":"https://public-key@o123.ingest.sentry.io/456"}\r\n{}'),
    Buffer.from('{"dsn":123}\n{}'),
  ])('rejects malformed or confusing envelope headers', value => {
    expect(() => resolveSentryIngestUrl(value, policy)).toThrow();
  });

  it('rejects oversized envelopes before parsing destinations', () => {
    expect(() =>
      resolveSentryIngestUrl(
        envelope(
          'https://public-key@o123.ingest.sentry.io/456',
          'x'.repeat(2000),
        ),
        policy,
      ),
    ).toThrow();
  });
});

describe('Sentry tunnel relay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('relays only the envelope and returns only the upstream status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('upstream body must not leak', {status: 202}),
      );
    vi.stubGlobal('fetch', fetchMock);
    const body = envelope('https://public-key@o123.ingest.sentry.io/456');

    const response = await request(createTestApp())
      .post('/sentry_tunnel')
      .set('Content-Type', 'application/x-sentry-envelope')
      .send(body.toString('utf8'));

    expect(response.status).toBe(202);
    expect(response.text).toBe('');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://o123.ingest.sentry.io/api/456/envelope/',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(Buffer),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects an unlisted destination without outbound work', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(createTestApp())
      .post('/sentry_tunnel')
      .set('Content-Type', 'application/x-sentry-envelope')
      .send(
        envelope('https://public-key@attacker.invalid/456').toString('utf8'),
      );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
