import {generateKeyPairSync} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {afterEach, describe, expect, it, vi} from 'vitest';

const PRODUCT_ID = 'io.mymemento.app.pro.monthly';

function makeXcodeTransaction(): string {
  const {privateKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  const now = Date.now();
  return jwt.sign(
    {
      transactionId: 'xcode-transaction',
      originalTransactionId: 'xcode-original-transaction',
      bundleId: 'io.mymemento.app',
      productId: PRODUCT_ID,
      purchaseDate: now,
      expiresDate: now + 60 * 60 * 1000,
      quantity: 1,
      type: 'Auto-Renewable Subscription',
      inAppOwnershipType: 'PURCHASED',
      signedDate: now,
      environment: 'Xcode',
    },
    privateKey,
    {algorithm: 'ES256'},
  );
}

describe('Xcode StoreKit transaction verification', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('accepts Xcode-local transactions only in the development environment', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const {verifyAppleStoreKit2Jws} = await import(
      '../../src/module/api/billing/providers/iap-verifier'
    );

    const purchase = await verifyAppleStoreKit2Jws(
      makeXcodeTransaction(),
      PRODUCT_ID,
    );

    expect(purchase.verifiedTransactionId).toBe('xcode-transaction');
    expect(purchase.environment).toBe('Test');
  });

  it('rejects Xcode-local transactions in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const {verifyAppleStoreKit2Jws} = await import(
      '../../src/module/api/billing/providers/iap-verifier'
    );

    await expect(
      verifyAppleStoreKit2Jws(makeXcodeTransaction(), PRODUCT_ID),
    ).rejects.toThrow(/verification failed/);
  });
});
