import {createHash, randomBytes, timingSafeEqual} from 'crypto';
import Capsule, {
  type ICapsuleRecipientSnapshot,
} from '../../database/model/capsule';
import CapsuleDelivery from '../../database/model/capsule-delivery';
import mail from '../../mail';
import {FRONTEND_URL} from '../../../utils/config';
import {UnauthorizedException} from '../../../utils/service-error';
import logger from '../../../utils/logger';
import {sendCapsuleReadyPush} from '../../../services/push-notifications';

const EXTERNAL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VIEW_GRANT_TTL_MS = 15 * 60 * 1000;

function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function lookupSecretHash(hash: string): string {
  return hash.slice(0, 16);
}

function secretMatches(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function externalViewUrl(token: string): string {
  return `${FRONTEND_URL || 'http://localhost:5173'}/capsule/view?token=${encodeURIComponent(token)}`;
}

async function updateSnapshot(
  capsuleId: string,
  recipientId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const set = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      `recipient_snapshots.$[recipient].${key}`,
      value,
    ]),
  );
  await Capsule.updateOne(
    {_id: capsuleId},
    {$set: set},
    {arrayFilters: [{'recipient.recipient_id': recipientId}]},
  );
}

function failureCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String(error.code).slice(0, 80);
  }
  return 'delivery_failed';
}

export async function deliverCapsuleRecipient(
  capsuleId: string,
  snapshot: ICapsuleRecipientSnapshot,
  benefactorName: string,
): Promise<boolean | null> {
  await CapsuleDelivery.updateOne(
    {capsule_id: capsuleId, recipient_id: snapshot.recipient_id},
    {
      $setOnInsert: {
        recipient_email: snapshot.email,
        ...(snapshot.linked_user_id && {
          linked_user_id: snapshot.linked_user_id,
        }),
        status: 'pending',
        attempt_count: 0,
      },
    },
    {upsert: true},
  );

  const existing = await CapsuleDelivery.findOne({
    capsule_id: capsuleId,
    recipient_id: snapshot.recipient_id,
  });
  if (!existing) return false;
  if (['sent', 'delivered'].includes(existing.status)) return true;

  const staleBefore = new Date(Date.now() - 15 * 60 * 1000);

  const attempt = await CapsuleDelivery.findOneAndUpdate(
    {
      _id: existing._id,
      $or: [
        {status: {$in: ['pending', 'failed']}},
        {status: 'processing', last_attempt_at: {$lte: staleBefore}},
      ],
    },
    {
      $set: {status: 'processing', last_attempt_at: new Date()},
      $inc: {attempt_count: 1},
      $unset: {failure_code: 1},
    },
    {new: true},
  );
  if (!attempt) return existing.status === 'processing' ? null : false;

  try {
    const capsule = await Capsule.findById(capsuleId).lean();
    if (!capsule)
      throw Object.assign(new Error('Capsule not found'), {
        code: 'capsule_missing',
      });

    if (snapshot.linked_user_id) {
      const received = await Capsule.findOneAndUpdate(
        {
          source: capsuleId,
          user: snapshot.linked_user_id,
          status: 'received',
        },
        {
          $setOnInsert: {
            benefactor: String(capsule.user),
            title: capsule.title,
            body: capsule.body,
            attachments: capsule.attachments || [],
            memories: capsule.memories || [],
            style: capsule.style,
            recipients: [],
          },
        },
        {new: true, upsert: true, setDefaultsOnInsert: true},
      );
      await mail.sendCapsuleReveal({
        email: snapshot.email,
        name: snapshot.display_name || '',
        url: `${FRONTEND_URL || 'http://localhost:5173'}/timecapsule/${received.id}`,
        benefactorName,
      });
      await sendCapsuleReadyPush(snapshot.linked_user_id, received.id);
      const now = new Date();
      await CapsuleDelivery.updateOne(
        {_id: attempt._id},
        {
          $set: {
            status: 'delivered',
            delivered_at: now,
            received_capsule_id: received.id,
          },
        },
      );
      await updateSnapshot(capsuleId, snapshot.recipient_id, {
        delivery_status: 'delivered',
        delivered_at: now,
        last_attempt_at: now,
      });
      return true;
    }

    const token = newSecret();
    const tokenHash = hashSecret(token);
    const tokenExpiresAt = new Date(Date.now() + EXTERNAL_TOKEN_TTL_MS);
    await CapsuleDelivery.updateOne(
      {_id: attempt._id},
      {
        $set: {
          view_token_lookup: lookupSecretHash(tokenHash),
          view_token_hash: tokenHash,
          view_token_expires_at: tokenExpiresAt,
        },
      },
    );
    await mail.sendCapsuleReveal({
      email: snapshot.email,
      name: snapshot.display_name || '',
      url: externalViewUrl(token),
      benefactorName,
    });
    const now = new Date();
    await CapsuleDelivery.updateOne(
      {_id: attempt._id},
      {$set: {status: 'sent', delivered_at: now}},
    );
    await updateSnapshot(capsuleId, snapshot.recipient_id, {
      delivery_status: 'sent',
      delivered_at: now,
      last_attempt_at: now,
    });
    return true;
  } catch (error) {
    const code = failureCode(error);
    await CapsuleDelivery.updateOne(
      {_id: attempt._id},
      {$set: {status: 'failed', failure_code: code}},
    );
    await updateSnapshot(capsuleId, snapshot.recipient_id, {
      delivery_status: 'failed',
      failure_code: code,
      last_attempt_at: new Date(),
    });
    logger.warn(
      {capsuleId, recipientId: snapshot.recipient_id, failureCode: code},
      'Capsule recipient delivery failed',
    );
    return false;
  }
}

