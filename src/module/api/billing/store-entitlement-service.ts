import {randomUUID} from 'crypto';
import mongoose, {type ClientSession} from 'mongoose';
import {BadRequestException} from '../../../utils/service-error';
import IapChainAlias from '../../database/model/iap-chain-alias';
import IapSubscriptionChain from '../../database/model/iap-subscription-chain';
import IapTransaction from '../../database/model/iap-transaction';
import StoreNotificationEvent from '../../database/model/store-notification-event';
import Subscription from '../../database/model/subscription';
import type {ISubscription} from '../../database/model/subscription';
import type {HydratedDocument} from 'mongoose';
import {providerIsPaying} from './access';
import {
  storeIdentifierKey,
  uniqueStoreAliases,
  type StoreSubscriptionSnapshot,
} from './store-subscription';

interface ApplyStoreSnapshotOptions {
  snapshot: StoreSubscriptionSnapshot;
  userId: string;
  notificationEventId?: string;
  retryCount?: number;
}

function subscriptionStatus(snapshot: StoreSubscriptionSnapshot) {
  if (snapshot.entitlementStatus === 'paused') return 'paused' as const;
  if (
    snapshot.entitlementStatus === 'grace_period' ||
    snapshot.entitlementStatus === 'past_due'
  ) {
    return 'past_due' as const;
  }
  if (snapshot.entitlementStatus === 'cancelled_pending_expiry') {
    return 'cancelled' as const;
  }
  return snapshot.entitlementActive
    ? ('active' as const)
    : ('cancelled' as const);
}

async function resolveChain(
  snapshot: StoreSubscriptionSnapshot,
  userId: string,
  session: ClientSession,
) {
  const aliasKeys = uniqueStoreAliases(snapshot);
  const aliases = await IapChainAlias.find({
    provider: snapshot.provider,
    alias_key: {$in: aliasKeys},
  }).session(session);
  const foreign = aliases.find(
    alias => String(alias.user_id) !== String(userId),
  );
  if (foreign) {
    throw new BadRequestException(
      'This store transaction has already been registered to another account; this subscription is already linked to another account.',
    );
  }
  const chainIds = [...new Set(aliases.map(alias => alias.chain_id))];
  if (chainIds.length > 1) {
    throw new BadRequestException('Conflicting subscription chain ownership.');
  }
  const chainId = chainIds[0] ?? randomUUID();

  for (const aliasKey of aliasKeys) {
    await IapChainAlias.updateOne(
      {provider: snapshot.provider, alias_key: aliasKey},
      {
        $setOnInsert: {
          provider: snapshot.provider,
          alias_key: aliasKey,
          chain_id: chainId,
          user_id: userId,
        },
      },
      {upsert: true, session},
    );
  }
  return chainId;
}

