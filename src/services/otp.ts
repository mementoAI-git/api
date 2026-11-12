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

/** Wrong codes allowed per address before its codes stop working for a while. */
const MAX_CODE_FAILURES = 5;

/**
 * Six-digit codes share one small keyspace, so a code alone could match
 * anyone's. They only count together with the address they were sent to.
 * Emailed links use UUIDs, which cannot be guessed, and need no address.
 */
const isNumericCode = (code: string) => /^\d+$/.test(code);

interface OtpData {
  email: string;
  type: OtpType;
  used: boolean;
  createdAt: string;
  /** Set once the code was checked together with its address (reset only). */
  checked?: boolean;
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
    if (isNumericCode(code)) {
      if (!email || (await this.isLocked(type, email))) return {valid: false};
    }
    const key = this.buildKey(type, code);
    const dataStr = await redis.get(key);
    const data: OtpData | null = dataStr
      ? JSON.parse(dataStr.toString())
      : null;

    if (
      !data ||
      (email && data.email && data.email.toLowerCase() !== email.toLowerCase())
    ) {
      if (isNumericCode(code) && email) await this.recordFailure(type, email);
      return {valid: false};
    }

    // Check if already used - return success but flag it
    if (data.used) {
      return {valid: true, email: data.email, alreadyUsed: true};
    }

    return {valid: true, email: data.email, alreadyUsed: false};
  }

  /**
   * Atomically consume a reset token, including previously emailed links.
   * A six-digit code needs its address; without one it is accepted only if
   * it was already checked with its address (older apps send it alone).
   */
  async consume(
    code: string,
    type: OtpType,
    email?: string,
  ): Promise<OtpVerifyResult> {
    const key = this.buildKey(type, code);
    if (isNumericCode(code)) {
      const stored = await redis.get(key);
      const data: OtpData | null = stored
        ? JSON.parse(stored.toString())
        : null;
      if (email) {
        if (await this.isLocked(type, email)) return {valid: false};
        if (!data || data.email.toLowerCase() !== email.toLowerCase()) {
          await this.recordFailure(type, email);
          return {valid: false};
        }
      } else if (!data?.checked) {
        return {valid: false};
      }
    }
    const raw = await redis.getDel(key);
    if (!raw) return {valid: false};
    const data: OtpData = JSON.parse(raw.toString());
    if (email && data.email.toLowerCase() !== email.toLowerCase()) {
      return {valid: false};
    }
    return data.used ? {valid: false} : {valid: true, email: data.email};
  }

  /** Records that a code was checked together with its address. */
  async markChecked(code: string, type: OtpType): Promise<void> {
    const key = this.buildKey(type, code);
    const stored = await redis.get(key);
    if (!stored) return;
    const data: OtpData = JSON.parse(stored.toString());
    data.checked = true;
    await redis.set(key, JSON.stringify(data), {KEEPTTL: true});
  }

  private failureKey(type: OtpType, email: string): string {
    return `${OTP_PREFIX}fail:${type}:${email.toLowerCase()}`;
  }

  private async isLocked(type: OtpType, email: string): Promise<boolean> {
    const count = Number(await redis.get(this.failureKey(type, email)));
    return count >= MAX_CODE_FAILURES;
  }

  /** Counts a wrong code for an address; the count lasts as long as a code. */
  private async recordFailure(type: OtpType, email: string): Promise<void> {
    const key = this.failureKey(type, email);
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, OTP_CONFIG[type].ttl);
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
