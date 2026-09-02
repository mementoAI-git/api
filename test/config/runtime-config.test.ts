import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  loadAndValidateRuntimeConfig,
  validateRuntimeConfig,
} from '../../src/utils/runtime-config';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {recursive: true, force: true});
  }
});

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
  it('loads deployment secrets before validating startup configuration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'memento-runtime-config-'));
    temporaryDirectories.push(directory);
    const envPath = join(directory, '.env');
    writeFileSync(
      envPath,
      [
        'JWT_SECRET=deployment-jwt-secret-at-least-32-characters',
        'FILE_URL_SIGNING_KEYS=v1:deployment-file-signing-secret-at-least-32-characters',
        'TALLY_WEBHOOK_ENABLED=false',
        'SENTRY_TUNNEL_ENABLED=false',
        'BULL_BOARD_ENABLED=false',
      ].join('\n'),
    );
    const env: Record<string, string | undefined> = {
      NODE_ENV: 'production',
      DOTENV_CONFIG_PATH: envPath,
    };

    expect(loadAndValidateRuntimeConfig(env)).toMatchObject({
      nodeEnv: 'production',
      tallyWebhookEnabled: false,
      sentryTunnelEnabled: false,
      bullBoardEnabled: false,
    });
    expect(env.FILE_URL_SIGNING_KEYS).toContain('deployment-file-signing');
  });

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

  it('rejects a missing file signing key before development starts', () => {
    expect(() =>
      validateRuntimeConfig({
        ...productionEnv,
        NODE_ENV: 'development',
        FILE_URL_SIGNING_KEYS: undefined,
      }),
    ).toThrow('FILE_URL_SIGNING_KEYS');
  });
});
