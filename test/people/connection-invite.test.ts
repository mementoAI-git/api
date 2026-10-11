import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import mail from '../../src/module/mail';
import Beneficiary from '../../src/module/database/model/beneficiary';
import SharedSpace from '../../src/module/database/model/shared-space';
import {acceptInvite} from '../../src/module/api/beneficiary/service';
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
    expect(sender.mock.calls[0][0].subject).toBe('[Memento] Connection Invite');
    expect(sender.mock.calls[0][0].html).toContain('shared space');
    expect(sender.mock.calls[0][0].html).not.toContain('as a beneficiary');
    await mail.sendBeneficiaryInvite({
      id: 'invite-2',
      email: 'ada@example.com',
      name: 'Ada',
      access_scope: 'full_vault',
    } as never);
    expect(sender.mock.calls[1][0].subject).toBe(
      '[Memento] Beneficiary Invite',
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
});
