import axios from 'axios';
import crypto from 'crypto';
import {
  POLAR_ACCESS_TOKEN,
  POLAR_BASE_URL,
  POLAR_PRODUCT_LEGACY_ANNUAL,
  POLAR_PRODUCT_LEGACY_LIFETIME,
  POLAR_PRODUCT_LEGACY_MONTHLY,
  POLAR_PRODUCT_PRO_ANNUAL,
  POLAR_PRODUCT_PRO_MONTHLY,
  POLAR_WEBHOOK_SECRET,
} from '../../../../utils/config';
import {
  BadRequestException,
  UnauthorizedException,
} from '../../../../utils/service-error';

type Tier = 'free' | 'pro' | 'legacy';
type Interval = 'monthly' | 'annual' | 'lifetime';

interface PolarCheckoutInput {
  userId: string;
  email: string;
  tier: Tier;
  interval: Interval;
  successUrl: string;
}

const POLAR_PRODUCTS: Record<
  Exclude<Tier, 'free'>,
  Record<Interval, string | undefined>
> = {
  pro: {
    monthly: POLAR_PRODUCT_PRO_MONTHLY,
    annual: POLAR_PRODUCT_PRO_ANNUAL,
    lifetime: undefined,
  },
  legacy: {
    monthly: POLAR_PRODUCT_LEGACY_MONTHLY,
    annual: POLAR_PRODUCT_LEGACY_ANNUAL,
    lifetime: POLAR_PRODUCT_LEGACY_LIFETIME,
  },
};

function requirePolarAccessToken() {
  if (!POLAR_ACCESS_TOKEN) {
    throw new BadRequestException(
      'Polar access token is not configured (POLAR_ACCESS_TOKEN)',
    );
  }
}

function buildCheckoutPayload(input: PolarCheckoutInput) {
  if (input.tier === 'free') {
    throw new BadRequestException('Free plan does not require checkout');
  }
  const productId = POLAR_PRODUCTS[input.tier][input.interval];
  if (!productId) {
    throw new BadRequestException(
      `Polar product is not configured for ${input.tier}/${input.interval}`,
    );
  }

  return {
    products: [productId],
    success_url: input.successUrl,
    external_customer_id: input.userId,
    customer_email: input.email,
    metadata: {
      user_id: input.userId,
      tier: input.tier,
      interval: input.interval,
    },
  };
}

function parseSignatureHeader(signatureHeader: string) {
  // Supports either:
  // - "v1=<hash>"
  // - "t=<timestamp>,v1=<hash>" (Stripe-style envelope)
  const parts = signatureHeader.split(',').map(p => p.trim());
  const map = new Map<string, string>();
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k && v) map.set(k, v);
  }
  return {
    timestamp: map.get('t'),
    v1:
      map.get('v1') ||
      (signatureHeader.startsWith('v1=')
        ? signatureHeader.slice(3)
        : signatureHeader),
  };
}

function safeCompare(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export async function createPolarCheckoutSession(input: PolarCheckoutInput) {
  requirePolarAccessToken();
  const payload = buildCheckoutPayload(input);

  const {data} = await axios.post(`${POLAR_BASE_URL}/checkouts`, payload, {
    headers: {
      Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

  const checkoutUrl = data?.url || data?.checkout_url;
  if (!checkoutUrl || typeof checkoutUrl !== 'string') {
    throw new BadRequestException('Polar checkout response missing url');
  }
  return {checkoutUrl};
}

export async function createPolarPortalSession({
  externalCustomerId,
  returnUrl,
}: {
  externalCustomerId: string;
  returnUrl: string;
}) {
  requirePolarAccessToken();

  const {data} = await axios.post(
    `${POLAR_BASE_URL}/customer-sessions`,
    {
      external_customer_id: externalCustomerId,
      return_url: returnUrl,
    },
    {
      headers: {
        Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  );

  const portalUrl = data?.url || data?.portal_url;
  if (!portalUrl || typeof portalUrl !== 'string') {
    throw new BadRequestException('Polar portal response missing url');
  }
  return {portalUrl};
}

/** Delete and GDPR-anonymize a Polar customer using Memento's user id. */
export async function deletePolarCustomerByExternalId(
  externalCustomerId: string,
): Promise<void> {
  // Accounts without a Polar customer (including free accounts) need no call.
  if (!POLAR_ACCESS_TOKEN) return;

  try {
    await axios.delete(
      `${POLAR_BASE_URL}/customers/external/${encodeURIComponent(externalCustomerId)}`,
      {
        params: {anonymize: true},
        headers: {Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`},
        timeout: 15000,
      },
    );
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return;
    throw error;
  }
}

export function verifyPolarWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
) {
  if (!POLAR_WEBHOOK_SECRET) {
    throw new UnauthorizedException(
      'Polar webhook secret missing (POLAR_WEBHOOK_SECRET)',
    );
  }
  if (!signatureHeader) {
    throw new UnauthorizedException('Missing Polar-Signature header');
  }

  const bodyString = rawBody.toString('utf8');
  const {timestamp, v1} = parseSignatureHeader(signatureHeader);

  const direct = crypto
    .createHmac('sha256', POLAR_WEBHOOK_SECRET)
    .update(bodyString)
    .digest('hex');
  if (safeCompare(direct, v1)) return;

  if (timestamp) {
    const timestamped = crypto
      .createHmac('sha256', POLAR_WEBHOOK_SECRET)
      .update(`${timestamp}.${bodyString}`)
      .digest('hex');
    if (safeCompare(timestamped, v1)) return;
  }

  throw new UnauthorizedException('Invalid Polar webhook signature');
}
