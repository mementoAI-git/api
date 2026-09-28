import {createCipheriv, createDecipheriv, randomBytes} from 'crypto';
import {ServiceUnavailableException} from '../../../../utils/service-error';

function encryptionKey(): Buffer {
  const value = process.env.IAP_TOKEN_ENCRYPTION_KEY;
  if (!value) {
    throw new ServiceUnavailableException(
      'IAP token encryption is not configured',
    );
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new ServiceUnavailableException(
      'IAP_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
  }
  return key;
}

export function encryptStoreSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptStoreSecret(value: string): string {
  const [version, iv, authTag, encrypted] = value.split('.');
  if (version !== 'v1' || !iv || !authTag || !encrypted) {
    throw new Error('Invalid encrypted store secret');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
