import {OAuth2Client} from 'google-auth-library';
import {Status, AutoRenewStatus} from '@apple/app-store-server-library';
import {
  BadRequestException,
  UnauthorizedException,
} from '../../../utils/service-error';
import {
  GOOGLE_PLAY_RTDN_AUDIENCE,
  GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL,
} from '../../../utils/config';
import IapChainAlias from '../../database/model/iap-chain-alias';
import StoreNotificationEvent from '../../database/model/store-notification-event';
import Subscription from '../../database/model/subscription';
import {applyStoreSubscriptionSnapshot} from './store-entitlement-service';
import {
  storeIdentifierKey,
  type StoreSubscriptionSnapshot,
} from './store-subscription';
import {
  verifyAppleNotificationPayload,
  verifyGooglePlayPurchase,
} from './providers/iap-verifier';
import {decryptStoreSecret, encryptStoreSecret} from './providers/token-vault';

const APPLE_PRODUCTS: Record<string, 'monthly' | 'annual'> = {
  'io.mymemento.app.pro.monthly': 'monthly',
  'io.mymemento.app.pro.annual': 'annual',
};
const GOOGLE_PRODUCTS: Record<string, 'monthly' | 'annual'> = {
  memento_pro_monthly: 'monthly',
  memento_pro_annual: 'annual',
};

function duplicateKey(error: unknown): boolean {
  return (error as {code?: number})?.code === 11000;
}

async function resolveUser(
  provider: 'apple' | 'google',
  storeAccountToken: string | undefined,
  aliases: string[],
) {
  if (storeAccountToken) {
    const subscription = await Subscription.findOne({
      store_account_token: storeAccountToken,
    }).lean();
    if (subscription) return String(subscription.user_id);
  }
  const alias = await IapChainAlias.findOne({
    provider,
    alias_key: {$in: aliases.map(value => storeIdentifierKey(provider, value))},
  }).lean();
  return alias ? String(alias.user_id) : null;
}

function appleEntitlement(
  eventType: string,
  status: number | undefined,
  autoRenewEnabled: boolean,
  expiresAt: Date,
) {
  if (
    eventType === 'REFUND' ||
    eventType === 'REVOKE' ||
    status === Status.REVOKED
  ) {
    return {entitlementStatus: 'revoked' as const, entitlementActive: false};
  }
  if (status === Status.BILLING_GRACE_PERIOD) {
    return {
      entitlementStatus: 'grace_period' as const,
      entitlementActive: true,
    };
  }
  if (status === Status.BILLING_RETRY || eventType === 'GRACE_PERIOD_EXPIRED') {
    return {entitlementStatus: 'past_due' as const, entitlementActive: false};
  }
  if (
    status === Status.EXPIRED ||
    eventType === 'EXPIRED' ||
    expiresAt <= new Date()
  ) {
    return {entitlementStatus: 'expired' as const, entitlementActive: false};
  }
  if (!autoRenewEnabled) {
    return {
      entitlementStatus: 'cancelled_pending_expiry' as const,
      entitlementActive: true,
    };
  }
  return {entitlementStatus: 'active' as const, entitlementActive: true};
}

function googleEntitlement(
  state: string,
  expiresAt: Date,
  autoRenewEnabled?: boolean,
) {
  if (state === 'SUBSCRIPTION_STATE_ACTIVE') {
    return autoRenewEnabled === false
      ? {
          entitlementStatus: 'cancelled_pending_expiry' as const,
          entitlementActive: expiresAt > new Date(),
        }
      : {entitlementStatus: 'active' as const, entitlementActive: true};
  }
  if (state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') {
    return {
      entitlementStatus: 'grace_period' as const,
      entitlementActive: true,
    };
  }
  if (state === 'SUBSCRIPTION_STATE_ON_HOLD') {
    return {entitlementStatus: 'past_due' as const, entitlementActive: false};
  }
  if (state === 'SUBSCRIPTION_STATE_PAUSED') {
    return {entitlementStatus: 'paused' as const, entitlementActive: false};
  }
  if (state === 'SUBSCRIPTION_STATE_PENDING') {
    return {entitlementStatus: 'pending' as const, entitlementActive: false};
  }
  if (state === 'SUBSCRIPTION_STATE_CANCELED' && expiresAt > new Date()) {
    return {
      entitlementStatus: 'cancelled_pending_expiry' as const,
      entitlementActive: true,
    };
  }
  return {entitlementStatus: 'expired' as const, entitlementActive: false};
}

