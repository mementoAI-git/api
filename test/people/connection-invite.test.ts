import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import mail from '../../src/module/mail';
import Beneficiary from '../../src/module/database/model/beneficiary';
import SharedSpace from '../../src/module/database/model/shared-space';
import * as settings from '../../src/module/api/people/settings';
import {assertConnection} from '../../src/module/api/people/connection';
import {
  acceptInvite,
  create,
  resendInvite,
} from '../../src/module/api/beneficiary/service';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import {createBeneficiarySchema} from '../../src/module/api/beneficiary/dto';

describe('connection mode in the existing invitation flow', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('supports shared_only through the existing invitation DTO', () => {
    expect(
      createBeneficiarySchema.parse({
        body: {email: 'ada@example.com', access_scope: 'shared_only'},
      }).body.access_scope,
    ).toBe('shared_only');
  });

  it('uses connection wording in email without changing legacy invitations', async () => {
    const sender = vi.spyOn(mail, 'send').mockResolvedValue(undefined);
    await mail.sendBeneficiaryInvite({
      id: 'invite-1',
      email: 'ada@example.com',
      name: 'Ada',
      access_scope: 'shared_only',
    } as never);
    expect(sender.mock.calls[0][0].subject).toBe(
      'Someone invited you to connect on Memento',
    );
    expect(sender.mock.calls[0][0].html).toContain('shared space');
    expect(sender.mock.calls[0][0].html).not.toContain('as a beneficiary');
    await mail.sendBeneficiaryInvite({
      id: 'invite-2',
      email: 'ada@example.com',
      name: 'Ada',
      access_scope: 'full_vault',
    } as never);
    expect(sender.mock.calls[1][0].subject).toBe(
      'Someone added you as a connection on Memento',
    );
  });

  it('creates one shared space when a connection invite is accepted', async () => {
    const a = await createUserFixture();
    const b = await createUserFixture();
    const invite = await Beneficiary.create({
      benefactor: a.id,
      user: b.id,
      name: 'B',
      email: b.email,
      status: 'pending',
      access_scope: 'shared_only',
    });
    await acceptInvite({
      invite_id: invite.id,
      first_name: 'B',
      last_name: 'User',
      dob: '1990-01-01',
    });
    const [user_a, user_b] = [a.id, b.id].sort();
    expect(
      await SharedSpace.findById(`${user_a}:${user_b}`).lean(),
    ).toMatchObject({user_a, user_b});
    expect(await SharedSpace.countDocuments()).toBe(1);
  });
  it('blocks new invitations, acceptance and resend until the blocker unblocks', async () => {
    const a = await createUserFixture();
    const b = await createUserFixture();
    const invite = await Beneficiary.create({
      benefactor: a.id,
      user: b.id,
      email: b.email,
      status: 'accepted',
      access_scope: 'shared_only',
    });
    const sender = vi
      .spyOn(mail, 'sendBeneficiaryInvite')
      .mockResolvedValue(undefined);
    await settings.disconnect(b.id, a.id, true);
    await expect(
      create(
        createBeneficiarySchema.parse({
          body: {email: b.email, access_scope: 'shared_only'},
        }).body,
        a.id,
      ),
    ).rejects.toMatchObject({statusCode: 400});
    await expect(resendInvite({email: b.email}, a.id)).rejects.toMatchObject({
      statusCode: 400,
    });
    await invite.updateOne({$set: {status: 'pending'}});
    const accept = {
      invite_id: invite.id,
      first_name: 'B',
      last_name: 'User',
      dob: '1990-01-01',
    };
    await expect(acceptInvite(accept)).rejects.toMatchObject({statusCode: 400});
    expect(sender).not.toHaveBeenCalled();
    await invite.updateOne({$set: {status: 'removed'}});
    await settings.unblock(b.id, a.id);
    await create(
      createBeneficiarySchema.parse({
        body: {email: b.email, access_scope: 'shared_only'},
      }).body,
      a.id,
    );
    expect(sender).toHaveBeenCalledOnce();
    await expect(assertConnection(b.id, a.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    await acceptInvite(accept);
    expect(await assertConnection(b.id, a.id)).toHaveProperty('sharedSpaceId');
    expect((await Beneficiary.findById(invite.id))?.access_scope).toBe(
      'shared_only',
    );
  });
});
