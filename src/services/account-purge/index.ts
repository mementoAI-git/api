import ActivePrompt from '../../module/database/model/active-prompt';
import ArchiveExport from '../../module/database/model/archive-export';
import Activity from '../../module/database/model/activities';
import AiMetric from '../../module/database/model/ai-metric';
import AuthCode from '../../module/database/model/auth-code';
import AuthSession from '../../module/database/model/auth-session';
import Beneficiary from '../../module/database/model/beneficiary';
import BillingWebhookEvent from '../../module/database/model/billing-webhook-event';
import IapChainAlias from '../../module/database/model/iap-chain-alias';
import IapSubscriptionChain from '../../module/database/model/iap-subscription-chain';
import IapTransaction from '../../module/database/model/iap-transaction';
import StoreNotificationEvent from '../../module/database/model/store-notification-event';
import Bookmark from '../../module/database/model/bookmarks';
import Capsule from '../../module/database/model/capsule';
import CapsuleDelivery from '../../module/database/model/capsule-delivery';
import DailyAiPromptCache from '../../module/database/model/daily-ai-prompt-cache';
import Feedback from '../../module/database/model/feedback';
import File from '../../module/database/model/file';
import {FeatureFlagAudit} from '../../module/database/model/feature-flag-audit';
import Group from '../../module/database/model/group';
import Memory from '../../module/database/model/memory';
import Message from '../../module/database/model/message';
import PendingInsight from '../../module/database/model/pending-insight';
import Persona from '../../module/database/model/persona';
import PurgeCommand, {
  type IPurgeCommand,
} from '../../module/database/model/purge-command';
import PurgeStage from '../../module/database/model/purge-stage';
import MemoryEmbedding from '../../module/database/model/memory-embedding';
import VoiceAction from '../../module/database/model/voice-action';
import PushDevice from '../../module/database/model/push-device';
import Subscription from '../../module/database/model/subscription';
import Usage from '../../module/database/model/usage';
import User from '../../module/database/model/user';
import logger from '../../utils/logger';
import {deleteCacheValue} from '../redis';
import * as storage from '../storage';
import {deleteUserContainer} from '../supermemory';
import {deletePolarCustomerByExternalId} from '../../module/api/billing/providers/polar';

export {isActiveAccount} from './account-state';

export const PURGE_SCHEMA_VERSION = 1;
const ANONYMOUS_ACCOUNT = 'deleted-account';

/** Auditable inventory: every current user-bearing collection has an entry. */
export const PURGE_MANIFEST = [
  {model: 'ActivePrompt', disposition: 'delete'},
  {model: 'Activity', disposition: 'delete'},
  {model: 'ArchiveExport', disposition: 'provider-delete'},
  {model: 'AiMetric', disposition: 'delete'},
  {model: 'AuthCode', disposition: 'delete'},
  {model: 'AuthSession', disposition: 'delete'},
  {model: 'Beneficiary', disposition: 'delete'},
  {model: 'BillingWebhookEvent', disposition: 'anonymize'},
  {model: 'IapChainAlias', disposition: 'delete'},
  {model: 'IapSubscriptionChain', disposition: 'delete'},
  {model: 'IapTransaction', disposition: 'delete'},
  {model: 'StoreNotificationEvent', disposition: 'anonymize'},
  {model: 'Bookmark', disposition: 'delete'},
  {model: 'Capsule', disposition: 'delete-or-anonymize'},
  {model: 'CapsuleDelivery', disposition: 'delete-or-anonymize'},
  {model: 'DailyAiPromptCache', disposition: 'delete'},
  {model: 'FeatureFlagAudit', disposition: 'anonymize'},
  {model: 'Feedback', disposition: 'delete'},
  {model: 'File', disposition: 'provider-delete'},
  {model: 'Group', disposition: 'delete'},
  {model: 'Memory', disposition: 'delete'},
  {model: 'MemoryEmbedding', disposition: 'delete'},
  {model: 'Message', disposition: 'delete'},
  {model: 'PendingInsight', disposition: 'delete'},
  {model: 'Persona', disposition: 'delete'},
  {model: 'PushDevice', disposition: 'delete'},
  {model: 'Subscription', disposition: 'delete'},
  {model: 'Usage', disposition: 'delete'},
  {model: 'User', disposition: 'tombstone'},
  {model: 'VoiceAction', disposition: 'delete'},
] as const;

