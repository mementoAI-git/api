import {createHash, randomInt, randomUUID} from 'node:crypto';

const TTL = 10 * 60;
const COOLDOWN = 60;
const MAX_ATTEMPTS = 5;

interface RecoveryStore {
  eval(
    script: string,
    options: {keys: string[]; arguments: string[]},
  ): Promise<unknown>;
}

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

// Keep resend and verification atomic across API instances. Resending must not
// replenish the guess budget, and concurrent verification must issue one token.
const ISSUE = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
if tonumber(redis.call('GET', KEYS[3]) or '0') >= tonumber(ARGV[4]) then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
return 1
`;

const VERIFY = `
local expected = redis.call('GET', KEYS[1])
if not expected then return 0 end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[4]) then return 0 end
if expected ~= ARGV[1] then
  local attempts = redis.call('INCR', KEYS[2])
  if attempts == 1 then redis.call('EXPIRE', KEYS[2], ARGV[3]) end
  if attempts >= tonumber(ARGV[4]) then redis.call('DEL', KEYS[1]) end
  return 0
end
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[3], ARGV[2], 'EX', ARGV[3])
return 1
`;

export class PasswordRecoveryCodes {
  constructor(private store: RecoveryStore) {}

  async issue(email: string): Promise<string | null> {
    const account = digest(email);
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const issued = await this.store.eval(ISSUE, {
      keys: [
        `recovery:code:${account}`,
        `recovery:cooldown:${account}`,
        `recovery:attempts:${account}`,
      ],
      arguments: [
        digest(`${email}:${code}`),
        String(TTL),
        String(COOLDOWN),
        String(MAX_ATTEMPTS),
      ],
    });
    return issued === 1 ? code : null;
  }

  async verify(email: string, code: string): Promise<string | null> {
    if (!/^\d{6}$/.test(code)) return null;
    const account = digest(email);
    const token = randomUUID();
    const verified = await this.store.eval(VERIFY, {
      keys: [
        `recovery:code:${account}`,
        `recovery:attempts:${account}`,
        `otp:reset:${token}`,
      ],
      arguments: [
        digest(`${email}:${code}`),
        JSON.stringify({
          email,
          type: 'reset',
          used: false,
          createdAt: new Date().toISOString(),
        }),
        String(TTL),
        String(MAX_ATTEMPTS),
      ],
    });
    return verified === 1 ? token : null;
  }
}
