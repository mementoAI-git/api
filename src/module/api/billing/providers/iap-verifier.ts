/**
 * IAP Verifier — Production-Grade Store Purchase Verification
 *
 * Apple:  Uses the official @apple/app-store-server-library SignedDataVerifier,
 *         which handles the full ECDSA P-256 signature verification, IEEE-P1363
 *         encoding, x5c certificate chain validation against Apple-supplied DER
 *         root CAs, and OCSP revocation checking (when enableOnlineChecks=true).
 *
 * Google: Uses google-auth-library JWT to obtain an access token via the service
 *         account JSON key, then queries the Play Developer API. The token endpoint
 *         requires form-encoded data, which google-auth-library handles correctly.
 */
import fs from 'fs';
import path from 'path';
import {
  SignedDataVerifier,
  Environment,
  VerificationException,
  type ResponseBodyV2DecodedPayload,
  type JWSTransactionDecodedPayload,
  type JWSRenewalInfoDecodedPayload,
} from '@apple/app-store-server-library';
import {JWT} from 'google-auth-library';
import axios from 'axios';
import {
  ServiceError,
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '../../../../utils/service-error';
import {IS_DEV_ENV} from '../../../../utils/config';

export interface VerifiedStorePurchase {
  /**
   * The unique `transactionId` of THIS specific transaction (not originalTransactionId).
   * Used as the ledger deduplication key — each renewal gets its own entry.
   */
  verifiedTransactionId: string;
  /**
   * The `originalTransactionId` that chains all renewals of a subscription together.
   * Used for subscription ownership lookups (anti-theft).
   */
  originalTransactionId?: string;
  productId: string;
  purchaseDate: Date;
  expiresAt: Date;
  rawPayload: Record<string, unknown>;
  environment?: 'Production' | 'Sandbox' | 'Test';
  storeAccountToken?: string;
  chainAliases?: string[];
  autoRenewEnabled?: boolean;
  providerModifiedAt?: Date;
}

// ---------------------------------------------------------------------------
// Apple Root CA DER Buffers — loaded once at module initialization.
// Trust is pinned exclusively to these known-good DER-encoded certificates.
// ---------------------------------------------------------------------------
const CERTS_DIR = path.join(__dirname, 'certs');

function loadAppleRootCAs(): Buffer[] {
  const cerFiles = ['AppleRootCA-G3.cer', 'AppleRootCA-G2.cer'];
  const loaded: Buffer[] = [];
  for (const f of cerFiles) {
    const p = path.join(CERTS_DIR, f);
    if (fs.existsSync(p)) {
      loaded.push(fs.readFileSync(p));
    }
  }
  if (loaded.length === 0) {
    throw new Error(
      'No Apple Root CA certificates found. Ensure AppleRootCA-G3.cer / AppleRootCA-G2.cer exist in providers/certs/.',
    );
  }
  return loaded;
}

let _appleRootCAs: Buffer[] | null = null;
function getAppleRootCAs(): Buffer[] {
  if (!_appleRootCAs) {
    _appleRootCAs = loadAppleRootCAs();
  }
  return _appleRootCAs;
}

let _verifierProd: SignedDataVerifier | null = null;
let _verifierSandbox: SignedDataVerifier | null = null;
let _verifierXcode: SignedDataVerifier | null = null;

export function getAppleVerifier(env: Environment): SignedDataVerifier {
  const enableOnlineChecks = env === Environment.PRODUCTION;
  if (env === Environment.PRODUCTION) {
    if (!_verifierProd) {
      _verifierProd = new SignedDataVerifier(
        getAppleRootCAs(),
        enableOnlineChecks,
        Environment.PRODUCTION,
        'io.mymemento.app',
      );
    }
    return _verifierProd;
  } else if (env === Environment.SANDBOX) {
    if (!_verifierSandbox) {
      _verifierSandbox = new SignedDataVerifier(
        getAppleRootCAs(),
        enableOnlineChecks,
        Environment.SANDBOX,
        'io.mymemento.app',
      );
    }
    return _verifierSandbox;
  }

  if (env === Environment.XCODE && IS_DEV_ENV) {
    if (!_verifierXcode) {
      // Apple's library deliberately skips certificate-chain verification for
      // Xcode StoreKit transactions because they are locally generated and not
      // signed by the App Store. This verifier is unreachable in production.
      _verifierXcode = new SignedDataVerifier(
        [],
        false,
        Environment.XCODE,
        'io.mymemento.app',
      );
    }
    return _verifierXcode;
  }

  throw new UnauthorizedException(
    `Apple verification environment is not enabled: ${env}`,
  );
}

export interface VerifiedAppleNotification {
  payload: ResponseBodyV2DecodedPayload;
  transaction?: JWSTransactionDecodedPayload;
  renewal?: JWSRenewalInfoDecodedPayload;
  environment: 'Production' | 'Sandbox';
}

export async function verifyAppleNotificationPayload(
  signedPayload: string,
): Promise<VerifiedAppleNotification> {
  let lastError: unknown;
  for (const environment of [Environment.PRODUCTION, Environment.SANDBOX]) {
    const verifier = getAppleVerifier(environment);
    try {
      const payload = await verifier.verifyAndDecodeNotification(signedPayload);
      const transaction = payload.data?.signedTransactionInfo
        ? await verifier.verifyAndDecodeTransaction(
            payload.data.signedTransactionInfo,
          )
        : undefined;
      const renewal = payload.data?.signedRenewalInfo
        ? await verifier.verifyAndDecodeRenewalInfo(
            payload.data.signedRenewalInfo,
          )
        : undefined;
      return {
        payload,
        transaction,
        renewal,
        environment:
          environment === Environment.PRODUCTION ? 'Production' : 'Sandbox',
      };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof VerificationException) {
    throw new UnauthorizedException(
      `App Store notification verification failed (status=${lastError.status})`,
    );
  }
  throw new UnauthorizedException('App Store notification verification failed');
}

/**
 * Cryptographically verifies an Apple StoreKit 2 signed transaction JWS using
 * Apple's official App Store Server Library.
 *
 * The library performs: full x5c certificate chain validation against DER-pinned
 * Apple Root CAs; ES256 ECDSA P-256 signature verification with correct
 * IEEE-P1363 encoding; OCSP revocation checking (in production).
 *
 * Returns: `verifiedTransactionId` = the specific `transactionId` of this
 * renewal. Each renewal has a unique transactionId. `originalTransactionId`
 * chains all renewals together for ownership tracking.
 */
export async function verifyAppleStoreKit2Jws(
  rawJws: string,
  expectedProductId: string,
): Promise<VerifiedStorePurchase> {
  let tx;
  let verifiedEnvironment: Environment | null = null;
  let lastVerificationError: unknown;
  const verificationEnvironments = [
    Environment.PRODUCTION,
    Environment.SANDBOX,
    ...(IS_DEV_ENV ? [Environment.XCODE] : []),
  ];
  for (const environment of verificationEnvironments) {
    try {
      tx =
        await getAppleVerifier(environment).verifyAndDecodeTransaction(rawJws);
      verifiedEnvironment = environment;
      break;
    } catch (error) {
      lastVerificationError = error;
    }
  }
  if (!tx || !verifiedEnvironment) {
    if (lastVerificationError instanceof VerificationException) {
      throw new UnauthorizedException(
        `StoreKit 2 JWS verification failed (status=${lastVerificationError.status})`,
      );
    }
    throw new UnauthorizedException(
      'StoreKit 2 JWS verification failed: unexpected error',
    );
  }

  if (tx.bundleId && tx.bundleId !== 'io.mymemento.app') {
    throw new UnauthorizedException(
      `StoreKit bundle ID mismatch: ${tx.bundleId}`,
    );
  }

  if (!tx.productId || tx.productId !== expectedProductId) {
    throw new UnauthorizedException(
      `StoreKit product ID mismatch: expected ${expectedProductId}, got ${tx.productId}`,
    );
  }

  if (!tx.expiresDate || tx.expiresDate <= Date.now()) {
    throw new BadRequestException(
      'StoreKit transaction has already expired or has no expiration date',
    );
  }

  if (tx.revocationDate) {
    throw new BadRequestException(
      'StoreKit transaction has been revoked by Apple',
    );
  }

  // Use transactionId (not originalTransactionId) for deduplication so that
  // each renewal period gets its own ledger row and updates the subscription end date.
  const verifiedTransactionId = String(tx.transactionId);
  const originalTransactionId = tx.originalTransactionId
    ? String(tx.originalTransactionId)
    : verifiedTransactionId;

  return {
    verifiedTransactionId,
    originalTransactionId,
    productId: expectedProductId,
    purchaseDate: tx.purchaseDate ? new Date(tx.purchaseDate) : new Date(),
    expiresAt: new Date(tx.expiresDate),
    rawPayload: {
      bundleId: tx.bundleId,
      productId: tx.productId,
      transactionId: tx.transactionId,
      originalTransactionId: tx.originalTransactionId,
    },
    environment:
      verifiedEnvironment === Environment.PRODUCTION
        ? 'Production'
        : verifiedEnvironment === Environment.SANDBOX
          ? 'Sandbox'
          : 'Test',
    storeAccountToken: tx.appAccountToken,
    chainAliases: [originalTransactionId],
    providerModifiedAt: tx.signedDate
      ? new Date(tx.signedDate)
      : new Date(tx.expiresDate),
  };
}

/**
 * Validates legacy App Store receipts via Apple verifyReceipt endpoint.
 * Fallback for StoreKit 1 receipt strings from older clients.
 */
export async function verifyLegacyAppleReceipt(
  rawReceipt: string,
  expectedProductId: string,
): Promise<VerifiedStorePurchase> {
  const secret = process.env.APPLE_SHARED_SECRET;
  if (!secret) {
    throw new UnauthorizedException(
      'Apple receipt verification secret is not configured on the server',
    );
  }

  const productionUrl = 'https://buy.itunes.apple.com/verifyReceipt';
  const sandboxUrl = 'https://sandbox.itunes.apple.com/verifyReceipt';
  const requestReceipt = async (url: string) => {
    const {data} = await axios.post(url, {
      'receipt-data': rawReceipt,
      password: secret,
      'exclude-old-transactions': true,
    });
    return data as Record<string, unknown>;
  };

  let appleRes: Record<string, unknown>;
  let environment: 'Production' | 'Sandbox' = 'Production';
  try {
    appleRes = await requestReceipt(productionUrl);
    if (appleRes.status === 21007) {
      appleRes = await requestReceipt(sandboxUrl);
      environment = 'Sandbox';
    } else if (appleRes.status === 21008) {
      appleRes = await requestReceipt(productionUrl);
    }
  } catch (err: unknown) {
    if (err instanceof ServiceError) throw err;
    throw new UnauthorizedException('Apple verifyReceipt request failed');
  }

  if (appleRes.status !== 0) {
    throw new UnauthorizedException(
      `Apple receipt validation rejected with status ${appleRes.status}`,
    );
  }

  const latestReceiptInfo = appleRes.latest_receipt_info as
    | Record<string, unknown>[]
    | undefined;
  const receiptInApp = (
    appleRes.receipt as {in_app?: Record<string, unknown>[]} | undefined
  )?.in_app;
  const allItems: Record<string, unknown>[] = [
    ...(latestReceiptInfo || []),
    ...(receiptInApp || []),
  ];

  const matchingItems = allItems.filter(
    item =>
      item.product_id === expectedProductId &&
      !item.cancellation_date_ms &&
      Number(item.expires_date_ms) > Date.now(),
  );

  if (matchingItems.length === 0) {
    throw new BadRequestException(
      `No active, non-cancelled subscription found for product ${expectedProductId}`,
    );
  }

  matchingItems.sort(
    (a, b) => Number(b.expires_date_ms) - Number(a.expires_date_ms),
  );
  const bestMatch = matchingItems[0];

  const expiresMs = Number(bestMatch.expires_date_ms);
  // Use transaction_id (not original_transaction_id) for the ledger key
  // so each renewal creates a distinct row and extends the subscription end date.
  const verifiedTransactionId = String(
    bestMatch.transaction_id || bestMatch.original_transaction_id,
  );

  return {
    verifiedTransactionId,
    originalTransactionId: bestMatch.original_transaction_id
      ? String(bestMatch.original_transaction_id)
      : undefined,
    productId: expectedProductId,
    purchaseDate: bestMatch.purchase_date_ms
      ? new Date(Number(bestMatch.purchase_date_ms))
      : new Date(),
    expiresAt: new Date(expiresMs),
    rawPayload: {
      product_id: bestMatch.product_id,
      transaction_id: bestMatch.transaction_id,
      original_transaction_id: bestMatch.original_transaction_id,
    },
    environment,
    chainAliases: bestMatch.original_transaction_id
      ? [String(bestMatch.original_transaction_id)]
      : [verifiedTransactionId],
    providerModifiedAt: new Date(),
  };
}

/**
 * Verifies a Google Play subscription purchase token via the Play Developer API.
 *
 * Uses google-auth-library's JWT client to handle service account authentication
 * correctly — it posts form-encoded data to the OAuth token endpoint (as required
 * by RFC 6749), unlike a raw axios JSON POST which the Google endpoint rejects.
 */
export async function verifyGooglePlayPurchase(
  purchaseToken: string,
  expectedProductId?: string,
  allowInactive = false,
): Promise<VerifiedStorePurchase> {
  const saKeyJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY;
  if (!saKeyJson) {
    throw new ServiceUnavailableException(
      'Google Play purchase verification service is not configured on the server',
    );
  }

  let saKey: {
    client_email?: string;
    private_key?: string;
    token_uri?: string;
    type?: string;
  };

  try {
    saKey = JSON.parse(saKeyJson) as typeof saKey;
  } catch {
    throw new ServiceUnavailableException(
      'Malformed GOOGLE_PLAY_SERVICE_ACCOUNT_KEY JSON',
    );
  }

  if (!saKey.client_email || !saKey.private_key) {
    throw new ServiceUnavailableException(
      'GOOGLE_PLAY_SERVICE_ACCOUNT_KEY missing client_email or private_key',
    );
  }

  // google-auth-library JWT handles form-encoded OAuth token exchange correctly.
  const jwtClient = new JWT({
    email: saKey.client_email,
    key: saKey.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  let accessToken: string;
  try {
    const credentials = await jwtClient.authorize();
    if (!credentials.access_token) {
      throw new Error('No access_token returned');
    }
    accessToken = credentials.access_token;
  } catch (tokenErr: unknown) {
    if (tokenErr instanceof ServiceError) throw tokenErr;
    const msg = tokenErr instanceof Error ? tokenErr.message : 'Unknown error';
    throw new ServiceUnavailableException(
      `Google OAuth token exchange failed: ${msg}`,
    );
  }

  const packageName = 'io.mymemento.app';
  const verifyUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

  let gRes: Record<string, unknown>;
  try {
    const {data} = await axios.get(verifyUrl, {
      headers: {Authorization: `Bearer ${accessToken}`},
    });
    gRes = data as Record<string, unknown>;
  } catch (apiErr: unknown) {
    if (
      typeof apiErr === 'object' &&
      apiErr !== null &&
      'response' in apiErr &&
      (apiErr as {response?: {status?: number}}).response?.status === 404
    ) {
      throw new BadRequestException('Google Play subscription token not found');
    }
    throw new UnauthorizedException('Google Play purchase verification failed');
  }

  // Replacement tokens form a linked list, not a permanent root pointer. Walk
  // the full chain so every observed token is claimed by the same Memento user.
  const chainAliases = [purchaseToken];
  const seenTokens = new Set(chainAliases);
  let linkedToken =
    typeof gRes.linkedPurchaseToken === 'string'
      ? gRes.linkedPurchaseToken
      : undefined;
  for (let depth = 0; linkedToken && depth < 20; depth += 1) {
    if (seenTokens.has(linkedToken)) {
      throw new BadRequestException(
        'Google Play replacement chain contains a cycle',
      );
    }
    seenTokens.add(linkedToken);
    chainAliases.push(linkedToken);
    const linkedUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${encodeURIComponent(linkedToken)}`;
    try {
      const {data} = await axios.get(linkedUrl, {
        headers: {Authorization: `Bearer ${accessToken}`},
      });
      const linked = data as Record<string, unknown>;
      linkedToken =
        typeof linked.linkedPurchaseToken === 'string'
          ? linked.linkedPurchaseToken
          : undefined;
    } catch {
      throw new UnauthorizedException(
        'Google Play replacement chain verification failed',
      );
    }
  }
  if (linkedToken) {
    throw new BadRequestException('Google Play replacement chain is too deep');
  }

  const validStates = [
    'SUBSCRIPTION_STATE_ACTIVE',
    'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  ];
  if (!allowInactive && !validStates.includes(String(gRes.subscriptionState))) {
    throw new BadRequestException(
      `Google Play subscription is not active (state: ${gRes.subscriptionState})`,
    );
  }

  const lineItems = gRes.lineItems as
    | {productId?: string; expiryTime?: string; startTime?: string}[]
    | undefined;
  const lineItem = lineItems?.[0];
  if (
    !lineItem ||
    (expectedProductId && lineItem.productId !== expectedProductId)
  ) {
    throw new UnauthorizedException(
      `Google Play product ID mismatch: expected ${expectedProductId}, got ${lineItem?.productId}`,
    );
  }

  const expiresMs = lineItem.expiryTime
    ? new Date(lineItem.expiryTime).getTime()
    : 0;
  if (!expiresMs || (!allowInactive && expiresMs <= Date.now())) {
    throw new BadRequestException('Google Play subscription has expired');
  }

  return {
    // The purchaseToken is the unique per-renewal identifier on Google Play.
    verifiedTransactionId: purchaseToken,
    originalTransactionId:
      typeof gRes.linkedPurchaseToken === 'string'
        ? gRes.linkedPurchaseToken
        : purchaseToken,
    productId: String(lineItem.productId),
    purchaseDate: lineItem.startTime
      ? new Date(lineItem.startTime)
      : new Date(),
    expiresAt: new Date(expiresMs),
    rawPayload: {
      subscriptionState: gRes.subscriptionState,
      latestOrderId: gRes.latestOrderId,
      regionCode: gRes.regionCode,
    },
    environment: gRes.testPurchase ? 'Test' : 'Production',
    storeAccountToken:
      typeof (
        gRes.externalAccountIdentifiers as Record<string, unknown> | undefined
      )?.obfuscatedExternalAccountId === 'string'
        ? String(
            (gRes.externalAccountIdentifiers as Record<string, unknown>)
              .obfuscatedExternalAccountId,
          )
        : undefined,
    chainAliases,
    autoRenewEnabled:
      typeof (lineItem as Record<string, unknown>).autoRenewingPlan === 'object'
        ? Boolean(
            (
              (lineItem as Record<string, unknown>).autoRenewingPlan as Record<
                string,
                unknown
              >
            ).autoRenewEnabled,
          )
        : undefined,
    providerModifiedAt: new Date(),
  };
}