function errorCode(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return 'purge_stage_failed';
}

function isStorageNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: string;
    status?: number;
    statusCode?: number;
    $metadata?: {httpStatusCode?: number};
  };
  return (
    candidate.name === 'NotFoundException' ||
    candidate.name === 'NotFound' ||
    candidate.status === 404 ||
    candidate.statusCode === 404 ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

async function deleteStorageObject(
  key: string,
  provider: 's3' | 'gcs' | 'cloudinary',
  mimeType: string,
  hasBackup = false,
): Promise<void> {
  try {
    await storage.deleteFileEverywhere(key, provider, mimeType, hasBackup);
  } catch (error) {
    if (!isStorageNotFound(error)) throw error;
  }
}

async function cleanupProviders(command: IPurgeCommand): Promise<void> {
  // Provider calls happen before database rows are removed so retries retain keys.
  const archiveExports = await ArchiveExport.find({user_id: command.user_id})
    .select('+object_key')
    .lean();
  for (const archiveExport of archiveExports) {
    if (archiveExport.object_key) {
      await deleteStorageObject(
        archiveExport.object_key,
        's3',
        'application/zip',
        false,
      );
    }
    await ArchiveExport.deleteOne({_id: archiveExport._id});
  }

  for (;;) {
    const files = await File.find({user: command.user_id})
      .select('+backup_at')
      .limit(100)
      .lean();
    if (files.length === 0) break;

    for (const file of files) {
      const provider = file.provider || 's3';
      await deleteStorageObject(
        file.name,
        provider,
        file.type,
        !!file.backup_at,
      );
      if (file.thumbnail_key) {
        // Current thumbnail generation stores derivatives in S3 independently
        // of legacy primary providers.
        await deleteStorageObject(file.thumbnail_key, 's3', file.type, true);
      }
      await File.deleteOne({_id: file._id});
    }
  }

  await Promise.all([
    deleteCacheValue(`enrichment:score:${command.user_id}`),
    deleteCacheValue(`overviewprompts:${command.user_id}`),
    deleteUserContainer(command.user_id),
    deletePolarCustomerByExternalId(command.user_id),
  ]);
}

async function anonymizeDeliveredCapsules(userId: string): Promise<void> {
  const deliveredSourceIds = await CapsuleDelivery.distinct('capsule_id', {
    status: {$in: ['sent', 'delivered']},
  });
  const [delivered, deliveredSources] = await Promise.all([
    Capsule.find({benefactor: userId, status: 'received'})
      .select('attachments')
      .lean(),
    Capsule.find({_id: {$in: deliveredSourceIds}, user: userId})
      .select('attachments recipient_snapshots')
      .lean(),
  ]);
  const retainedAttachmentIds = Array.from(
    new Set(
      [...delivered, ...deliveredSources].flatMap(
        capsule => capsule.attachments || [],
      ),
    ),
  );
  if (retainedAttachmentIds.length > 0) {
    // The immutable recipient artifact outlives the sender account and no longer
    // counts as sender-owned provider data.
    await File.updateMany(
      {_id: {$in: retainedAttachmentIds}, user: userId},
      {$set: {user: 'delivered-capsule'}},
    );
  }
  await Capsule.updateMany(
    {benefactor: userId, status: 'received'},
    {
      $set: {
        benefactor: null,
        sender_anonymized: true,
        sender_anonymized_at: new Date(),
        memories: [],
      },
    },
  );
  for (const source of deliveredSources) {
    await Capsule.updateOne(
      {_id: source._id, user: userId},
      {
        $set: {
          user: 'delivered-capsule',
          sender_anonymized: true,
          sender_anonymized_at: new Date(),
          recipients: [],
          memories: [],
          recipient_snapshots: (source.recipient_snapshots || []).map(
            recipient => ({
              recipient_id: recipient.recipient_id,
              email: 'redacted@invalid.memento',
              delivery_status: recipient.delivery_status,
              delivered_at: recipient.delivered_at,
            }),
          ),
        },
      },
    );
    await CapsuleDelivery.updateMany(
      {capsule_id: String(source._id)},
      {$set: {recipient_email: 'redacted@invalid.memento'}},
    );
  }
}

function containsAccountReference(
  value: unknown,
  userId: string,
  resourceIds: Set<string>,
): boolean {
  if (typeof value === 'string') {
    return value === userId || resourceIds.has(value);
  }
  if (Array.isArray(value)) {
    return value.some(item =>
      containsAccountReference(item, userId, resourceIds),
    );
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(item =>
      containsAccountReference(item, userId, resourceIds),
    );
  }
  return false;
}

async function cleanupQueuedWork(command: IPurgeCommand): Promise<void> {
  const [memories, capsules, files] = await Promise.all([
    Memory.find({user: command.user_id}).select('_id').lean(),
    Capsule.find({
      $or: [{user: command.user_id}, {benefactor: command.user_id}],
    })
      .select('_id')
      .lean(),
    File.find({user: command.user_id}).select('_id').lean(),
  ]);
  const resourceIds = new Set(
    [...memories, ...capsules, ...files].map(record => String(record._id)),
  );
  await Promise.all(
    memories.map(memory =>
      deleteCacheValue(`insights:buffer:${command.user_id}:${memory._id}`),
    ),
  );

  // Dynamic imports avoid queue initialization cycles in the API process.
  const [
    {summarizationQueue},
    {insightQueue},
    {quickCaptureQueue},
    {systemQueue},
  ] = await Promise.all([
    import('../queues/summarization'),
    import('../queues/insights'),
    import('../queues/quick-capture'),
    import('../queues/system'),
  ]);
  const queues = [
    summarizationQueue,
    insightQueue,
    quickCaptureQueue,
    systemQueue,
  ].filter((queue): queue is NonNullable<typeof queue> => Boolean(queue));

  for (const queue of queues) {
    const jobs = await queue.getJobs([
      'wait',
      'delayed',
      'paused',
      'prioritized',
      'waiting-children',
      'completed',
      'failed',
    ]);
    for (const job of jobs) {
      if (containsAccountReference(job.data, command.user_id, resourceIds)) {
        await job.remove();
      }
    }
  }
}

type Deletion = {
  model: {deleteMany(filter: Record<string, unknown>): PromiseLike<unknown>};
  filter: Record<string, unknown>;
};

async function deleteDomainRecords(command: IPurgeCommand): Promise<void> {
  const userId = command.user_id;
  const email = command.email;
  const ownedCapsuleIds = await Capsule.distinct('_id', {user: userId});
  if (ownedCapsuleIds.length) {
    await CapsuleDelivery.deleteMany({capsule_id: {$in: ownedCapsuleIds}});
  }
  await CapsuleDelivery.deleteMany({linked_user_id: userId});
  const deletions: Deletion[] = [
    {model: ActivePrompt, filter: {user: userId}},
    {model: Activity, filter: {user: userId}},
    {model: ArchiveExport, filter: {user_id: userId}},
    {model: AiMetric, filter: {user: userId}},
    ...(email ? [{model: AuthCode, filter: {email}}] : []),
    {model: AuthSession, filter: {user_id: userId}},
    {
      model: Beneficiary,
      filter: {$or: [{user: userId}, {benefactor: userId}]},
    },
    {model: Bookmark, filter: {user: userId}},
    {model: Capsule, filter: {user: userId}},
    {
      model: DailyAiPromptCache,
      filter: {user: userId},
    },
    {
      model: Feedback,
      filter: {$or: [{user: userId}, ...(email ? [{email}] : [])]},
    },
    {model: Group, filter: {user: userId}},
    {model: IapChainAlias, filter: {user_id: userId}},
    {model: IapSubscriptionChain, filter: {user_id: userId}},
    {model: IapTransaction, filter: {user_id: userId}},
    {model: Message, filter: {user: userId}},
    {model: PendingInsight, filter: {user: userId}},
    {model: Persona, filter: {user: userId}},
    {model: PushDevice, filter: {user_id: userId}},
    {model: Subscription, filter: {user_id: userId}},
    {model: Usage, filter: {user_id: userId}},
    {model: Memory, filter: {user: userId}},
    {model: MemoryEmbedding, filter: {user: userId}},
    {model: VoiceAction, filter: {user: userId}},
  ];

  for (const deletion of deletions) {
    await deletion.model.deleteMany(deletion.filter);
  }
}

async function anonymizeAuditRecords(command: IPurgeCommand): Promise<void> {
  const userId = command.user_id;
  await FeatureFlagAudit.updateMany(
    {actor: userId},
    {
      $set: {
        actor: ANONYMOUS_ACCOUNT,
        reason: null,
        payload: {},
      },
    },
  );
  await FeatureFlagAudit.updateMany(
    {scope_type: 'user', scope_id: userId},
    {$set: {scope_id: ANONYMOUS_ACCOUNT, reason: null, payload: {}}},
  );
  await BillingWebhookEvent.updateMany(
    {user_id: userId},
    {$set: {user_id: null, provider_customer_id: null}},
  );
  await StoreNotificationEvent.updateMany(
    {user_id: userId},
    {
      $set: {
        user_id: null,
        normalized_payload: null,
        encrypted_provider_token: null,
      },
    },
  );
}

async function writeUserTombstone(command: IPurgeCommand): Promise<void> {
  await User.findByIdAndUpdate(command.user_id, {
    $set: {
      email: `deleted+${command._id}@invalid.memento`,
      first_name: '',
      last_name: '',
      nickname: '',
      gender: '',
      phone_number: '',
      dob: null,
      country: '',
      password: '',
      private_key: '',
      public_key: '',
      refresh_token: null,
      refresh_tokens: [],
      providers: [],
      preferences: {},
      context: {},
      picture: '',
      location: '',
      age_range: '',
      bg_music: null,
      chat_voice: null,
      passkeys: [],
      primary_conversation_id: null,
      newsletter_subscriber: false,
      verified: false,
      disabled: true,
      deleted: true,
      purge_status: 'purged',
      two_factor: {secret: null, enabled: false},
    },
  });
}

const STAGES = [
  {
    name: 'delivered_capsules',
    run: (c: IPurgeCommand) => anonymizeDeliveredCapsules(c.user_id),
  },
  {name: 'queued_work', run: cleanupQueuedWork},
  {name: 'provider_cleanup', run: cleanupProviders},
  {name: 'domain_records', run: deleteDomainRecords},
  {name: 'audit_anonymization', run: anonymizeAuditRecords},
  {name: 'user_tombstone', run: writeUserTombstone},
  {name: 'residual_sweep', run: deleteDomainRecords},
] as const;

async function runStage(
  command: IPurgeCommand,
  stage: (typeof STAGES)[number],
): Promise<void> {
  const existing = await PurgeStage.findOne({
    command_id: command._id,
    name: stage.name,
  });
  if (existing?.status === 'completed') return;

  const state = await PurgeStage.findOneAndUpdate(
    {command_id: command._id, name: stage.name},
    {
      $set: {status: 'running', started_at: new Date(), last_error_code: null},
      $inc: {attempts: 1},
      $setOnInsert: {command_id: command._id, name: stage.name},
    },
    {upsert: true, new: true},
  );

  try {
    await stage.run(command);
    await state.updateOne({
      $set: {
        status: 'completed',
        completed_at: new Date(),
        last_error_code: null,
      },
    });
  } catch (error) {
    await state.updateOne({
      $set: {status: 'failed', last_error_code: errorCode(error)},
    });
    throw error;
  }
}

export async function processPurgeCommand(commandId: string): Promise<void> {
  const existing = await PurgeCommand.findById(commandId);
  if (!existing || existing.status === 'completed') return;
  if (existing.schema_version !== PURGE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported purge schema version: ${existing.schema_version}`,
    );
  }

  const command = await PurgeCommand.findOneAndUpdate(
    {
      _id: commandId,
      $or: [
        {status: {$in: ['pending', 'failed']}},
        {
          status: 'running',
          started_at: {$lte: new Date(Date.now() - 15 * 60 * 1000)},
        },
      ],
    },
    {
      $set: {
        status: 'running',
        started_at: new Date(),
        last_error_code: null,
      },
      $inc: {attempts: 1},
    },
    {new: true},
  );
  if (!command) return;

  try {
    for (const stage of STAGES) await runStage(command, stage);
    await PurgeCommand.findByIdAndUpdate(command.id, {
      $set: {
        status: 'completed',
        completed_at: new Date(),
        email: null,
        last_error_code: null,
      },
    });
  } catch (error) {
    await PurgeCommand.findByIdAndUpdate(command.id, {
      $set: {status: 'failed', last_error_code: errorCode(error)},
    });
    logger.error(
      {commandId: command.id, stageErrorCode: errorCode(error)},
      'Account purge stage failed',
    );
    throw error;
  }
}
