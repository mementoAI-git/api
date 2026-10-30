import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {Types} from 'mongoose';
import {createSession} from '../../src/module/api/auth/session-service';
import {deleteUser} from '../../src/module/api/user/service';
import ActivePrompt from '../../src/module/database/model/active-prompt';
import Activity from '../../src/module/database/model/activities';
import AiMetric from '../../src/module/database/model/ai-metric';
import AuthCode from '../../src/module/database/model/auth-code';
import AuthSession from '../../src/module/database/model/auth-session';
import Beneficiary from '../../src/module/database/model/beneficiary';
import BillingWebhookEvent from '../../src/module/database/model/billing-webhook-event';
import Bookmark from '../../src/module/database/model/bookmarks';
import Capsule from '../../src/module/database/model/capsule';
import DailyAiPromptCache from '../../src/module/database/model/daily-ai-prompt-cache';
import Feedback from '../../src/module/database/model/feedback';
import File from '../../src/module/database/model/file';
import {FeatureFlagAudit} from '../../src/module/database/model/feature-flag-audit';
import Group from '../../src/module/database/model/group';
import Memory from '../../src/module/database/model/memory';
import Message from '../../src/module/database/model/message';
import MemoryEmbedding from '../../src/module/database/model/memory-embedding';
import VoiceAction from '../../src/module/database/model/voice-action';
import PendingInsight from '../../src/module/database/model/pending-insight';
import Persona from '../../src/module/database/model/persona';
import PurgeCommand from '../../src/module/database/model/purge-command';
import PurgeStage from '../../src/module/database/model/purge-stage';
import PushDevice from '../../src/module/database/model/push-device';
import Subscription from '../../src/module/database/model/subscription';
import Usage from '../../src/module/database/model/usage';
import User from '../../src/module/database/model/user';
import {
  PURGE_MANIFEST,
  processPurgeCommand,
} from '../../src/services/account-purge';
import * as storage from '../../src/services/storage';
import type {RequestContext} from '../../src/contracts/response';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const context: RequestContext = {
  requestId: 'purge-test',
  client: 'ios',
  version: '2.4.0',
  build: '312',
};