export async function applyStoreSubscriptionSnapshot({
  snapshot,
  userId,
  notificationEventId,
  retryCount = 0,
}: ApplyStoreSnapshotOptions) {
  const session = await mongoose.startSession();
  let result: HydratedDocument<ISubscription> | null = null;
  let ignoredAsStale = false;
  let alreadyApplied = false;
  try {
    await session.withTransaction(async () => {
      const billingAccount = await Subscription.findOne({
        user_id: userId,
      }).session(session);
      if (
        snapshot.storeAccountToken &&
        billingAccount?.store_account_token !== snapshot.storeAccountToken
      ) {
        throw new BadRequestException(
          'This store purchase belongs to a different billing account.',
        );
      }

      const chainId = await resolveChain(snapshot, userId, session);
      alreadyApplied = Boolean(
        await IapTransaction.exists({
          provider: snapshot.provider,
          transaction_key: storeIdentifierKey(
            snapshot.provider,
            snapshot.transactionId,
          ),
          user_id: userId,
        }).session(session),
      );
      const currentChain = await IapSubscriptionChain.findOne({
        chain_id: chainId,
      })
        .session(session)
        .lean();
      if (
        currentChain?.provider_modified_at &&
        currentChain.provider_modified_at > snapshot.providerModifiedAt
      ) {
        ignoredAsStale = true;
        result = billingAccount;
      } else {
        const transactionKey = storeIdentifierKey(
          snapshot.provider,
          snapshot.transactionId,
        );
        await IapTransaction.findOneAndUpdate(
          {provider: snapshot.provider, transaction_key: transactionKey},
          {
            $setOnInsert: {
              provider: snapshot.provider,
              transaction_id: transactionKey,
              transaction_key: transactionKey,
              chain_id: chainId,
              original_transaction_id: storeIdentifierKey(
                snapshot.provider,
                snapshot.chainAliases[0] ?? snapshot.transactionId,
              ),
              user_id: userId,
              purchase_date: snapshot.purchaseDate,
            },
            $set: {
              product_id: snapshot.productId,
              status:
                snapshot.entitlementStatus === 'revoked'
                  ? 'revoked'
                  : snapshot.entitlementActive
                    ? 'active'
                    : 'expired',
              expires_at: snapshot.expiresAt,
              provider_modified_at: snapshot.providerModifiedAt,
              event_type: snapshot.eventType ?? null,
              environment: snapshot.environment,
              raw_payload: snapshot.sanitizedMetadata ?? null,
            },
          },
          {upsert: true, new: true, session},
        );
        await IapSubscriptionChain.findOneAndUpdate(
          {chain_id: chainId},
          {
            $setOnInsert: {
              chain_id: chainId,
              provider: snapshot.provider,
              user_id: userId,
            },
            $set: {
              store_account_token:
                snapshot.storeAccountToken ??
                billingAccount?.store_account_token ??
                null,
              product_id: snapshot.productId,
              billing_interval: snapshot.billingInterval,
              entitlement_status: snapshot.entitlementStatus,
              entitlement_active: snapshot.entitlementActive,
              current_period_start: snapshot.purchaseDate,
              current_period_end: snapshot.expiresAt,
              auto_renew_enabled: snapshot.autoRenewEnabled ?? null,
              latest_transaction_key: transactionKey,
              environment: snapshot.environment,
              provider_modified_at: snapshot.providerModifiedAt,
              last_verified_at: new Date(),
            },
          },
          {upsert: true, new: true, session},
        );

        // A store purchase may replace the plan unless another provider is
        // still being paid. An App Store subscription that lapsed must not
        // stop a later Google Play purchase from switching Pro on.
        const providerCanMutate =
          !billingAccount?.payment_provider ||
          billingAccount.payment_provider === snapshot.provider ||
          billingAccount.tier === 'free' ||
          !providerIsPaying(billingAccount);
        if (providerCanMutate) {
          result = await Subscription.findOneAndUpdate(
            {user_id: userId},
            {
              $setOnInsert: {user_id: userId},
              $set: {
                has_used_trial: true,
                tier: snapshot.entitlementActive ? 'pro' : 'free',
                status: subscriptionStatus(snapshot),
                payment_provider: snapshot.provider,
                billing_interval: snapshot.billingInterval,
                current_period_start: snapshot.purchaseDate,
                current_period_end: snapshot.expiresAt,
                provider_subscription_id: snapshot.transactionId,
                provider_modified_at: snapshot.providerModifiedAt,
                currency: 'USD',
                cancel_at_period_end:
                  snapshot.entitlementStatus === 'cancelled_pending_expiry' ||
                  snapshot.autoRenewEnabled === false,
                ended_at: snapshot.entitlementActive
                  ? null
                  : snapshot.expiresAt,
              },
            },
            {upsert: true, new: true, session},
          );
        } else {
          result = billingAccount;
        }
      }

      if (notificationEventId) {
        await StoreNotificationEvent.updateOne(
          {provider: snapshot.provider, event_id: notificationEventId},
          {
            $set: {
              status: ignoredAsStale ? 'ignored' : 'applied',
              user_id: userId,
              processed_at: new Date(),
              last_error: null,
            },
          },
          {session},
        );
      }
    });
  } catch (error) {
    if ((error as {code?: number})?.code === 11000) {
      const aliasKeys = uniqueStoreAliases(snapshot);
      const winningAliases = await IapChainAlias.find({
        provider: snapshot.provider,
        alias_key: {$in: aliasKeys},
      }).lean();
      if (
        retryCount < 2 &&
        winningAliases.length > 0 &&
        winningAliases.every(alias => String(alias.user_id) === String(userId))
      ) {
        return applyStoreSubscriptionSnapshot({
          snapshot,
          userId,
          notificationEventId,
          retryCount: retryCount + 1,
        });
      }
      throw new BadRequestException(
        'This store transaction has already been registered to another account; this subscription is already linked to another account.',
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return {subscription: result, ignoredAsStale, alreadyApplied};
}