export async function exchangeExternalViewToken(token: string): Promise<{
  grant: string;
  expires_at: Date;
}> {
  const tokenHash = hashSecret(token || '');
  const delivery = await CapsuleDelivery.findOne({
    view_token_lookup: lookupSecretHash(tokenHash),
  }).select(
    '+view_token_lookup +view_token_hash +view_token_expires_at +token_exchanged_at +revoked_at',
  );
  if (
    !delivery?.view_token_hash ||
    !secretMatches(token, delivery.view_token_hash) ||
    delivery.token_exchanged_at ||
    delivery.revoked_at ||
    !delivery.view_token_expires_at ||
    delivery.view_token_expires_at <= new Date()
  ) {
    throw new UnauthorizedException('Capsule link is invalid or expired');
  }

  const grant = newSecret();
  const grantHash = hashSecret(grant);
  const expiresAt = new Date(Date.now() + VIEW_GRANT_TTL_MS);
  const consumed = await CapsuleDelivery.updateOne(
    {_id: delivery._id, token_exchanged_at: {$exists: false}},
    {
      $set: {
        token_exchanged_at: new Date(),
        view_grant_lookup: lookupSecretHash(grantHash),
        view_grant_hash: grantHash,
        view_grant_expires_at: expiresAt,
      },
      $unset: {view_token_hash: 1},
    },
  );
  if (consumed.modifiedCount !== 1) {
    throw new UnauthorizedException('Capsule link is invalid or expired');
  }
  return {grant, expires_at: expiresAt};
}

export async function getExternalCapsule(grant: string) {
  const grantHash = hashSecret(grant || '');
  const delivery = await CapsuleDelivery.findOne({
    view_grant_lookup: lookupSecretHash(grantHash),
  }).select(
    '+view_grant_lookup +view_grant_hash +view_grant_expires_at +revoked_at',
  );
  if (
    !delivery?.view_grant_hash ||
    !secretMatches(grant, delivery.view_grant_hash) ||
    delivery.revoked_at ||
    !delivery.view_grant_expires_at ||
    delivery.view_grant_expires_at <= new Date()
  ) {
    throw new UnauthorizedException('Capsule view has expired');
  }

  const capsule = await Capsule.findById(delivery.capsule_id)
    .populate({path: 'attachments', select: '-base64'})
    .populate({
      path: 'memories',
      select: '_id title body tags created_at attachments status',
      populate: {path: 'attachments', select: '-base64'},
    })
    .lean();
  if (!capsule) throw new UnauthorizedException('Capsule view has expired');

  if (delivery.status === 'sent') {
    const now = new Date();
    await CapsuleDelivery.updateOne(
      {_id: delivery._id},
      {$set: {status: 'delivered', delivered_at: now}},
    );
    await updateSnapshot(delivery.capsule_id, delivery.recipient_id, {
      delivery_status: 'delivered',
      delivered_at: now,
    });
  }

  return {
    _id: capsule._id,
    title: capsule.title,
    body: capsule.body,
    schedule_date: capsule.schedule_date,
    style: capsule.style,
    attachments: capsule.attachments || [],
    memories: capsule.memories || [],
    created_at: capsule.created_at,
  };
}