describe('account purge pipeline', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(() => {
    vi.restoreAllMocks();
    return clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('atomically revokes access and creates one durable command', async () => {
    const user = await createUserFixture({
      refresh_token: 'legacy',
      refresh_tokens: ['legacy'],
    });
    await createSession(user, context);
    await PushDevice.create({
      user_id: user.id,
      installation_id: 'installation-1',
      push_token: 'ExponentPushToken[purge]',
      platform: 'ios',
      enabled: true,
      last_seen_at: new Date(),
    });

    await deleteUser(user.id);
    await deleteUser(user.id);

    expect(await PurgeCommand.countDocuments({user_id: user.id})).toBe(1);
    expect(
      await AuthSession.countDocuments({user_id: user.id, revoked_at: null}),
    ).toBe(0);
    expect(
      await PushDevice.countDocuments({user_id: user.id, enabled: true}),
    ).toBe(0);
    expect(await User.findById(user.id).lean()).toMatchObject({
      deleted: true,
      purge_status: 'purge_pending',
      refresh_token: null,
      refresh_tokens: [],
      session_version: 1,
    });
  });

  it('covers every user-bearing model and irreversibly purges user data', async () => {
    expect(PURGE_MANIFEST.map(entry => entry.model).sort()).toEqual(
      [
        'ActivePrompt',
        'Activity',
        'AiMetric',
        'ArchiveExport',
        'AuthCode',
        'AuthSession',
        'Beneficiary',
        'BillingWebhookEvent',
        'Bookmark',
        'Capsule',
        'CapsuleDelivery',
        'DailyAiPromptCache',
        'FeatureFlagAudit',
        'Feedback',
        'File',
        'Group',
        'IapChainAlias',
        'IapSubscriptionChain',
        'IapTransaction',
        'Memory',
        'MemoryEmbedding',
        'Message',
        'PendingInsight',
        'Persona',
        'PushDevice',
        'StoreNotificationEvent',
        'Subscription',
        'Usage',
        'User',
        'VoiceAction',
      ].sort(),
    );

    const user = await createUserFixture();
    const recipient = await createUserFixture({email: 'recipient@example.com'});
    const memory = await Memory.create({
      user: user.id,
      title: 'Private',
      body: 'Private body',
    });
    const beneficiary = await Beneficiary.create({
      user: recipient.id,
      benefactor: user.id,
      name: 'Recipient',
      email: recipient.email,
      relationship: 'friend',
      status: 'accepted',
    });
    await Promise.all([
      ActivePrompt.create({
        user: user.id,
        memory: memory.id,
        day_key: '2026-08-29',
      }),
      Activity.create({
        user: user.id,
        type: 'memory',
        title: 'Private',
        description: 'Private',
        action: 'created',
      }),
      AiMetric.create({event: 'test', user: user.id, memory: memory.id}),
      AuthCode.create({email: user.email, code: '123456', type: 'login'}),
      Bookmark.create({user: user.id, memory: memory.id}),
      DailyAiPromptCache.create({
        user: user.id,
        date_key: '2026-08-29',
        prompt_text: 'Private',
        expires_at: new Date(Date.now() + 60_000),
      }),
      Feedback.create({
        user: new Types.ObjectId(user.id),
        email: user.email,
        type: 'Other',
        message: 'Private',
      }),
      File.create({
        user: user.id,
        name: 'private.jpg',
        thumbnail_key: 'thumb_private.jpg',
        provider: 's3',
        type: 'image/jpeg',
        size: 100,
      }),
      Group.create({
        user: user.id,
        name: 'Private group',
        members: [beneficiary.id],
      }),
      MemoryEmbedding.create({
        user: user.id,
        source: 'story',
        source_id: String(memory._id),
        memory: String(memory._id),
        text: 'private words',
        text_hash: 'hash',
        vector: Buffer.alloc(8),
        embedding_model: 'test',
      }),
      VoiceAction.create({
        user: user.id,
        tool: 'rename_story',
        summary: 'renamed a story',
      }),
      Message.create({
        user: user.id,
        memory: memory.id,
        role: 'user',
        text: 'Private',
      }),
      PendingInsight.create({
        user: user.id,
        memory: memory.id,
        source: 'story',
        field: 'important_notes',
        content: 'Private',
      }),
      Persona.create({user: user.id, memory_insights_summary: 'Private'}),
      PushDevice.create({
        user_id: user.id,
        installation_id: 'purge-device',
        push_token: 'ExponentPushToken[data]',
        platform: 'ios',
        last_seen_at: new Date(),
      }),
      Subscription.create({
        user_id: user.id,
        tier: 'pro',
        status: 'active',
        has_used_trial: true,
        payment_provider: 'polar',
        provider_customer_id: 'polar-customer',
      }),
      Usage.create({user_id: user.id, storage_used_bytes: 100}),
      FeatureFlagAudit.create({
        key: 'test',
        action: 'override',
        scope_type: 'user',
        scope_id: user.id,
        actor: user.id,
        reason: user.email,
        payload: {email: user.email},
      }),
      BillingWebhookEvent.create({
        provider: 'polar',
        event_id: 'purge-event',
        event_type: 'customer.updated',
        user_id: user.id,
        provider_customer_id: 'polar-customer',
      }),
    ]);

    const deliveredFile = await File.create({
      user: user.id,
      name: 'delivered.jpg',
      provider: 's3',
      type: 'image/jpeg',
      size: 50,
    });

    const source = await Capsule.create({
      user: user.id,
      recipients: [beneficiary.id],
      title: 'Delivered source',
      body: 'Private',
      attachments: [],
      status: 'delivered',
    });
    const received = await Capsule.create({
      user: recipient.id,
      benefactor: user.id,
      source: source.id,
      recipients: [],
      title: 'Delivered letter',
      body: 'Keep for recipient',
      attachments: [deliveredFile.id],
      memories: [memory.id],
      status: 'received',
    });
    vi.spyOn(storage, 'deleteFileEverywhere').mockResolvedValue(undefined);

    await deleteUser(user.id);
    const command = await PurgeCommand.findOne({user_id: user.id}).orFail();
    await processPurgeCommand(command.id);

    expect(storage.deleteFileEverywhere).toHaveBeenCalledWith(
      'private.jpg',
      's3',
      'image/jpeg',
      false,
    );
    expect(storage.deleteFileEverywhere).toHaveBeenCalledWith(
      'thumb_private.jpg',
      's3',
      'image/jpeg',
      true,
    );
    expect(storage.deleteFileEverywhere).not.toHaveBeenCalledWith(
      'delivered.jpg',
      's3',
      'image/jpeg',
      false,
    );
    expect(await Capsule.findById(source.id)).toBeNull();
    expect(await Capsule.findById(received.id).lean()).toMatchObject({
      user: recipient.id,
      benefactor: null,
      sender_anonymized: true,
      attachments: [deliveredFile.id],
      memories: [],
    });
    expect(await FeatureFlagAudit.findOne({key: 'test'}).lean()).toMatchObject({
      scope_id: 'deleted-account',
      actor: 'deleted-account',
      payload: {},
    });
    expect(await File.countDocuments({user: user.id})).toBe(0);
    expect(await File.findById(deliveredFile.id).lean()).toMatchObject({
      user: 'delivered-capsule',
    });
    expect(await ActivePrompt.countDocuments({user: user.id})).toBe(0);
    expect(await Activity.countDocuments({user: user.id})).toBe(0);
    expect(await MemoryEmbedding.countDocuments({user: user.id})).toBe(0);
    expect(await VoiceAction.countDocuments({user: user.id})).toBe(0);
    expect(await AiMetric.countDocuments({user: user.id})).toBe(0);
    expect(await AuthCode.countDocuments({email: user.email})).toBe(0);
    expect(await AuthSession.countDocuments({user_id: user.id})).toBe(0);
    expect(await Bookmark.countDocuments({user: user.id})).toBe(0);
    expect(await DailyAiPromptCache.countDocuments({user: user.id})).toBe(0);
    expect(await Feedback.countDocuments({email: user.email})).toBe(0);
    expect(await Group.countDocuments({user: user.id})).toBe(0);
    expect(await Memory.countDocuments({user: user.id})).toBe(0);
    expect(await Message.countDocuments({user: user.id})).toBe(0);
    expect(await PendingInsight.countDocuments({user: user.id})).toBe(0);
    expect(await Persona.countDocuments({user: user.id})).toBe(0);
    expect(await PushDevice.countDocuments({user_id: user.id})).toBe(0);
    expect(
      await Beneficiary.countDocuments({
        $or: [{user: user.id}, {benefactor: user.id}],
      }),
    ).toBe(0);
    expect(await Subscription.countDocuments({user_id: user.id})).toBe(0);
    expect(await Usage.countDocuments({user_id: user.id})).toBe(0);
    expect(
      await BillingWebhookEvent.findOne({event_id: 'purge-event'}).lean(),
    ).toMatchObject({user_id: null, provider_customer_id: null});
    expect(
      await PurgeStage.countDocuments({
        command_id: command.id,
        status: 'completed',
      }),
    ).toBeGreaterThan(0);
    expect(await PurgeCommand.findById(command.id).lean()).toMatchObject({
      status: 'completed',
      email: null,
    });
    expect(await User.findById(user.id).lean()).toMatchObject({
      email: `deleted+${command.id}@invalid.memento`,
      purge_status: 'purged',
      deleted: true,
      first_name: '',
      last_name: '',
      passkeys: [],
    });
  });

  it('resumes at the failed stage without repeating completed storage cleanup', async () => {
    const user = await createUserFixture();
    await File.create({
      user: user.id,
      name: 'retry.jpg',
      provider: 's3',
      type: 'image/jpeg',
      size: 1,
    });
    const deleteFile = vi
      .spyOn(storage, 'deleteFileEverywhere')
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValue(undefined);
    await deleteUser(user.id);
    const command = await PurgeCommand.findOne({user_id: user.id}).orFail();

    await expect(processPurgeCommand(command.id)).rejects.toThrow(
      'provider unavailable',
    );
    expect(
      await PurgeStage.findOne({
        command_id: command.id,
        name: 'provider_cleanup',
      }).lean(),
    ).toMatchObject({status: 'failed', attempts: 1});
    await processPurgeCommand(command.id);
    await processPurgeCommand(command.id);

    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(await PurgeCommand.findById(command.id).lean()).toMatchObject({
      status: 'completed',
    });
  });

  it('claims one worker and recovers an abandoned running command', async () => {
    const user = await createUserFixture();
    await File.create({
      user: user.id,
      name: 'claimed.jpg',
      provider: 's3',
      type: 'image/jpeg',
      size: 1,
    });
    const deleteFile = vi
      .spyOn(storage, 'deleteFileEverywhere')
      .mockResolvedValue(undefined);
    await deleteUser(user.id);
    const command = await PurgeCommand.findOne({user_id: user.id}).orFail();

    await Promise.all([
      processPurgeCommand(command.id),
      processPurgeCommand(command.id),
    ]);
    expect(deleteFile).toHaveBeenCalledTimes(1);

    const staleUser = await createUserFixture();
    await deleteUser(staleUser.id);
    const stale = await PurgeCommand.findOne({user_id: staleUser.id}).orFail();
    await stale.updateOne({
      status: 'running',
      started_at: new Date(Date.now() - 16 * 60 * 1000),
    });
    await processPurgeCommand(stale.id);
    expect(await PurgeCommand.findById(stale.id).lean()).toMatchObject({
      status: 'completed',
    });
  });
});
