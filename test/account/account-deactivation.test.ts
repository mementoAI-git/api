import {generateKeyPairSync} from 'crypto';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import {encryptStoreSecret} from '../../src/module/api/billing/providers/token-vault';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {login} from '../../src/module/api/auth/service';
import {deleteUser} from '../../src/module/api/user/service';
import {deleteAccountSchema} from '../../src/module/api/user/dto';
import mail from '../../src/module/mail';
import ArchiveExport from '../../src/module/database/model/archive-export';
import AuthSession from '../../src/module/database/model/auth-session';
import PurgeCommand from '../../src/module/database/model/purge-command';
import User from '../../src/module/database/model/user';
import {processPurgeCommand} from '../../src/services/account-purge';
import {
  ACCOUNT_DELETION_GRACE_MS,
  isWithinDeletionGrace,
  reactivateAccount,
} from '../../src/services/account-purge/account-state';
import * as queues from '../../src/services/queues/system';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const PASSWORD = 'correct horse battery staple';

async function passwordUser() {
  return createUserFixture({password: await bcrypt.hash(PASSWORD, 4)});
}

describe('account deactivation grace period', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(() => {
    vi.restoreAllMocks();
    return clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('deactivates now, records why, and schedules the purge 14 days out', async () => {
    const deactivated = vi
      .spyOn(mail, 'sendAccountDeactivated')
      .mockResolvedValue(undefined);
    const publish = vi.spyOn(queues, 'publishAccountPurge');
    const user = await passwordUser();
    const before = Date.now();

    const result = await deleteUser(user.id, {
      reason: 'other',
      details: 'Moving to paper journals',
    });

    const stored = await User.findById(user.id).lean().orFail();
    const command = await PurgeCommand.findOne({user_id: user.id}).orFail();
    expect(stored.deleted).toBe(true);
    expect(stored.purge_status).toBe('purge_pending');
    expect(stored.deletion_reason).toBe('other');
    expect(stored.deletion_details).toBe('Moving to paper journals');
    expect(command.available_at.getTime()).toBeGreaterThanOrEqual(
      before + ACCOUNT_DELETION_GRACE_MS - 1000,
    );
    expect(result.data).toMatchObject({deactivated: true, grace_days: 14});
    expect(publish).not.toHaveBeenCalled();
    expect(deactivated).toHaveBeenCalledTimes(1);
  });

  it("revokes the account's Sign in with Apple token and forgets it", async () => {
    vi.spyOn(mail, 'sendAccountDeactivated').mockResolvedValue(undefined);
    process.env.IAP_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString(
      'base64',
    );
    process.env.APPLE_SIGNIN_KEY_ID = 'KEY123ABCD';
    process.env.APPLE_SIGNIN_PRIVATE_KEY = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    })
      .privateKey.export({format: 'pem', type: 'pkcs8'})
      .toString();
    const post = vi.spyOn(axios, 'post').mockResolvedValue({data: ''} as any);
    const user = await passwordUser();
    await User.updateOne(
      {_id: user.id},
      {$set: {apple_refresh_token: encryptStoreSecret('apple-refresh-1')}},
    );

    await deleteUser(user.id);

    expect(post.mock.calls[0][0]).toBe('https://appleid.apple.com/auth/revoke');
    expect(String(post.mock.calls[0][1])).toContain('token=apple-refresh-1');
    const stored = await User.findById(user.id)
      .select('+apple_refresh_token')
      .lean()
      .orFail();
    expect(stored.apple_refresh_token).toBeNull();
    delete process.env.APPLE_SIGNIN_KEY_ID;
    delete process.env.APPLE_SIGNIN_PRIVATE_KEY;
  });

  it('still deletes the account when Apple revocation fails', async () => {
    vi.spyOn(mail, 'sendAccountDeactivated').mockResolvedValue(undefined);
    process.env.IAP_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString(
      'base64',
    );
    process.env.APPLE_SIGNIN_KEY_ID = 'KEY123ABCD';
    process.env.APPLE_SIGNIN_PRIVATE_KEY = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    })
      .privateKey.export({format: 'pem', type: 'pkcs8'})
      .toString();
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('apple down'));
    const user = await passwordUser();
    await User.updateOne(
      {_id: user.id},
      {$set: {apple_refresh_token: encryptStoreSecret('apple-refresh-1')}},
    );

    const result = await deleteUser(user.id);

    expect(result.data).toMatchObject({deactivated: true});
    delete process.env.APPLE_SIGNIN_KEY_ID;
    delete process.env.APPLE_SIGNIN_PRIVATE_KEY;
  });

  it('does not purge before the grace period ends', async () => {
    vi.spyOn(mail, 'sendAccountDeactivated').mockResolvedValue(undefined);
    const user = await passwordUser();
    await deleteUser(user.id);
    const command = await PurgeCommand.findOne({user_id: user.id}).orFail();

    await processPurgeCommand(command.id);

    const after = await PurgeCommand.findById(command.id).orFail();
    expect(after.status).toBe('pending');
    expect(await User.exists({_id: user.id})).toBeTruthy();
  });

  it('signing in with the password during the grace period restores the account', async () => {
    vi.spyOn(mail, 'sendAccountDeactivated').mockResolvedValue(undefined);
    const user = await passwordUser();
    await deleteUser(user.id, {reason: 'taking-break'});

    const result = await login({
      email: user.email,
      password: PASSWORD,
    } as never);

    const stored = await User.findById(user.id).lean().orFail();
    expect(stored.deleted).toBe(false);
    expect(stored.purge_status).toBe('active');
    expect(stored.deletion_scheduled_for).toBeNull();
    expect(await PurgeCommand.countDocuments({user_id: user.id})).toBe(0);
    expect(result.data).toBeTruthy();
    expect(
      await AuthSession.countDocuments({user_id: user.id, revoked_at: null}),
    ).toBe(1);
  });

  it('a wrong password never restores a deactivated account', async () => {
    vi.spyOn(mail, 'sendAccountDeactivated').mockResolvedValue(undefined);
    const user = await passwordUser();
    await deleteUser(user.id);

    await expect(
      login({email: user.email, password: 'wrong'} as never),
    ).rejects.toThrow('Incorrect password');

    const stored = await User.findById(user.id).lean().orFail();
    expect(stored.deleted).toBe(true);
    expect(await PurgeCommand.countDocuments({user_id: user.id})).toBe(1);
  });

  it('cannot be restored once the grace period has passed', async () => {
    vi.spyOn(mail, 'sendAccountDeactivated').mockResolvedValue(undefined);
    const user = await passwordUser();
    await deleteUser(user.id);
    const past = new Date(Date.now() - 1000);
    await PurgeCommand.updateOne(
      {user_id: user.id},
      {$set: {available_at: past}},
    );
    await User.updateOne(
      {_id: user.id},
      {$set: {deletion_scheduled_for: past}},
    );

    await expect(
      login({email: user.email, password: PASSWORD} as never),
    ).rejects.toThrow('Account is not active');
    expect(await reactivateAccount(user.id)).toBe(false);
  });

  it('cannot be restored once the purge has started', async () => {
    vi.spyOn(mail, 'sendAccountDeactivated').mockResolvedValue(undefined);
    const user = await passwordUser();
    await deleteUser(user.id);
    await PurgeCommand.updateOne(
      {user_id: user.id},
      {$set: {status: 'running'}},
    );

    expect(await reactivateAccount(user.id)).toBe(false);
    expect((await User.findById(user.id).lean().orFail()).deleted).toBe(true);
  });

  it('never restores an account staff have disabled', async () => {
    const user = await createUserFixture({
      deleted: true,
      disabled: true,
      purge_status: 'purge_pending',
      deletion_scheduled_for: new Date(Date.now() + ACCOUNT_DELETION_GRACE_MS),
    });
    expect(isWithinDeletionGrace(user)).toBe(false);
  });

  it('queues an archive export to be emailed when asked', async () => {
    vi.spyOn(mail, 'sendAccountDeactivated').mockResolvedValue(undefined);
    const queued = vi
      .spyOn(queues, 'queueArchiveExport')
      .mockResolvedValue(true as never);
    const user = await passwordUser();

    await deleteUser(user.id, {export_data: true});

    const job = await ArchiveExport.findOne({user_id: user.id}).orFail();
    expect(job.email_on_complete).toBe(true);
    expect(queued).toHaveBeenCalledWith(job.id);
  });

  it('accepts the app payload and old clients that send no body', async () => {
    const parsed = await deleteAccountSchema.parseAsync({
      body: {reason: 'safety-privacy', export_data: false},
    });
    expect(parsed.body).toEqual({reason: 'safety-privacy', export_data: false});
    expect(
      (await deleteAccountSchema.parseAsync({body: undefined})).body,
    ).toEqual({});
    await expect(
      deleteAccountSchema.parseAsync({body: {reason: 'nope'}}),
    ).rejects.toThrow();
  });
});