async function recordEvent(input: {
  provider: 'apple' | 'google';
  eventId: string;
  eventType: string;
  subtype?: string;
  providerPublishedAt?: Date;
  normalizedPayload: Record<string, unknown>;
  replayPayload?: string;
}) {
  try {
    return await StoreNotificationEvent.create({
      provider: input.provider,
      event_id: input.eventId,
      event_type: input.eventType,
      subtype: input.subtype,
      provider_published_at: input.providerPublishedAt,
      normalized_payload: input.normalizedPayload,
      encrypted_provider_token: input.replayPayload
        ? encryptStoreSecret(input.replayPayload)
        : null,
      status: 'pending',
    });
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    return StoreNotificationEvent.findOne({
      provider: input.provider,
      event_id: input.eventId,
    }).orFail();
  }
}

export async function processAppleStoreNotification(signedPayload: string) {
  if (!signedPayload)
    throw new BadRequestException('signedPayload is required');
  const verified = await verifyAppleNotificationPayload(signedPayload);
  const {payload, transaction, renewal} = verified;
  if (!payload.notificationUUID || !payload.notificationType) {
    throw new BadRequestException(
      'Apple notification is missing identity fields',
    );
  }
  const event = await recordEvent({
    provider: 'apple',
    eventId: payload.notificationUUID,
    eventType: String(payload.notificationType),
    subtype: payload.subtype ? String(payload.subtype) : undefined,
    providerPublishedAt: payload.signedDate
      ? new Date(payload.signedDate)
      : undefined,
    normalizedPayload: {
      environment: verified.environment,
      notificationType: payload.notificationType,
      subtype: payload.subtype,
    },
    replayPayload: signedPayload,
  });
  if (event.status === 'applied' || event.status === 'ignored') {
    return {duplicate: true, status: event.status};
  }
  if (
    !transaction?.transactionId ||
    !transaction.productId ||
    !transaction.expiresDate
  ) {
    await event.updateOne({
      $set: {status: 'ignored', processed_at: new Date()},
    });
    return {duplicate: false, status: 'ignored'};
  }
  const interval = APPLE_PRODUCTS[transaction.productId];
  if (!interval) {
    await event.updateOne({
      $set: {status: 'ignored', processed_at: new Date()},
    });
    return {duplicate: false, status: 'ignored'};
  }
  const aliases = [
    transaction.transactionId,
    transaction.originalTransactionId || transaction.transactionId,
  ];
  const storeAccountToken =
    transaction.appAccountToken || renewal?.appAccountToken;
  const userId = await resolveUser('apple', storeAccountToken, aliases);
  if (!userId) {
    await event.updateOne({$set: {status: 'unmapped'}});
    return {duplicate: false, status: 'unmapped'};
  }
  const expiresAt = new Date(transaction.expiresDate);
  const autoRenewEnabled = renewal?.autoRenewStatus === AutoRenewStatus.ON;
  const entitlement = appleEntitlement(
    String(payload.notificationType),
    typeof payload.data?.status === 'number' ? payload.data.status : undefined,
    autoRenewEnabled,
    expiresAt,
  );
  const snapshot: StoreSubscriptionSnapshot = {
    provider: 'apple',
    environment: verified.environment,
    transactionId: transaction.transactionId,
    chainAliases: aliases,
    storeAccountToken,
    productId: transaction.productId,
    billingInterval: interval,
    purchaseDate: new Date(
      transaction.purchaseDate || payload.signedDate || Date.now(),
    ),
    expiresAt,
    ...entitlement,
    autoRenewEnabled,
    providerModifiedAt: new Date(
      payload.signedDate || transaction.signedDate || Date.now(),
    ),
    eventType: String(payload.notificationType),
    sanitizedMetadata: {subtype: payload.subtype, status: payload.data?.status},
  };
  await applyStoreSubscriptionSnapshot({
    snapshot,
    userId,
    notificationEventId: payload.notificationUUID,
  });
  return {duplicate: false, status: 'applied'};
}

interface PubSubEnvelope {
  message?: {messageId?: string; publishTime?: string; data?: string};
}

