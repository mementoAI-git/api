import {v4 as uuid} from 'uuid';
import redis from './redis';
import {random} from '../utils/helpers';

export type OtpType = 'verify' | 'reset' | 'invite' | 'delete-account';
export type OtpFormat = 'numeric' | 'uuid';

interface OtpTypeConfig {
  ttl: number;
  format: OtpFormat;
  length?: number;
}

const OTP_CONFIG: Record<OtpType, OtpTypeConfig> = {
  verify: {ttl: 10 * 60, format: 'uuid'},
  reset: {ttl: 10 * 60, format: 'uuid'},
  invite: {ttl: 5 * 24 * 60 * 60, format: 'numeric', length: 6},
  'delete-account': {ttl: 10 * 60, format: 'numeric', length: 6},
};

const OTP_PREFIX = 'otp:';

interface OtpData {
  email: string;
  type: OtpType;
  used: boolean;
  createdAt: string;
}

export interface OtpVerifyResult {
  valid: boolean;
  email?: string;
  alreadyUsed?: boolean;
}

class OtpService {
  /**
   * Generate a new OTP code based on type configuration
   */
  private generateCode(type: OtpType): string {
    const config = OTP_CONFIG[type];

    if (config.format === 'uuid') {
      return uuid();
    }

    return random(config.length || 6, 'number');
  }

  /**
   * Build Redis key for an OTP
   */
  private buildKey(type: OtpType, code: string): string {
    return `${OTP_PREFIX}${type}:${code}`;
  }

  /**
   * Create and store a new OTP
   * @param email - The email address associated with this OTP
   * @param type - The type of OTP (verify, reset, invite, etc.)
   * @returns The generated code
   */
  async create(
    email: string,
    type: OtpType,
    options?: {format?: OtpFormat; length?: number},
  ): Promise<string> {
    const config = OTP_CONFIG[type];
    const format = options?.format || config.format;
    const length = options?.length || config.length || 6;

    let code = '';
    let key = '';
    let attempts = 0;

    do {
      code = format === 'uuid' ? uuid() : random(length, 'number');
      key = this.buildKey(type, code);
      attempts++;
      if (format === 'uuid') break;
      try {
        const exists = await redis.get(key);
        if (!exists) break;
      } catch {
        break;
      }
    } while (attempts < 5);

    const data: OtpData = {
      email,
      type,
      used: false,
      createdAt: new Date().toISOString(),
    };

    await redis.set(key, JSON.stringify(data), {EX: config.ttl});

    return code;
  }

  /**
   * Verify an OTP code
   * @param code - The OTP code to verify
   * @param type - The type of OTP
   * @returns Verification result with email if valid
   */
  async verify(
    code: string,
    type: OtpType,
    email?: string,
  ): Promise<OtpVerifyResult> {
    const key = this.buildKey(type, code);
    const dataStr = await redis.get(key);

    if (!dataStr) {
      return {valid: false};
    }

    const data: OtpData = JSON.parse(dataStr.toString());

    if (
      email &&
      data.email &&
      data.email.toLowerCase() !== email.toLowerCase()
    ) {
      return {valid: false};
    }

    // Check if already used - return success but flag it
    if (data.used) {
      return {valid: true, email: data.email, alreadyUsed: true};
    }

    return {valid: true, email: data.email, alreadyUsed: false};
  }

  /** Atomically consume a reset token, including previously emailed links. */
  async consume(code: string, type: OtpType): Promise<OtpVerifyResult> {
    const raw = await redis.getDel(this.buildKey(type, code));
    if (!raw) return {valid: false};
    const data: OtpData = JSON.parse(raw.toString());
    return data.used ? {valid: false} : {valid: true, email: data.email};
  }

  /**
   * Mark an OTP as used (but don't delete - let it expire naturally)
   * This prevents race conditions with duplicate requests
   * @param code - The OTP code to mark as used
   * @param type - The type of OTP
   */
  async markUsed(code: string, type: OtpType): Promise<void> {
    const key = this.buildKey(type, code);
    const dataStr = await redis.get(key);

    if (!dataStr) {
      return;
    }

    const data: OtpData = JSON.parse(dataStr.toString());
    data.used = true;

    // Update with KEEPTTL to preserve the original expiration
    await redis.set(key, JSON.stringify(data), {KEEPTTL: true});
  }

  /**
   * Delete an OTP immediately (use sparingly - prefer letting it expire)
   * @param code - The OTP code to delete
   * @param type - The type of OTP
   */
  async delete(code: string, type: OtpType): Promise<void> {
    const key = this.buildKey(type, code);
    await redis.del(key);
  }

  /**
   * Delete all OTPs for an email and type
   * Note: This requires scanning Redis keys, use sparingly
   * @param email - The email address
   * @param type - The type of OTP
   */
  async deleteAllForEmail(email: string, type: OtpType): Promise<void> {
    const pattern = `${OTP_PREFIX}${type}:*`;
    let cursor = '0';

    do {
      const result = await redis.scan(cursor, {MATCH: pattern, COUNT: 100});
      cursor = result.cursor.toString();

      for (const key of result.keys) {
        const dataStr = await redis.get(key);
        if (dataStr) {
          const data: OtpData = JSON.parse(dataStr.toString());
          if (data.email === email) {
            await redis.del(key);
          }
        }
      }
    } while (cursor !== '0');
  }

  /**
   * Get the TTL configuration for an OTP type (in seconds)
   */
  getTtl(type: OtpType): number {
    return OTP_CONFIG[type].ttl;
  }
}

export default new OtpService();
