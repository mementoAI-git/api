import {randomBytes} from 'node:crypto';

export const REFERRAL_CODE_PATTERN = /^[a-f0-9]{32}$/;
export interface ReferralRepository {
  getCode(userId: string): Promise<string | null>;
  ensureCode(userId: string, code: string): Promise<string>;
  findInviter(code: string): Promise<string | undefined>;
  countSignups(userId: string): Promise<number>;
}

export class ReferralTracker {
  constructor(private readonly repository: ReferralRepository) {}

  async summary(userId: string, frontendUrl: string) {
    const code =
      (await this.repository.getCode(userId)) ||
      (await this.repository.ensureCode(
        userId,
        randomBytes(16).toString('hex'),
      ));
    const url = new URL('/register', frontendUrl);
    url.searchParams.set('ref', code);
    return {
      invite_url: url.toString(),
      signup_count: await this.repository.countSignups(userId),
    };
  }

  async inviter(code: unknown): Promise<string | undefined> {
    if (typeof code !== 'string' || !REFERRAL_CODE_PATTERN.test(code))
      return undefined;
    return this.repository.findInviter(code);
  }
}
