import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/module/mail', () => ({
  default: {sendBeneficiaryInvite: vi.fn(async () => undefined)},
}));
vi.mock('../../src/module/api/activity/service', () => ({
  track: vi.fn(async () => undefined),
}));
vi.mock('../../src/services/queues/system', () => ({
  scheduleCapsuleDelivery: vi.fn(async () => true),
}));
import Beneficiary from '../../src/module/database/model/beneficiary';
import Capsule from '../../src/module/database/model/capsule';
import Subscription from '../../src/module/database/model/subscription';
import Usage from '../../src/module/database/model/usage';
import {
  acquireUsageSlot,
  reconcileUsageCounts,
} from '../../src/module/api/billing/usage-accounting';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import {
  create as createBeneficiary,
  del as deleteBeneficiary,
} from '../../src/module/api/beneficiary/service';
import {
  createCapsule,
  deleteCapsule,
  updateCapsule,
} from '../../src/module/api/capsule/service';
import {reconcileBillingUsageBatch} from '../../src/module/api/billing/reconciliation';

describe('billing usage accounting', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('atomically prevents concurrent free-plan usage from exceeding a limit', async () => {
    const user = await createUserFixture();

    const results = await Promise.allSettled([
      acquireUsageSlot(user.id, 'beneficiary_count', 1, 'beneficiaries'),
      acquireUsageSlot(user.id, 'beneficiary_count', 1, 'beneficiaries'),
    ]);

    expect(
      results.filter(result => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({
        statusCode: 402,
        data: expect.objectContaining({
          error: 'subscription_required',
          feature: 'beneficiaries',
        }),
      }),
    });
    expect((await Usage.findOne({user_id: user.id}))?.beneficiary_count).toBe(
      1,
    );
  });

  it('keeps paid-plan usage counters without applying the free limit', async () => {
    const user = await createUserFixture();
    await Subscription.create({
      user_id: user.id,
      tier: 'pro',
      status: 'active',
    });

    await Promise.all([
      acquireUsageSlot(user.id, 'beneficiary_count', 1, 'beneficiaries'),
      acquireUsageSlot(user.id, 'beneficiary_count', 1, 'beneficiaries'),
    ]);

    expect((await Usage.findOne({user_id: user.id}))?.beneficiary_count).toBe(
      2,
    );
  });

  it('tracks beneficiary create and delete mutations immediately', async () => {
    const user = await createUserFixture();

    const created = await createBeneficiary(
      {
        email: 'relative@example.com',
        name: 'Relative',
        about: '',
        relationship: 'family',
        avatar_file_id: null,
        groups: [],
        group_ids: [],
      },
      user.id,
    );
    expect((await Usage.findOne({user_id: user.id}))?.beneficiary_count).toBe(
      1,
    );

    await deleteBeneficiary(created.data.id, user.id);
    expect((await Usage.findOne({user_id: user.id}))?.beneficiary_count).toBe(
      0,
    );
  });

  it('decrements a beneficiary only once under concurrent deletion', async () => {
    const user = await createUserFixture();
    const created = await createBeneficiary(
      {
        email: 'delete-once@example.com',
        name: 'Delete once',
        about: '',
        relationship: 'family',
        groups: [],
        group_ids: [],
      },
      user.id,
    );

    const results = await Promise.allSettled([
      deleteBeneficiary(created.data.id, user.id),
      deleteBeneficiary(created.data.id, user.id),
    ]);

    expect(
      results.filter(result => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect((await Usage.findOne({user_id: user.id}))?.beneficiary_count).toBe(
      0,
    );
  });

  it('tracks capsule lifetime and scheduled-message status transitions', async () => {
    const user = await createUserFixture();
    const recipient = await Beneficiary.create({
      benefactor: user.id,
      email: 'recipient@example.com',
      name: 'Recipient',
      status: 'pending',
    });
    const created = await createCapsule(
      {
        title: 'Later',
        body: 'A message for later',
        recipients: [recipient.id],
        attachments: [],
        memories: [],
        status: 'draft',
      },
      user.id,
    );
    expect(await Usage.findOne({user_id: user.id}).lean()).toMatchObject({
      time_capsule_count: 1,
      timed_message_count: 0,
    });

    await updateCapsule(
      created.data._id.toString(),
      {
        status: 'scheduled',
        schedule_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
      user.id,
    );
    expect(await Usage.findOne({user_id: user.id}).lean()).toMatchObject({
      time_capsule_count: 1,
      timed_message_count: 1,
    });

    await updateCapsule(
      created.data._id.toString(),
      {status: 'draft'},
      user.id,
    );
    await deleteCapsule(created.data._id.toString(), user.id);
    expect(await Usage.findOne({user_id: user.id}).lean()).toMatchObject({
      time_capsule_count: 0,
      timed_message_count: 0,
    });
  });

  it('counts each concurrent capsule status transition only once', async () => {
    const user = await createUserFixture();
    const recipient = await Beneficiary.create({
      benefactor: user.id,
      email: 'transition@example.com',
      name: 'Recipient',
      status: 'pending',
    });
    const created = await createCapsule(
      {
        title: 'Concurrent transition',
        body: 'Only count this once',
        recipients: [recipient.id],
        attachments: [],
        memories: [],
        status: 'draft',
      },
      user.id,
    );
    const id = created.data._id.toString();
    const scheduled = {
      status: 'scheduled' as const,
      schedule_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    await Promise.all([
      updateCapsule(id, {...scheduled}, user.id),
      updateCapsule(id, {...scheduled}, user.id),
    ]);
    expect((await Usage.findOne({user_id: user.id}))?.timed_message_count).toBe(
      1,
    );

    await Promise.all([
      updateCapsule(id, {status: 'draft'}, user.id),
      updateCapsule(id, {status: 'draft'}, user.id),
    ]);
    expect((await Usage.findOne({user_id: user.id}))?.timed_message_count).toBe(
      0,
    );
  });

  it('reconciles beneficiary and capsule counters from authoritative records', async () => {
    const user = await createUserFixture();
    await Beneficiary.create([
      {benefactor: user.id, email: 'one@example.com'},
      {benefactor: user.id, email: 'two@example.com'},
    ]);
    await Capsule.create([
      {user: user.id, title: 'Draft', status: 'draft'},
      {user: user.id, title: 'Scheduled', status: 'scheduled'},
      {user: user.id, title: 'Received', status: 'received'},
    ]);

    await reconcileUsageCounts(user.id);

    expect(await Usage.findOne({user_id: user.id}).lean()).toMatchObject({
      beneficiary_count: 2,
      timed_message_count: 1,
      time_capsule_count: 2,
    });
  });

  it('reconciles every account in a bounded billing batch', async () => {
    const first = await createUserFixture();
    const second = await createUserFixture();
    await Beneficiary.create({
      benefactor: first.id,
      email: 'first@example.com',
    });
    await Capsule.create({user: second.id, title: 'Draft', status: 'draft'});
    await Usage.create([
      {user_id: first.id, beneficiary_count: 99},
      {user_id: second.id, time_capsule_count: 99},
    ]);

    const result = await reconcileBillingUsageBatch(10);

    expect(result).toMatchObject({processed: 2, drifted: 2, has_more: false});
    expect((await Usage.findOne({user_id: first.id}))?.beneficiary_count).toBe(
      1,
    );
    expect(
      (await Usage.findOne({user_id: second.id}))?.time_capsule_count,
    ).toBe(1);
  });
});
