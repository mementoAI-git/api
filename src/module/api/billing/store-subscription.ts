import {createHash} from 'crypto';
import type {
  StoreEntitlementStatus,
  StoreEnvironment,
  StoreProvider,
} from '../../database/model/iap-subscription-chain';

export interface StoreSubscriptionSnapshot {
  provider: StoreProvider;
  environment: StoreEnvironment;
  transactionId: string;
  chainAliases: string[];
  storeAccountToken?: string;
  productId: string;
  billingInterval: 'monthly' | 'annual';
  purchaseDate: Date;
  expiresAt: Date;
  entitlementStatus: StoreEntitlementStatus;
  entitlementActive: boolean;
  autoRenewEnabled?: boolean;
  providerModifiedAt: Date;
  eventType?: string;
  sanitizedMetadata?: Record<string, unknown>;
}

export function storeIdentifierKey(
  provider: StoreProvider,
  identifier: string,
): string {
  return createHash('sha256').update(`${provider}:${identifier}`).digest('hex');
}

export function uniqueStoreAliases(
  snapshot: StoreSubscriptionSnapshot,
): string[] {
  return [...new Set([snapshot.transactionId, ...snapshot.chainAliases])]
    .filter(Boolean)
    .map(alias => storeIdentifierKey(snapshot.provider, alias));
}
