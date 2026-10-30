process.env.NODE_ENV = 'test';
// Billing tests must not inherit the staging entitlement from a local .env.
process.env.STAGING_AUTO_PRO = 'false';
// Unit tests must not inherit a developer machine's Redis URL from .env.
// Tests that intentionally exercise Redis can set this explicitly before import.
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters';
process.env.FILE_URL_SIGNING_KEYS =
  'test-v1:test-file-signing-secret-at-least-32-characters,' +
  'test-v0:test-previous-file-signing-secret-at-least-32-characters';
process.env.BACKEND_URL = 'http://localhost:5000';
process.env.FEATURE_FLAGS_ADMIN_EMAILS = 'admin@example.com';
process.env.BULL_BOARD_ENABLED = 'false';
process.env.SENTRY_TUNNEL_ENABLED = 'true';
process.env.SENTRY_TUNNEL_ALLOWED_HOSTS = 'o123.ingest.sentry.io';
process.env.SENTRY_TUNNEL_ALLOWED_PROJECT_IDS = '456';
process.env.SENTRY_TUNNEL_MAX_BYTES = '1024';
process.env.SENTRY_TUNNEL_RATE_LIMIT_PER_MINUTE = '100';
process.env.TALLY_WEBHOOK_ENABLED = 'true';
process.env.TALLY_WEBHOOK_SECRET =
  'test-tally-webhook-secret-at-least-32-characters';
process.env.TALLY_WEBHOOK_RATE_LIMIT_PER_MINUTE = '100';

process.env.STAFF_ORIGIN = 'http://localhost:5174';
process.env.STAFF_TOTP_KEY = 'a'.repeat(64);
