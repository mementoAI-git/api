import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import Subscription from '../../src/module/database/model/subscription';
import Memory from '../../src/module/database/model/memory';
import File from '../../src/module/database/model/file';
import Usage from '../../src/module/database/model/usage';
import {
  accountDetail,
  listAccounts,
  operationsSummary,
} from '../../src/module/api/staff/operations-service';
import {accountListSchema} from '../../src/module/api/staff/validator';

describe('staff diagnostic projections', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);
  it('returns metadata without credentials, private context or billing tokens', async () => {
    const user = await createUserFixture({
      email: 'support@example.com',
      password: 'secret-password',
      private_key: 'secret-private-key',
    });
    const id = String(user._id);
    await Subscription.create({
      user_id: id,
      tier: 'pro',
      status: 'cancelled',
      current_period_end: new Date(0),
      provider_customer_id: 'secret-provider-id',
    });
    await Usage.create({
      user_id: id,
      storage_used_bytes: 1024,
      storage_reserved_bytes: 512,
    });
    const detail = await accountDetail(id.toUpperCase());
    expect(detail.subscription.effective_tier).toBe('free');
    expect(detail.usage?.storage_reserved_bytes).toBe(512);
    expect(JSON.stringify(detail)).not.toMatch(
      /secret-|password|private_key|store_account_token|provider_customer_id/,
    );
    const list = await listAccounts('SUPPORT@example.com', 1);
    expect(list.total).toBe(1);
    expect(JSON.stringify(list)).not.toContain('secret-');
    expect((await listAccounts('.*', 1)).total).toBe(0);
    expect((await listAccounts(id, 1)).total).toBe(1);
  });
  it('distinguishes missing records and zero counts', async () => {
    const user = await createUserFixture();
    const detail = await accountDetail(String(user._id));
    expect(detail.usage).toBeNull();
    expect(detail.subscription.status).toBeNull();
    expect(detail.processing.files_failed).toBe(0);
    expect((await operationsSummary()).counts).toMatchObject({
      accounts: 1,
      files_failed: 0,
      people_active_spaces: 0,
    });
    await expect(accountDetail('000000000000000000000000')).rejects.toThrow(
      'Account not found',
    );
  });
  it('keeps healthy counts when one diagnostic query fails', async () => {
    const query = File.countDocuments({});
    vi.spyOn(query, 'exec').mockRejectedValue(new Error('database timeout'));
    vi.spyOn(File, 'countDocuments').mockReturnValueOnce(query);
    const result = await operationsSummary();
    expect(result.counts.files_processing).toBeNull();
    expect(result.counts.files_failed).toBe(0);
    expect(result.counts.accounts).toBe(0);
  });
  it('does not report zero recovery records when recovery is not deployed', async () => {
    vi.spyOn(Memory.schema, 'path').mockReturnValue(undefined as never);
    expect((await operationsSummary()).counts.memories_recoverable).toBeNull();
  });
  it('bounds pagination and rejects unexpected filters', () => {
    expect(accountListSchema.safeParse({page: 1001}).success).toBe(false);
    expect(accountListSchema.safeParse({search: {$ne: ''}}).success).toBe(
      false,
    );
    expect(accountListSchema.safeParse({limit: 10000}).success).toBe(false);
  });
});
