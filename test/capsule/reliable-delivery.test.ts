import {beforeAll, afterAll, afterEach, describe, expect, it, vi} from 'vitest';
import {randomUUID} from 'crypto';
import Beneficiary from '../../src/module/database/model/beneficiary';
import Capsule from '../../src/module/database/model/capsule';
import CapsuleDelivery from '../../src/module/database/model/capsule-delivery';
import {
  exchangeExternalViewToken,
  getExternalCapsule,
} from '../../src/module/api/capsule/capsule-delivery';
import {
  createCapsule,
  scheduleCapsule,
  updateCapsule,
} from '../../src/module/api/capsule/service';
import {
  finalizeCapsuleDelivery,
  revealCapsules,
} from '../../src/workers/system/reveal-capsules';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import mail from '../../src/module/mail';
import request from 'supertest';
import {createTestApp} from '../helpers/app';
import {backfillCapsuleRecipients} from '../../src/scripts/backfill-capsule-recipients';
import Usage from '../../src/module/database/model/usage';

vi.mock('../../src/module/mail', () => ({
  default: {sendCapsuleReveal: vi.fn().mockResolvedValue(undefined)},
}));

describe('reliable capsule delivery', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(async () => {
    vi.clearAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('persists immutable deduplicated snapshots while retaining legacy recipients', async () => {
    const sender = await createUserFixture();
    const linked = await createUserFixture({email: 'linked@example.com'});
    const beneficiary = await Beneficiary.create({
      name: 'Linked Person',
      email: 'LINKED@example.com',
      relationship: 'friend',
      status: 'accepted',
      level: 1,
      user: linked.id,
      benefactor: sender.id,
    });

    const result = await createCapsule(
      {
        title: '',
        body: '',
        status: 'draft',
        schedule_date: new Date(Date.now() + 86_400_000).toISOString(),
        recipients: [
          beneficiary.id,
          'linked@example.com',
          {email: 'external@example.com', display_name: 'External Person'},
        ],
        attachments: [],
        memories: [],
      },
      sender.id,
    );

    expect(result.data.status).toBe('draft');
    expect(result.data.recipients.map(String)).toEqual([beneficiary.id]);
    expect(result.data.recipient_snapshots).toHaveLength(2);
    expect(result.data.recipient_snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          beneficiary_id: beneficiary.id,
          linked_user_id: linked.id,
          email: 'linked@example.com',
          display_name: 'Linked Person',
          delivery_status: 'pending',
        }),
        expect.objectContaining({
          email: 'external@example.com',
          display_name: 'External Person',
          delivery_status: 'pending',
        }),
      ]),
    );
  });

  it('uses replacement semantics and requires a valid future schedule action', async () => {
    const sender = await createUserFixture();
    const first = await Beneficiary.create({
      name: 'First',
      email: 'first@example.com',
      relationship: 'friend',
      status: 'pending',
      level: 1,
      benefactor: sender.id,
    });
    const second = await Beneficiary.create({
      name: 'Second',
      email: 'second@example.com',
      relationship: 'friend',
      status: 'pending',
      level: 1,
      benefactor: sender.id,
    });
    const created = await createCapsule(
      {
        title: 'Draft',
        body: 'Body',
        status: 'draft',
        recipients: [first.id],
        attachments: [],
        memories: [],
      },
      sender.id,
    );

    const updated = await updateCapsule(
      created.data._id.toString(),
      {recipients: [second.id], attachments: [], memories: []},
      sender.id,
    );
    expect(updated.data?.recipients.map(String)).toEqual([second.id]);
    expect(updated.data?.recipient_snapshots).toEqual([
      expect.objectContaining({email: 'second@example.com'}),
    ]);

    await expect(
      scheduleCapsule(created.data._id.toString(), sender.id),
    ).rejects.toThrow(/future reveal date/i);

    const legacyDraft = await Capsule.create({
      user: sender.id,
      title: 'Legacy draft',
      body: 'Still schedules',
      status: 'draft',
      schedule_date: new Date(Date.now() + 86_400_000),
      recipients: [first.id],
      attachments: [],
      memories: [],
    });
    const scheduled = await updateCapsule(
      legacyDraft.id,
      {status: 'scheduled'},
      sender.id,
    );
    expect(scheduled.data?.status).toBe('scheduled');
    expect(scheduled.data?.recipient_snapshots).toEqual([
      expect.objectContaining({email: 'first@example.com'}),
    ]);
  });

  it('delivers linked and external recipients exactly once across retries', async () => {
    const sender = await createUserFixture();
    const linked = await createUserFixture({email: 'linked@example.com'});
    const beneficiary = await Beneficiary.create({
      name: 'Linked',
      email: 'linked@example.com',
      relationship: 'friend',
      status: 'accepted',
      level: 1,
      user: linked.id,
      benefactor: sender.id,
    });
    const capsule = await Capsule.create({
      user: sender.id,
      title: 'For later',
      body: 'A private message',
      status: 'scheduled',
      schedule_date: new Date(Date.now() - 1000),
      recipients: [beneficiary.id],
      recipient_snapshots: [
        {
          recipient_id: randomUUID(),
          beneficiary_id: beneficiary.id,
          linked_user_id: linked.id,
          email: linked.email,
          display_name: 'Linked',
          delivery_status: 'pending',
        },
        {
          recipient_id: randomUUID(),
          email: 'external@example.com',
          display_name: 'External',
          delivery_status: 'pending',
        },
      ],
      recipients_snapshot_version: 1,
      attachments: [],
      memories: [],
    });
    await Usage.create({
      user_id: sender.id,
      timed_message_count: 1,
      time_capsule_count: 1,
    });

    await revealCapsules({data: {capsuleId: capsule.id}});
    await revealCapsules({data: {capsuleId: capsule.id}});

    expect(await CapsuleDelivery.countDocuments({capsule_id: capsule.id})).toBe(
      2,
    );
    expect(
      await Capsule.countDocuments({source: capsule.id, user: linked.id}),
    ).toBe(1);
    expect(mail.sendCapsuleReveal).toHaveBeenCalledTimes(2);
    expect((await Capsule.findById(capsule.id))?.status).toBe('delivered');
    expect(
      (await Usage.findOne({user_id: sender.id}))?.timed_message_count,
    ).toBe(0);
  });

  it('decrements scheduled usage once across concurrent finalization', async () => {
    const sender = await createUserFixture();
    const capsule = await Capsule.create({
      user: sender.id,
      title: 'Concurrent finalization',
      body: 'Only account for this once',
      status: 'scheduled',
      schedule_date: new Date(Date.now() - 1000),
      recipients: [],
      attachments: [],
      memories: [],
    });
    await Usage.create({
      user_id: sender.id,
      timed_message_count: 1,
      time_capsule_count: 1,
    });

    await Promise.all([
      finalizeCapsuleDelivery(capsule.id, sender.id, 'delivered'),
      finalizeCapsuleDelivery(capsule.id, sender.id, 'delivered'),
    ]);

    expect((await Capsule.findById(capsule.id))?.status).toBe('delivered');
    expect(
      (await Usage.findOne({user_id: sender.id}))?.timed_message_count,
    ).toBe(0);
  });

  it('exchanges an external token once and enforces expiring grants', async () => {
    const sender = await createUserFixture();
    const capsule = await Capsule.create({
      user: sender.id,
      title: 'External capsule',
      body: 'Only for its recipient',
      status: 'scheduled',
      schedule_date: new Date(Date.now() - 1000),
      recipients: [],
      recipient_snapshots: [
        {
          recipient_id: randomUUID(),
          email: 'external@example.com',
          display_name: 'External',
          delivery_status: 'pending',
        },
      ],
      recipients_snapshot_version: 1,
      attachments: [],
      memories: [],
    });
    await revealCapsules({data: {capsuleId: capsule.id}});
    const mailedUrl = vi.mocked(mail.sendCapsuleReveal).mock.calls[0][0].url;
    const token = new URL(mailedUrl).searchParams.get('token');
    expect(token).toBeTruthy();

    const exchange = await exchangeExternalViewToken(token!);
    await expect(exchangeExternalViewToken(token!)).rejects.toThrow();
    const viewed = await getExternalCapsule(exchange.grant);
    expect(viewed).toEqual(
      expect.objectContaining({
        title: 'External capsule',
        body: 'Only for its recipient',
      }),
    );
    expect(viewed).not.toHaveProperty('user');
  });

  it('keeps partial failures visible and retries only the failed recipient', async () => {
    const sender = await createUserFixture();
    const capsule = await Capsule.create({
      user: sender.id,
      title: 'Partial delivery',
      body: 'Retry safely',
      status: 'scheduled',
      schedule_date: new Date(Date.now() - 1000),
      recipients: [],
      recipient_snapshots: [
        {
          recipient_id: randomUUID(),
          email: 'success@example.com',
          delivery_status: 'pending',
        },
        {
          recipient_id: randomUUID(),
          email: 'retry@example.com',
          delivery_status: 'pending',
        },
      ],
      attachments: [],
      memories: [],
    });
    let retryFailures = 0;
    vi.mocked(mail.sendCapsuleReveal).mockImplementation(async payload => {
      if (payload.email === 'retry@example.com' && retryFailures++ === 0) {
        throw Object.assign(new Error('temporary mail failure'), {
          code: 'mail_temporary',
        });
      }
    });

    await expect(
      revealCapsules({data: {capsuleId: capsule.id}}),
    ).rejects.toThrow(/incomplete/i);
    expect((await Capsule.findById(capsule.id))?.status).toBe('failed');
    expect(
      await CapsuleDelivery.countDocuments({
        capsule_id: capsule.id,
        status: 'sent',
      }),
    ).toBe(1);

    await revealCapsules({data: {capsuleId: capsule.id}});
    expect(mail.sendCapsuleReveal).toHaveBeenCalledTimes(3);
    expect((await Capsule.findById(capsule.id))?.status).toBe('delivered');
  });

  it('exposes a no-store public exchange without leaking sender ownership', async () => {
    const sender = await createUserFixture();
    const capsule = await Capsule.create({
      user: sender.id,
      title: 'Safe boundary',
      body: 'Recipient-only fields',
      status: 'scheduled',
      schedule_date: new Date(Date.now() - 1000),
      recipients: [],
      recipient_snapshots: [
        {
          recipient_id: randomUUID(),
          email: 'outside@example.com',
          delivery_status: 'pending',
        },
      ],
      attachments: [],
      memories: [],
    });
    await revealCapsules({data: {capsuleId: capsule.id}});
    const mailedUrl = vi.mocked(mail.sendCapsuleReveal).mock.calls[0][0].url;
    const token = new URL(mailedUrl).searchParams.get('token');
    const app = createTestApp();

    const exchange = await request(app)
      .post('/capsule/view/exchange')
      .send({token})
      .expect(200);
    expect(exchange.headers['cache-control']).toBe('no-store');
    const view = await request(app)
      .get('/capsule/view')
      .set('x-capsule-view-grant', exchange.body.data.grant)
      .expect(200);
    expect(view.headers['referrer-policy']).toBe('no-referrer');
    expect(view.body.data).toMatchObject({
      title: 'Safe boundary',
      body: 'Recipient-only fields',
    });
    expect(view.body.data).not.toHaveProperty('user');
    await request(app).post('/capsule/view/exchange').send({token}).expect(401);
  });

  it('backfills legacy recipient IDs additively and supports dry runs', async () => {
    const sender = await createUserFixture();
    const beneficiary = await Beneficiary.create({
      name: 'Legacy recipient',
      email: 'legacy@example.com',
      relationship: 'friend',
      status: 'pending',
      level: 1,
      benefactor: sender.id,
    });
    const capsule = await Capsule.create({
      user: sender.id,
      title: 'Legacy',
      body: 'Before snapshots',
      status: 'draft',
      recipients: [beneficiary.id],
      attachments: [],
      memories: [],
    });

    expect(await backfillCapsuleRecipients({commit: false})).toMatchObject({
      scanned: 1,
      matched: 1,
      updated: 0,
    });
    expect(
      (await Capsule.findById(capsule.id))?.recipient_snapshots,
    ).toBeUndefined();
    expect(await backfillCapsuleRecipients({commit: true})).toMatchObject({
      scanned: 1,
      matched: 1,
      updated: 1,
    });
    expect((await Capsule.findById(capsule.id))?.recipient_snapshots).toEqual([
      expect.objectContaining({email: 'legacy@example.com'}),
    ]);
  });
});
