import {config as loadDotenv} from 'dotenv';

export type RuntimeConfig = {
  nodeEnv: string;
  tallyWebhookEnabled: boolean;
  sentryTunnelEnabled: boolean;
  bullBoardEnabled: boolean;
};

type Environment = Record<string, string | undefined>;

export function loadAndValidateRuntimeConfig(
  env: Environment = process.env,
): RuntimeConfig {
  const path = env.DOTENV_CONFIG_PATH;
  loadDotenv({
    ...(path ? {path} : {}),
    processEnv: env,
  });
  return validateRuntimeConfig(env);
}

function enabled(env: Environment, name: string): boolean {
  const value = env[name];
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name} must be "true" or "false"`);
}

function requireSecret(env: Environment, name: string): string {
  const value = env[name];
  if (!value || value.length < 32) {
    throw new Error(`${name} must be at least 32 characters`);
  }
  return value;
}

function commaSeparated(env: Environment, name: string): string[] {
  return (env[name] || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function validatePercentage(env: Environment, name: string): void {
  const value = env[name];
  if (value === undefined || value === '') return;
  const percent = Number(value);
  if (!/^\d+$/.test(value) || percent > 100) {
    throw new Error(`${name} must be a whole number from 0 to 100`);
  }
}

function validateFileSigningKeys(value: string | undefined): void {
  if (!value) throw new Error('FILE_URL_SIGNING_KEYS is required');
  const ids = new Set<string>();
  for (const entry of value.split(',')) {
    const separator = entry.indexOf(':');
    const id = entry.slice(0, separator).trim();
    const secret = entry.slice(separator + 1);
    if (separator <= 0 || !id || secret.length < 32 || ids.has(id)) {
      throw new Error('FILE_URL_SIGNING_KEYS is invalid');
    }
    ids.add(id);
  }
}

export function validateRuntimeConfig(env: Environment): RuntimeConfig {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const tallyWebhookEnabled = enabled(env, 'TALLY_WEBHOOK_ENABLED');
  const sentryTunnelEnabled = enabled(env, 'SENTRY_TUNNEL_ENABLED');
  const bullBoardEnabled = enabled(env, 'BULL_BOARD_ENABLED');
  const appleIapNotificationsEnabled = enabled(
    env,
    'APPLE_IAP_NOTIFICATIONS_ENABLED',
  );
  const googlePlayRtdnEnabled = enabled(env, 'GOOGLE_PLAY_RTDN_ENABLED');

  // Attachment responses are signed in every environment. Validate the key at
  // bootstrap instead of allowing the first attachment-bearing request to fail.
  validateFileSigningKeys(env.FILE_URL_SIGNING_KEYS);
  validatePercentage(env, 'VOICE_TURN_AB_PERCENT');

  if (isProduction) {
    requireSecret(env, 'JWT_SECRET');
  }
  if (tallyWebhookEnabled) requireSecret(env, 'TALLY_WEBHOOK_SECRET');
  if (googlePlayRtdnEnabled) {
    if (!env.GOOGLE_PLAY_RTDN_AUDIENCE) {
      throw new Error('GOOGLE_PLAY_RTDN_AUDIENCE is required');
    }
    if (!env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL) {
      throw new Error('GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL is required');
    }
    if (!env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY) {
      throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_KEY is required');
    }
  }
  if (appleIapNotificationsEnabled || googlePlayRtdnEnabled) {
    const encryptionKey = env.IAP_TOKEN_ENCRYPTION_KEY;
    if (!encryptionKey || Buffer.from(encryptionKey, 'base64').length !== 32) {
      throw new Error(
        'IAP_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      );
    }
  }
  if (sentryTunnelEnabled) {
    if (commaSeparated(env, 'SENTRY_TUNNEL_ALLOWED_HOSTS').length === 0) {
      throw new Error('SENTRY_TUNNEL_ALLOWED_HOSTS is required');
    }
    if (commaSeparated(env, 'SENTRY_TUNNEL_ALLOWED_PROJECT_IDS').length === 0) {
      throw new Error('SENTRY_TUNNEL_ALLOWED_PROJECT_IDS is required');
    }
  }
  if (env.STAFF_ORIGIN || env.STAFF_TOTP_KEY) {
    if (!env.STAFF_ORIGIN) throw new Error('STAFF_ORIGIN is required');
    const origin = new URL(env.STAFF_ORIGIN);
    if (
      origin.origin !== env.STAFF_ORIGIN ||
      (isProduction && origin.protocol !== 'https:')
    ) {
      throw new Error(
        'STAFF_ORIGIN must be an exact origin, using HTTPS in production',
      );
    }
    if (!/^[a-f\d]{64}$/i.test(env.STAFF_TOTP_KEY || ''))
      throw new Error('STAFF_TOTP_KEY must be 64 hexadecimal characters');
  }

  return {
    nodeEnv,
    tallyWebhookEnabled,
    sentryTunnelEnabled,
    bullBoardEnabled,
  };
}
