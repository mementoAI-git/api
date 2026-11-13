import {Environment} from '@apple/app-store-server-library';
import {describe, expect, it} from 'vitest';
import {
  getAppleVerifier,
  verifyAppleNotificationPayload,
} from '../../src/module/api/billing/providers/iap-verifier';

describe('Apple production verification', () => {
  it('can build the verifier real App Store purchases need', () => {
    // Apple's library refuses a Production verifier without the app's
    // numeric App Store id, which failed every real purchase.
    expect(() => getAppleVerifier(Environment.PRODUCTION)).not.toThrow();
  });

  it('turns a bad App Store notification into a verification failure', async () => {
    await expect(
      verifyAppleNotificationPayload('not.a.jws'),
    ).rejects.toMatchObject({statusCode: 401});
  });
});
