import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import {staffConfig} from '../../../utils/config';
import {ServiceUnavailableException} from '../../../utils/service-error';

function encryptionKey() {
  const value = staffConfig().totpKey;
  if (!/^[a-f\d]{64}$/i.test(value))
    throw new ServiceUnavailableException(
      'Staff authentication is not configured',
    );
  return Buffer.from(value, 'hex');
}
export function encryptTotp(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map(value => value.toString('base64'))
    .join('.');
}
export function decryptTotp(value: string) {
  const [iv, tag, ciphertext] = value
    .split('.')
    .map(part => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}
export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
