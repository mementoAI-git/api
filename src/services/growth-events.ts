import {createHmac} from 'crypto';
import {
  isGrowthAnalyticsEnabled,
  readGrowthAnalyticsConfig,
  recordGrowthEvent,
} from './growth-analytics';
import GrowthInvitation from '../module/database/model/growth-invitation';
import Beneficiary from '../module/database/model/beneficiary';
import Message from '../module/database/model/message';
import Group from '../module/database/model/group';
import SharedSpace from '../module/database/model/shared-space';
import User from '../module/database/model/user';

/** Every domain adapter is isolated: analytics must never fail a successful action. */
async function isolated(run: () => Promise<void>) {
  try {
    if (isGrowthAnalyticsEnabled()) await run();
  } catch {
    // Delivery is optional. Do not log identifiers, addresses or message content.
  }
}
export function recipientKey(email: string): string | undefined {
  const secret = readGrowthAnalyticsConfig()?.identitySecret;
  if (!secret || !email?.trim()) return undefined;
  return createHmac('sha256', secret)
    .update(email.trim().toLowerCase())
    .digest('hex');
}

export async function invitationDelivered(
  invitation: {id?: string; _id?: unknown; email: string; benefactor: unknown},
  existingUser: boolean,
) {
  await isolated(async () => {
    const invitee_key = recipientKey(invitation.email);
    if (!invitee_key) return;
    const inviter_id = String(invitation.benefactor);
    const invitation_id = createHmac(
      'sha256',
      readGrowthAnalyticsConfig().identitySecret,
    )
      .update(`invitation:${inviter_id}:${invitee_key}`)
      .digest('hex');
    // A pending grant can still have user=null after an ordinary signup.
    // Snapshot actual account existence; the first receipt keeps this value on resends.
    const existing_user =
      existingUser ||
      Boolean(
        await User.exists({
          email: invitation.email.trim().toLowerCase(),
        }),
      );
    const receipt = await GrowthInvitation.findOneAndUpdate(
      {_id: invitation_id},
      {
        $set: {beneficiary_id: String(invitation._id || invitation.id)},
        $setOnInsert: {
          inviter_id,
          invitee_key,
          existing_user,
          sent_at: new Date(),
        },
      },
      {upsert: true, new: true},
    );
    await recordGrowthEvent({
      event: 'growth_invitation_sent',
      distinctId: inviter_id,
      key: `invitation:${invitation_id}`,
      timestamp: receipt.sent_at,
      properties: {
        invitation_id,
        inviter_id,
        invitee_key,
        existing_user: receipt.existing_user,
      },
    });
  });
}

type Account = {
  _id?: unknown;
  id?: string;
  email: string;
  created_at?: string | Date;
  referred_by?: unknown;
};
export async function accountCreated(
  user: Account,
  method: 'email' | 'oauth' | 'invitation',
) {
  await isolated(async () => {
    const account_id = String(user._id || user.id);
    const timestamp = new Date(user.created_at || Date.now());
    const invitee_key = recipientKey(user.email);
    const receipts = invitee_key
      ? await GrowthInvitation.find({
          invitee_key,
          existing_user: false,
          sent_at: {$lte: timestamp},
        })
          .sort({sent_at: 1})
          .lean()
      : [];
    // Only a valid, matching, still-live emailed invitation may attribute a signup.
    const valid = [];
    for (const receipt of receipts) {
      const beneficiary = await Beneficiary.findOne({
        _id: receipt.beneficiary_id,
        benefactor: receipt.inviter_id,
        status: {$in: ['pending', 'accepted']},
        due_at: {$gte: timestamp},
      });
      if (beneficiary && recipientKey(beneficiary.email) === invitee_key)
        valid.push(receipt);
    }
    const first = valid[0];
    const inviter_id = user.referred_by
      ? String(user.referred_by)
      : first?.inviter_id;
    await recordGrowthEvent({
      event: 'growth_account_created',
      distinctId: account_id,
      key: `account:${account_id}`,
      timestamp,
      properties: {
        acquisition_source: user.referred_by
          ? 'referral'
          : first
            ? 'invitation'
            : 'organic',
        registration_method: method,
        ...(inviter_id ? {inviter_id} : {}),
        ...(first ? {invitation_id: first._id, invitee_key} : {}),
      },
    });
    for (const receipt of valid) {
      await recordGrowthEvent({
        event: 'growth_invitation_converted',
        distinctId: account_id,
        key: `conversion:${receipt._id}:${account_id}`,
        timestamp,
        properties: {
          invitation_id: receipt._id,
          inviter_id: receipt.inviter_id,
          invitee_key,
          account_id,
          existing_user: false,
        },
      });
    }
  });
}

