import {isIP} from 'net';

export type SentryTunnelPolicy = {
  allowedHosts: Set<string>;
  allowedProjectIds: Set<string>;
  maxEnvelopeBytes?: number;
};

export class SentryTunnelPolicyError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

function reject(message: string, statusCode = 400): never {
  throw new SentryTunnelPolicyError(message, statusCode);
}

function isPrivateOrInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const [first, second] = host.split('.').map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  if (ipVersion === 6) {
    return (
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe8') ||
      host.startsWith('fe9') ||
      host.startsWith('fea') ||
      host.startsWith('feb')
    );
  }
  return false;
}

export function resolveSentryIngestUrl(
  envelope: Buffer,
  policy: SentryTunnelPolicy,
): URL {
  if (
    policy.maxEnvelopeBytes !== undefined &&
    envelope.length > policy.maxEnvelopeBytes
  ) {
    reject('Sentry envelope is too large', 413);
  }

  const newline = envelope.indexOf(0x0a);
  if (newline <= 0) reject('Malformed Sentry envelope');
  const headerBytes = envelope.subarray(0, newline);
  if (headerBytes.includes(0x0d)) reject('Malformed Sentry envelope');

  let header: unknown;
  try {
    header = JSON.parse(headerBytes.toString('utf8'));
  } catch {
    reject('Malformed Sentry envelope');
  }
  if (!header || typeof header !== 'object')
    reject('Malformed Sentry envelope');
  const dsn = (header as {dsn?: unknown}).dsn;
  if (typeof dsn !== 'string' || !dsn) reject('Missing Sentry DSN');

  let parsed: URL;
  try {
    parsed = new URL(dsn);
  } catch {
    reject('Invalid Sentry DSN');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:') reject('Sentry DSN must use HTTPS', 403);
  if (isPrivateOrInternalHost(hostname))
    reject('Sentry host is not allowed', 403);
  if (!policy.allowedHosts.has(hostname))
    reject('Sentry host is not allowed', 403);
  if (!parsed.username || !/^[A-Za-z0-9_-]+$/.test(parsed.username)) {
    reject('Sentry public key is required');
  }
  if (parsed.password) reject('Sentry DSN secret is not allowed');
  if (parsed.port && parsed.port !== '443')
    reject('Sentry port is not allowed', 403);
  if (parsed.search || parsed.hash) reject('Invalid Sentry DSN');

  const segments = parsed.pathname.split('/').filter(Boolean);
  const projectId = segments.pop();
  if (!projectId || !/^[1-9]\d*$/.test(projectId)) {
    reject('Invalid Sentry project ID');
  }
  if (!policy.allowedProjectIds.has(projectId)) {
    reject('Sentry project is not allowed', 403);
  }

  const basePath = segments.length ? `/${segments.join('/')}` : '';
  return new URL(
    `${basePath}/api/${projectId}/envelope/`,
    `https://${hostname}${parsed.port ? `:${parsed.port}` : ''}`,
  );
}