export async function verifyGooglePubSubRequest(
  authorization: string | undefined,
): Promise<void> {
  if (!GOOGLE_PLAY_RTDN_AUDIENCE || !GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL) {
    throw new UnauthorizedException('Google Play RTDN is not configured');
  }
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new UnauthorizedException('Missing Pub/Sub bearer token');
  const ticket = await new OAuth2Client().verifyIdToken({
    idToken: token,
    audience: GOOGLE_PLAY_RTDN_AUDIENCE,
  });
  const payload = ticket.getPayload();
  if (
    !payload ||
    payload.email !== GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL ||
    payload.email_verified !== true ||
    !['accounts.google.com', 'https://accounts.google.com'].includes(
      String(payload.iss),
    )
  ) {
    throw new UnauthorizedException('Invalid Pub/Sub identity');
  }
}

export async function processGooglePlayNotification(envelope: PubSubEnvelope) {
  const message = envelope.message;
  if (!message?.messageId || !message.data) {
    throw new BadRequestException('Invalid Pub/Sub message envelope');
  }
  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
  } catch {
    throw new BadRequestException('Invalid Pub/Sub message data');
  }
  if (decoded.packageName !== 'io.mymemento.app') {
    throw new BadRequestException('Google Play package name mismatch');
  }
  const notification = decoded.subscriptionNotification as
    | {notificationType?: number; purchaseToken?: string}
    | undefined;
  if (!notification?.purchaseToken) {
    await recordEvent({
      provider: 'google',
      eventId: message.messageId,
      eventType: 'IGNORED',
      normalizedPayload: {version: decoded.version},
    }).then(event =>
      event.updateOne({$set: {status: 'ignored', processed_at: new Date()}}),
    );
    return {duplicate: false, status: 'ignored'};
  }
  const eventType = String(notification.notificationType ?? 'unknown');
  const event = await recordEvent({
    provider: 'google',
    eventId: message.messageId,
    eventType,
    providerPublishedAt: message.publishTime
      ? new Date(message.publishTime)
      : undefined,
    normalizedPayload: {notificationType: notification.notificationType},
    replayPayload: JSON.stringify(envelope),
  });
  if (event.status === 'applied' || event.status === 'ignored') {
    return {duplicate: true, status: event.status};
  }
  const verified = await verifyGooglePlayPurchase(
    notification.purchaseToken,
    undefined,
    true,
  );
  const interval = GOOGLE_PRODUCTS[verified.productId];
  if (!interval) {
    await event.updateOne({
      $set: {status: 'ignored', processed_at: new Date()},
    });
    return {duplicate: false, status: 'ignored'};
  }
  const aliases = verified.chainAliases ?? [notification.purchaseToken];
  const userId = await resolveUser(
    'google',
    verified.storeAccountToken,
    aliases,
  );
  if (!userId) {
    await event.updateOne({$set: {status: 'unmapped'}});
    return {duplicate: false, status: 'unmapped'};
  }
  const state = String(verified.rawPayload.subscriptionState || '');
  const entitlement = googleEntitlement(
    state,
    verified.expiresAt,
    verified.autoRenewEnabled,
  );
  await applyStoreSubscriptionSnapshot({
    userId,
    notificationEventId: message.messageId,
    snapshot: {
      provider: 'google',
      environment: verified.environment ?? 'Production',
      transactionId: verified.verifiedTransactionId,
      chainAliases: aliases,
      storeAccountToken: verified.storeAccountToken,
      productId: verified.productId,
      billingInterval: interval,
      purchaseDate: verified.purchaseDate,
      expiresAt: verified.expiresAt,
      ...entitlement,
      autoRenewEnabled: verified.autoRenewEnabled,
      providerModifiedAt: message.publishTime
        ? new Date(message.publishTime)
        : (verified.providerModifiedAt ?? new Date()),
      eventType,
      sanitizedMetadata: verified.rawPayload,
    },
  });
  return {duplicate: false, status: 'applied'};
}

export async function retryStoreNotificationEvent(eventId: string) {
  const event = await StoreNotificationEvent.findById(eventId).select(
    '+encrypted_provider_token',
  );
  if (!event || !event.encrypted_provider_token) return false;
  const payload = decryptStoreSecret(event.encrypted_provider_token);
  await event.updateOne({
    $set: {status: 'processing'},
    $inc: {attempts: 1},
  });
  try {
    if (event.provider === 'apple') {
      await processAppleStoreNotification(payload);
    } else {
      await processGooglePlayNotification(
        JSON.parse(payload) as PubSubEnvelope,
      );
    }
    return true;
  } catch (error) {
    await event.updateOne({
      $set: {
        status: 'failed',
        last_error: (error instanceof Error
          ? error.message
          : String(error)
        ).slice(0, 500),
      },
    });
    throw error;
  }
}
