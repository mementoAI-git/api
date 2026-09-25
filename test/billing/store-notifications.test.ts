import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

const verifier = vi.hoisted(() => ({
  verifyAppleNotificationPayload: vi.fn(),
  verifyGooglePlayPurchase: vi.fn(),
}));

vi.mock('../../src/module/api/billing/providers/iap-verifier', () => verifier);

import {
  processAppleStoreNotification,
  processGooglePlayNotification,
} from '../../src/module/api/billing/store-notification-service';
import StoreNotificationEvent from '../../src/module/database/model/store-notification-event';
import Subscription from '../../src/module/database/model/subscription';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestReplicaSet,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

function googleEnvelope(messageId: string, purchaseToken: string) {
  return {
    message: {
      messageId,
      publishTime: '2026-09-24T12:00:00.000Z',
      data: Buffer.from(
        JSON.stringify({
          packageName: 'io.mymemento.app',
          subscriptionNotification: {notificationType: 5, purchaseToken},
        }),
      ).toString('base64'),
    },
  };
}

describe('store lifecycle notifications', () => {
  beforeAll(async () => {
    process.env.IAP_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      'base64',
    );
    await connectTestReplicaSet();
  });
  afterEach(async () => {
    vi.clearAllMocks();
    await clearTestDatabase();
  });
  afterAll(async () => {
    delete process.env.IAP_TOKEN_ENCRYPTION_KEY;
    await closeTestDatabase();
  });

  it('applies an Apple revocation once and removes effective access', async () => {
    const user = await createUserFixture();
    const subscription = await Subscription.create({
      user_id: user.id,
      tier: 'pro',
      status: 'active',
      payment_provider: 'apple',
    });
    verifier.verifyAppleNotificationPayload.mockResolvedValue({
      environment: 'Production',
      payload: {
        notificationUUID: 'apple-revoke-event',
        notificationType: 'REVOKE',
        signedDate: Date.parse('2026-09-24T12:00:00.000Z'),
        data: {status: 5},
      },
      transaction: {
        transactionId: 'apple-renewal-2',
        originalTransactionId: 'apple-original',
        productId: 'io.mymemento.app.pro.monthly',
        appAccountToken: subscription.store_account_token,
        purchaseDate: Date.parse('2026-09-01T00:00:00.000Z'),
        expiresDate: Date.parse('2026-10-01T00:00:00.000Z'),
      },
      renewal: {autoRenewStatus: 0},
    });

    await expect(
      processAppleStoreNotification('signed-apple-payload'),
    ).resolves.toMatchObject({status: 'applied'});
    await expect(
      processAppleStoreNotification('signed-apple-payload'),
    ).resolves.toMatchObject({duplicate: true});

    expect(await Subscription.findOne({user_id: user.id}).lean()).toMatchObject(
      {
        tier: 'free',
        status: 'cancelled',
        payment_provider: 'apple',
      },
    );
    expect(
      await StoreNotificationEvent.countDocuments({
        event_id: 'apple-revoke-event',
      }),
    ).toBe(1);
  });

  it('applies Google account hold from the authoritative Play response', async () => {
    const user = await createUserFixture();
    const subscription = await Subscription.create({
      user_id: user.id,
      tier: 'pro',
      status: 'active',
      payment_provider: 'google',
    });
    verifier.verifyGooglePlayPurchase.mockResolvedValue({
      verifiedTransactionId: 'google-current-token',
      originalTransactionId: 'google-root-token',
      productId: 'memento_pro_monthly',
      purchaseDate: new Date('2026-09-01T00:00:00.000Z'),
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      environment: 'Production',
      storeAccountToken: subscription.store_account_token,
      chainAliases: ['google-current-token', 'google-root-token'],
      autoRenewEnabled: true,
      rawPayload: {subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD'},
    });

    await processGooglePlayNotification(
      googleEnvelope('google-hold-event', 'google-current-token'),
    );

    expect(await Subscription.findOne({user_id: user.id}).lean()).toMatchObject(
      {
        tier: 'free',
        status: 'past_due',
        payment_provider: 'google',
      },
    );
    expect(
      await StoreNotificationEvent.findOne({
        event_id: 'google-hold-event',
      }).lean(),
    ).toMatchObject({status: 'applied', user_id: user.id});
  });

  it('keeps an authenticated but unowned Google notification for later mapping', async () => {
    verifier.verifyGooglePlayPurchase.mockResolvedValue({
      verifiedTransactionId: 'legacy-google-token',
      productId: 'memento_pro_annual',
      purchaseDate: new Date('2026-09-01T00:00:00.000Z'),
      expiresAt: new Date('2027-09-01T00:00:00.000Z'),
      environment: 'Production',
      chainAliases: ['legacy-google-token'],
      autoRenewEnabled: true,
      rawPayload: {subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE'},
    });

    await expect(
      processGooglePlayNotification(
        googleEnvelope('google-unmapped-event', 'legacy-google-token'),
      ),
    ).resolves.toMatchObject({status: 'unmapped'});
    expect(
      await StoreNotificationEvent.findOne({
        event_id: 'google-unmapped-event',
      }).lean(),
    ).toMatchObject({status: 'unmapped', user_id: null});
  });
});
