import {describe, expect, it} from 'vitest';
import {validateRuntimeConfig} from '../../src/utils/runtime-config';

const productionEnv = {
  NODE_ENV: 'production',
  JWT_SECRET: 'production-jwt-secret-at-least-32-characters',
  FILE_URL_SIGNING_KEYS:
    'v1:production-file-signing-secret-at-least-32-characters',
  TALLY_WEBHOOK_ENABLED: 'false',
  SENTRY_TUNNEL_ENABLED: 'false',
  BULL_BOARD_ENABLED: 'false',
};

describe('runtime security configuration', () => {
  it.each([
    ['missing JWT secret', {JWT_SECRET: undefined}, 'JWT_SECRET'],
    ['short JWT secret', {JWT_SECRET: 'short'}, 'JWT_SECRET'],
    [
      'missing file signing key',
      {FILE_URL_SIGNING_KEYS: undefined},
      'FILE_URL_SIGNING_KEYS',
    ],
    [
      'enabled Tally without a secret',
      {TALLY_WEBHOOK_ENABLED: 'true', TALLY_WEBHOOK_SECRET: undefined},
      'TALLY_WEBHOOK_SECRET',
    ],
    [
      'enabled Sentry tunnel without allowlists',
      {
        SENTRY_TUNNEL_ENABLED: 'true',
        SENTRY_TUNNEL_ALLOWED_HOSTS: undefined,
        SENTRY_TUNNEL_ALLOWED_PROJECT_IDS: undefined,
      },
      'SENTRY_TUNNEL_ALLOWED_HOSTS',
    ],
    [
      'enabled Bull Board without administrators',
      {BULL_BOARD_ENABLED: 'true', FEATURE_FLAGS_ADMIN_EMAILS: undefined},
      'FEATURE_FLAGS_ADMIN_EMAILS',
    ],
  ])('rejects %s in production', (_label, overrides, expected) => {
    expect(() =>
      validateRuntimeConfig({...productionEnv, ...overrides}),
    ).toThrow(expected);
  });

  it('allows development to explicitly disable optional routes', () => {
    expect(
      validateRuntimeConfig({
        ...productionEnv,
        NODE_ENV: 'development',
        TALLY_WEBHOOK_ENABLED: 'false',
        SENTRY_TUNNEL_ENABLED: 'false',
        BULL_BOARD_ENABLED: 'false',
      }),
    ).toMatchObject({
      tallyWebhookEnabled: false,
      sentryTunnelEnabled: false,
      bullBoardEnabled: false,
    });
  });
});
