import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

const iapVerifier = vi.hoisted(() => ({
  verifyAppleStoreKit2Jws: vi.fn(),
  verifyLegacyAppleReceipt: vi.fn(),
  verifyGooglePlayPurchase: vi.fn(),
}));

vi.mock(
  '../../src/module/api/billing/providers/iap-verifier',
  () => iapVerifier,
);

const polar = vi.hoisted(() => ({
  getPolarCustomer: vi.fn(async () => ({id: 'customer-id'})),
  updatePolarCancellation: vi.fn(async (_id: string, cancel: boolean) => ({
    status: 'canceled',
    cancel_at_period_end: cancel,
  })),
  cancelPolarSubscription: vi.fn(async () => ({
    id: 'polar-sub',
    status: 'canceled',
    cancel_at_period_end: true,
    canceled_at: new Date().toISOString(),
  })),
}));
vi.mock('../../src/module/api/billing/providers/polar', () => polar);

import {
  verifyIapPurchase,
  cancelSubscription,
} from '../../src/module/api/billing/service';
import IapTransaction from '../../src/module/database/model/iap-transaction';
import Subscription from '../../src/module/database/model/subscription';
import {storeIdentifierKey} from '../../src/module/api/billing/store-subscription';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('IAP Verification & Billing Service', () => {
  beforeAll(connectTestReplicaSet);
  afterEach(async () => {
    vi.clearAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('rejects unsupported SKU or platform mismatch', async () => {
    const user = await createUserFixture();
    await expect(
      verifyIapPurchase(user.id, {
        platform: 'ios',
        productId: 'invalid_sku',
        transactionId: 'tx_123',
        receiptData: 'some_receipt',
      }),
    ).rejects.toThrow(/Unrecognized or unsupported in-app purchase product/);

    await expect(
      verifyIapPurchase(user.id, {
        platform: 'ios',
        productId: 'memento_pro_monthly',
        transactionId: 'tx_123',
        receiptData: 'some_receipt',
      }),
    ).rejects.toThrow(/Unrecognized or unsupported in-app purchase product/);
  });

  it('fails closed on iOS when receiptData and purchaseToken are missing', async () => {
    const user = await createUserFixture();
    await expect(
      verifyIapPurchase(user.id, {
        platform: 'ios',
        productId: 'io.mymemento.app.pro.monthly',
        transactionId: 'tx_123',
      } as any),
    ).rejects.toThrow(/receiptData or purchaseToken is required/);
  });

  it('cryptographically verifies iOS purchase, updates ledger, and activates Pro subscription', async () => {
    const user = await createUserFixture();
    const purchaseDate = new Date('2026-09-01T10:00:00Z');
    const expiresAt = new Date('2026-10-01T10:00:00Z');

    iapVerifier.verifyAppleStoreKit2Jws.mockResolvedValueOnce({
      verifiedTransactionId: 'verified_apple_tx_999',
      originalTransactionId: 'verified_apple_tx_999',
      productId: 'io.mymemento.app.pro.monthly',
      purchaseDate,
      expiresAt,
      rawPayload: {bundleId: 'io.mymemento.app'},
    });

    const result = await verifyIapPurchase(user.id, {
      platform: 'ios',
      productId: 'io.mymemento.app.pro.monthly',
      transactionId: 'client_tx_123',
      receiptData: 'valid.jws.payload',
    });

    expect(result.data.success).toBe(true);
    expect(result.data.tier).toBe('pro');
    expect(result.data.status).toBe('active');
    expect(result.data.expiresAt).toBe(expiresAt.toISOString());

    // Verify ledger entry is keyed on the verified transaction id
    const tx = await IapTransaction.findOne({
      transaction_key: storeIdentifierKey('apple', 'verified_apple_tx_999'),
    });
    expect(tx).not.toBeNull();
    expect(tx?.user_id).toBe(user.id);
    expect(tx?.provider).toBe('apple');
    expect(tx?.expires_at?.toISOString()).toBe(expiresAt.toISOString());

    // Verify subscription model state
    const sub = await Subscription.findOne({user_id: user.id});
    expect(sub?.tier).toBe('pro');
    expect(sub?.status).toBe('active');
    expect(sub?.payment_provider).toBe('apple');
    expect(sub?.provider_subscription_id).toBe('verified_apple_tx_999');
    expect(sub?.current_period_end?.toISOString()).toBe(
      expiresAt.toISOString(),
    );
  });

  it('enforces anti-replay when another user attempts to claim the same store transaction', async () => {
    const user1 = await createUserFixture();
    const user2 = await createUserFixture();
    const expiresAt = new Date('2026-10-01T10:00:00Z');

    iapVerifier.verifyAppleStoreKit2Jws.mockResolvedValue({
      verifiedTransactionId: 'unique_store_tx_abc',
      productId: 'io.mymemento.app.pro.monthly',
      purchaseDate: new Date(),
      expiresAt,
      rawPayload: {},
    });

    // User 1 claims it
    await verifyIapPurchase(user1.id, {
      platform: 'ios',
      productId: 'io.mymemento.app.pro.monthly',
      transactionId: 'client_tx_1',
      receiptData: 'valid.receipt',
    });

    // User 2 attempts to claim the same store transaction
    await expect(
      verifyIapPurchase(user2.id, {
        platform: 'ios',
        productId: 'io.mymemento.app.pro.monthly',
        transactionId: 'client_tx_2',
        receiptData: 'valid.receipt',
      }),
    ).rejects.toThrow(/already been registered to another account/);
  });

  it('handles duplicate verification idempotently for the same user', async () => {
    const user = await createUserFixture();
    const expiresAt = new Date('2026-10-01T10:00:00Z');

    iapVerifier.verifyAppleStoreKit2Jws.mockResolvedValue({
      verifiedTransactionId: 'idempotent_tx_123',
      productId: 'io.mymemento.app.pro.monthly',
      purchaseDate: new Date(),
      expiresAt,
      rawPayload: {},
    });

    const res1 = await verifyIapPurchase(user.id, {
      platform: 'ios',
      productId: 'io.mymemento.app.pro.monthly',
      transactionId: 'idempotent_tx_123',
      receiptData: 'valid.receipt',
    });
    expect(res1.data.success).toBe(true);

    const res2 = await verifyIapPurchase(user.id, {
      platform: 'ios',
      productId: 'io.mymemento.app.pro.monthly',
      transactionId: 'idempotent_tx_123',
      receiptData: 'valid.receipt',
    });
    expect(res2.message).toBe('Transaction already verified');
    expect(res2.data.success).toBe(true);
    expect(res2.data.tier).toBe('pro');
  });

  it('converges concurrent first claims for the same user without duplicate ownership', async () => {
    const user = await createUserFixture();
    const expiresAt = new Date('2026-10-01T10:00:00Z');
    iapVerifier.verifyAppleStoreKit2Jws.mockResolvedValue({
      verifiedTransactionId: 'concurrent-same-user-tx',
      originalTransactionId: 'concurrent-same-user-root',
      productId: 'io.mymemento.app.pro.monthly',
      purchaseDate: new Date('2026-09-01T10:00:00Z'),
      expiresAt,
      rawPayload: {},
    });
    const body = {
      platform: 'ios' as const,
      productId: 'io.mymemento.app.pro.monthly',
      transactionId: 'client-concurrent',
      receiptData: 'concurrent.jws',
    };

    const results = await Promise.allSettled([
      verifyIapPurchase(user.id, body),
      verifyIapPurchase(user.id, body),
    ]);

    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    expect(
      await IapTransaction.countDocuments({
        provider: 'apple',
        transaction_key: storeIdentifierKey('apple', 'concurrent-same-user-tx'),
      }),
    ).toBe(1);
  });

  it('blocks a different account from claiming a renewal token from an existing subscription chain', async () => {
    const user1 = await createUserFixture();
    const user2 = await createUserFixture();
    const expiresAt = new Date('2026-10-01T10:00:00Z');
    const ORIGINAL_TX = 'original_chain_tx_abc';

    // User 1 activates with their initial purchase (transactionId = originalTransactionId)
    iapVerifier.verifyAppleStoreKit2Jws.mockResolvedValueOnce({
      verifiedTransactionId: ORIGINAL_TX,
      originalTransactionId: ORIGINAL_TX,
      productId: 'io.mymemento.app.pro.monthly',
      purchaseDate: new Date(),
      expiresAt,
      rawPayload: {},
    });
    await verifyIapPurchase(user1.id, {
      platform: 'ios',
      productId: 'io.mymemento.app.pro.monthly',
      transactionId: ORIGINAL_TX,
      receiptData: 'valid.receipt.initial',
    });

    // A month later, Apple issues a renewal with a NEW transactionId but the same originalTransactionId
    const RENEWAL_TX = 'renewal_chain_tx_xyz_month2';
    iapVerifier.verifyAppleStoreKit2Jws.mockResolvedValueOnce({
      verifiedTransactionId: RENEWAL_TX,
      originalTransactionId: ORIGINAL_TX, // same chain
      productId: 'io.mymemento.app.pro.monthly',
      purchaseDate: new Date(),
      expiresAt: new Date('2026-11-01T10:00:00Z'),
      rawPayload: {},
    });

    // User 2 (attacker) attempts to claim the renewal token
    await expect(
      verifyIapPurchase(user2.id, {
        platform: 'ios',
        productId: 'io.mymemento.app.pro.monthly',
        transactionId: RENEWAL_TX,
        receiptData: 'renewal.jws.payload',
      }),
    ).rejects.toThrow(/already linked to another account/);
  });

  it('accepts renewal tokens from the same user (extending subscription period)', async () => {
    const user = await createUserFixture();
    const ORIGINAL_TX = 'my_sub_original_tx';

    // Initial activation
    iapVerifier.verifyAppleStoreKit2Jws.mockResolvedValueOnce({
      verifiedTransactionId: ORIGINAL_TX,
      originalTransactionId: ORIGINAL_TX,
      productId: 'io.mymemento.app.pro.monthly',
      purchaseDate: new Date(),
      expiresAt: new Date('2026-10-01T10:00:00Z'),
      rawPayload: {},
    });
    await verifyIapPurchase(user.id, {
      platform: 'ios',
      productId: 'io.mymemento.app.pro.monthly',
      transactionId: ORIGINAL_TX,
      receiptData: 'initial.jws',
    });

    // Renewal — new transactionId, same originalTransactionId, later expiry
    const RENEWAL_TX = 'my_sub_renewal_tx_month2';
    const renewalExpiry = new Date('2026-11-01T10:00:00Z');
    iapVerifier.verifyAppleStoreKit2Jws.mockResolvedValueOnce({
      verifiedTransactionId: RENEWAL_TX,
      originalTransactionId: ORIGINAL_TX,
      productId: 'io.mymemento.app.pro.monthly',
      purchaseDate: new Date(),
      expiresAt: renewalExpiry,
      rawPayload: {},
    });

    const result = await verifyIapPurchase(user.id, {
      platform: 'ios',
      productId: 'io.mymemento.app.pro.monthly',
      transactionId: RENEWAL_TX,
      receiptData: 'renewal.jws',
    });

    expect(result.data.success).toBe(true);
    expect(result.data.expiresAt).toBe(renewalExpiry.toISOString());

    // Both transactions should be in the ledger
    const txCount = await IapTransaction.countDocuments({
      user_id: user.id,
      provider: 'apple',
    });
    expect(txCount).toBe(2);

    // Subscription end date extended to renewal period
    const sub = await Subscription.findOne({user_id: user.id});
    expect(sub?.current_period_end?.toISOString()).toBe(
      renewalExpiry.toISOString(),
    );
  });

  it('persists cancellation feedback reason and details upon subscription cancellation', async () => {
    const user = await createUserFixture();
    await Subscription.create({
      user_id: user.id,
      tier: 'pro',
      status: 'active',
      payment_provider: 'polar',
      provider_subscription_id: 'polar-sub',
      current_period_end: new Date('2026-12-01T00:00:00Z'),
    });

    const result = await cancelSubscription(user.id, {
      reason: 'too_expensive',
      details: 'Cannot afford monthly billing right now',
    });

    expect(result.data.status).toBe('cancelled');

    const updatedSub = await Subscription.findOne({user_id: user.id});
    expect(updatedSub?.cancellation_reason).toBe('too_expensive');
    expect(updatedSub?.cancellation_details).toBe(
      'Cannot afford monthly billing right now',
    );
  });
});
