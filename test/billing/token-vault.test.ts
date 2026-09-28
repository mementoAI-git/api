import {afterEach, describe, expect, it} from 'vitest';
import {
  decryptStoreSecret,
  encryptStoreSecret,
} from '../../src/module/api/billing/providers/token-vault';

describe('store token vault', () => {
  afterEach(() => delete process.env.IAP_TOKEN_ENCRYPTION_KEY);

  it('encrypts and authenticates replay payloads', () => {
    process.env.IAP_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString(
      'base64',
    );
    const encrypted = encryptStoreSecret('private-store-payload');

    expect(encrypted).not.toContain('private-store-payload');
    expect(decryptStoreSecret(encrypted)).toBe('private-store-payload');
    expect(() => decryptStoreSecret(`${encrypted.slice(0, -1)}x`)).toThrow();
  });

  it('fails closed when the configured key is missing or malformed', () => {
    expect(() => encryptStoreSecret('payload')).toThrow(
      'IAP token encryption is not configured',
    );
    process.env.IAP_TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(() => encryptStoreSecret('payload')).toThrow(
      'must be a base64-encoded 32-byte key',
    );
  });
});
