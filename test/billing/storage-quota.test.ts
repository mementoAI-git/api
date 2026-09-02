import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import File from '../../src/module/database/model/file';
import StorageReservation from '../../src/module/database/model/storage-reservation';
import Subscription from '../../src/module/database/model/subscription';
import Usage from '../../src/module/database/model/usage';
import {
  commitStorageReservation,
  getStorageUsageSummary,
  reconcileStorageUsage,
  releaseStorageReservation,
  reserveStorage,
  resolveStorageLimit,
} from '../../src/module/api/billing/storage-quota';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import {getSubscriptionSummary} from '../../src/module/api/billing/service';

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

describe('storage quota reservations', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('resolves finite plan limits with an explicit admin override', () => {
    expect(resolveStorageLimit('free')).toBe(200 * MiB);
    expect(resolveStorageLimit('pro')).toBe(10 * GiB);
    expect(resolveStorageLimit('legacy')).toBe(10 * GiB);
    expect(resolveStorageLimit('free', 750 * MiB)).toBe(750 * MiB);
  });

  it('returns a complete zero-usage contract for a new free account', async () => {
    const user = await createUserFixture();

    const summary = await getSubscriptionSummary(user.id);

    expect(summary.data).toMatchObject({
      tier: 'free',
      status: 'active',
      usage: {
        storage_used_bytes: 0,
        storage_reserved_bytes: 0,
        storage_limit_bytes: 200 * MiB,
        remaining_bytes: 200 * MiB,
        percent_used: 0,
        over_limit: false,
        beneficiary_count: 0,
        timed_message_count: 0,
      },
    });
  });

  it('atomically allows only one concurrent reservation within a free limit', async () => {
    const user = await createUserFixture();
    const results = await Promise.allSettled([
      reserveStorage(user.id, 150 * MiB, 'upload-a'),
      reserveStorage(user.id, 150 * MiB, 'upload-b'),
    ]);

    expect(
      results.filter(result => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({
        code: 'storage_quota_exceeded',
        data: expect.objectContaining({
          limit_bytes: 200 * MiB,
          requested_bytes: 150 * MiB,
        }),
      }),
    });
    expect(
      (await Usage.findOne({user_id: user.id}))?.storage_reserved_bytes,
    ).toBe(150 * MiB);
  });

  it('commits the final compressed size and releases failed reservations idempotently', async () => {
    const user = await createUserFixture();
    const reserved = await reserveStorage(user.id, 100 * MiB, 'upload-commit');
    await commitStorageReservation(reserved.reservation_id, 60 * MiB);
    await commitStorageReservation(reserved.reservation_id, 60 * MiB);

    const failed = await reserveStorage(user.id, 40 * MiB, 'upload-release');
    await releaseStorageReservation(failed.reservation_id);
    await releaseStorageReservation(failed.reservation_id);

    expect(await Usage.findOne({user_id: user.id}).lean()).toMatchObject({
      storage_used_bytes: 60 * MiB,
      storage_reserved_bytes: 0,
      storage_limit_bytes: 200 * MiB,
    });
    expect(
      await StorageReservation.findOne({
        reservation_id: reserved.reservation_id,
      }).lean(),
    ).toMatchObject({
      status: 'committed',
      requested_bytes: 100 * MiB,
      committed_bytes: 60 * MiB,
    });
  });

  it('rejects a late commit after its reservation was released', async () => {
    const user = await createUserFixture();
    const reserved = await reserveStorage(user.id, 10 * MiB, 'upload-late');
    await releaseStorageReservation(reserved.reservation_id, 'expired');

    await expect(
      commitStorageReservation(reserved.reservation_id, 10 * MiB),
    ).rejects.toMatchObject({statusCode: 409});
    expect(await Usage.findOne({user_id: user.id}).lean()).toMatchObject({
      storage_used_bytes: 0,
      storage_reserved_bytes: 0,
    });
  });

  it('reconciles logical files and reports over-limit paid-to-free downgrades without deletion', async () => {
    const user = await createUserFixture();
    await Subscription.create({
      user_id: user.id,
      tier: 'pro',
      status: 'active',
    });
    await File.create({
      user: user.id,
      name: 'large-file.bin',
      type: 'application/pdf',
      size: 250 * MiB,
      provider: 's3',
      deleted: false,
    });
    await reconcileStorageUsage(user.id);
    await Subscription.updateOne({user_id: user.id}, {$set: {tier: 'free'}});

    const summary = await getStorageUsageSummary(user.id);
    expect(summary).toMatchObject({
      used_bytes: 250 * MiB,
      reserved_bytes: 0,
      limit_bytes: 200 * MiB,
      remaining_bytes: 0,
      over_limit: true,
    });
    expect(await File.countDocuments({user: user.id})).toBe(1);
  });
});