async function active(
  userId: string,
  kind: string,
  resourceId: string,
  timestamp: Date,
) {
  await recordGrowthEvent({
    event: 'growth_user_active',
    distinctId: userId,
    key: `active:${kind}:${resourceId}`,
    timestamp,
    properties: {activity_type: kind},
  });
}
export async function memoryCaptured(
  userId: string,
  memory: {
    id?: string;
    _id?: unknown;
    type?: string;
    status?: string;
    capture_source?: string;
    prompt?: unknown;
    prompt_type?: unknown;
    groups?: string[];
    beneficiaries?: string[];
    created_at?: string | Date;
  },
  timestamp?: Date,
) {
  await isolated(async () => {
    if (
      memory.type === 'conversation' ||
      !['save', 'queued', 'on_chain', 'published'].includes(memory.status)
    )
      return;
    const memory_id = String(memory._id || memory.id);
    const at = timestamp || new Date(memory.created_at || Date.now());
    const memory_kind =
      memory.prompt || memory.prompt_type
        ? 'reflection'
        : memory.capture_source === 'quick'
          ? 'quick'
          : 'story';
    const properties = {memory_id, memory_kind};
    await recordGrowthEvent({
      event: 'growth_memory_captured',
      distinctId: userId,
      key: `memory:${memory_id}`,
      timestamp: at,
      properties,
    });
    if (memory_kind === 'reflection') {
      await recordGrowthEvent({
        event: 'growth_reflection_added',
        distinctId: userId,
        key: `reflection:${memory_id}`,
        timestamp: at,
        properties,
      });
    }
    await active(userId, memory_kind, memory_id, at);
    await memoryShared(userId, memory);
  });
}

/** Explicit sharing is engagement for the pair; it does not imply a recipient view. */
export async function memoryShared(
  userId: string,
  memory: {
    id?: string;
    _id?: unknown;
    status?: string;
    type?: string;
    groups?: string[];
    beneficiaries?: string[];
  },
) {
  await isolated(async () => {
    if (
      memory.type === 'conversation' ||
      !['save', 'queued', 'on_chain', 'published'].includes(memory.status)
    )
      return;
    const ids = new Set((memory.beneficiaries || []).map(String));
    if (memory.groups?.length) {
      const groups = await Group.find({_id: {$in: memory.groups}, user: userId})
        .select('members')
        .lean();
      for (const group of groups)
        for (const id of group.members) ids.add(String(id));
    }
    if (!ids.size) return;
    const recipients = await Beneficiary.find({
      _id: {$in: [...ids]},
      benefactor: userId,
      status: 'accepted',
      user: {$nin: [null, '']},
      $or: [
        {access_scope: {$in: ['full_vault', 'memories_only', 'shared_only']}},
        {access_scope: {$exists: false}},
        {access_scope: null},
      ],
    })
      .select('user')
      .lean();
    for (const recipient of recipients) {
      const otherId = String(recipient.user);
      const user = await User.findOne({
        _id: otherId,
        deleted: {$ne: true},
        disabled: {$ne: true},
      })
        .select('_id')
        .lean();
      if (!user) continue;
      const connectionId = [userId, otherId].sort().join(':');
      const space = await SharedSpace.findById(connectionId)
        .select('status blocked_by')
        .lean();
      if (space?.status === 'removed' || space?.blocked_by?.length) continue;
      await connectionEngaged(userId, otherId, String(memory._id || memory.id));
    }
  });
}

export function completedExchanges(
  rows: Array<{
    role: string;
    voice_interrupted?: boolean;
    server_completed?: boolean;
    _id?: unknown;
    created_at?: string | Date;
  }>,
) {
  let pending = false;
  let count = 0;
  let completedAt: string | Date | undefined;
  let completionId: string | undefined;
  for (const row of rows) {
    if (row.role === 'user') pending = true;
    if (
      row.role === 'ai' &&
      pending &&
      row.server_completed === true &&
      !row.voice_interrupted
    ) {
      count++;
      completedAt = row.created_at;
      completionId = String(row._id);
    }
    if (row.role === 'ai') pending = false;
  }
  return {count, completedAt, completionId};
}
export async function conversationPersisted(
  userId: string,
  conversationId: string,
  channel: 'text' | 'voice',
) {
  await isolated(async () => {
    const rows = await Message.find({user: userId, memory: conversationId})
      .select('_id role voice_interrupted +server_completed created_at')
      .sort({_id: 1})
      .lean();
    const {count, completedAt, completionId} = completedExchanges(rows);
    if (count < 3 || !completedAt || !completionId) return;
    const timestamp = new Date(completedAt);
    const properties = {
      conversation_id: conversationId,
      completed_exchanges: count,
      channel,
    };
    await recordGrowthEvent({
      event: 'growth_conversation_meaningful',
      distinctId: userId,
      key: `conversation:${conversationId}:${completionId}`,
      timestamp,
      properties,
    });
    await active(userId, 'conversation', completionId, timestamp);
  });
}
export async function connectionActivated(
  first: string,
  second: string,
  timestamp = new Date(),
) {
  await connectionEvent(
    'growth_connection_activated',
    first,
    second,
    timestamp,
  );
}
export async function connectionEngaged(
  first: string,
  second: string,
  sourceId: string,
) {
  await connectionEvent(
    'growth_connection_engaged',
    first,
    second,
    new Date(),
    sourceId,
  );
}
async function connectionEvent(
  event: 'growth_connection_activated' | 'growth_connection_engaged',
  first: string,
  second: string,
  timestamp: Date,
  sourceId?: string,
) {
  await isolated(async () => {
    const connection_id = [String(first), String(second)].sort().join(':');
    for (const [userId, other_user_id] of [
      [String(first), String(second)],
      [String(second), String(first)],
    ]) {
      await recordGrowthEvent({
        event,
        distinctId: userId,
        key: `${event}:${connection_id}:${userId}${sourceId ? `:${sourceId}` : ''}`,
        timestamp,
        properties: {connection_id, other_user_id},
      });
    }
  });
}
