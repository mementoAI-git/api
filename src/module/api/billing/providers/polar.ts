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

export function resolvePolarProductPlan(
  productId: string | undefined,
  metadata: Record<string, unknown>,
): {tier: 'pro' | 'legacy' | null; interval: Interval | null} {
  const configured = (
    Object.entries(POLAR_PRODUCTS) as Array<
      [Exclude<Tier, 'free'>, Record<Interval, string | undefined>]
    >
  ).flatMap(([tier, intervals]) =>
    (Object.entries(intervals) as Array<[Interval, string | undefined]>)
      .filter((entry): entry is [Interval, string] => Boolean(entry[1]))
      .map(([interval, id]) => ({tier, interval, id})),
  );
  const match = configured.find(product => product.id === productId);
  if (match) return {tier: match.tier, interval: match.interval};
  if (configured.length > 0) {
    throw new BadRequestException('Unknown Polar product mapping');
  }
  const tier =
    metadata.tier === 'pro' || metadata.tier === 'legacy'
      ? metadata.tier
      : null;
  const interval =
    metadata.interval === 'monthly' ||
    metadata.interval === 'annual' ||
    metadata.interval === 'lifetime'
      ? metadata.interval
      : null;
  return {tier, interval};
}

function requirePolarAccessToken() {
  if (!POLAR_ACCESS_TOKEN) {
    throw new BadRequestException(
      'Polar access token is not configured (POLAR_ACCESS_TOKEN)',
    );
  }
}

function polarRequestConfig() {
  return {
    headers: {
      Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  };
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

export async function cancelPolarSubscription(subscriptionId: string) {
  requirePolarAccessToken();
  const {data} = await axios.patch(
    `${POLAR_BASE_URL}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {cancel_at_period_end: true},
    polarRequestConfig(),
  );
  return data as Record<string, unknown>;
}

export async function resumePolarSubscription(subscriptionId: string) {
  requirePolarAccessToken();
  const {data} = await axios.patch(
    `${POLAR_BASE_URL}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {cancel_at_period_end: false},
    polarRequestConfig(),
  );
  return data as Record<string, unknown>;
}

type PolarOrder = {
  id: string;
  status: string;
  invoice_number?: string | null;
  receipt_number?: string | null;
  created_at: string;
  total_amount: number;
  currency: string;
};

export async function listPolarInvoices(externalCustomerId: string) {
  requirePolarAccessToken();
  const {data} = await axios.get(`${POLAR_BASE_URL}/orders/`, {
    ...polarRequestConfig(),
    params: {
      external_customer_id: externalCustomerId,
      page: 1,
      limit: 100,
      sorting: '-created_at',
    },
  });
  const orders = Array.isArray(data?.items)
    ? (data.items as PolarOrder[]).filter(order => order.status === 'paid')
    : [];
  return Promise.all(
    orders.map(async order => {
      let url: string | undefined;
      try {
        const receipt = await axios.get(
          `${POLAR_BASE_URL}/orders/${encodeURIComponent(order.id)}/receipt`,
          polarRequestConfig(),
        );
        if (typeof receipt.data?.url === 'string') url = receipt.data.url;
      } catch (error) {
        if (
          !axios.isAxiosError(error) ||
          ![202, 404].includes(error.response?.status || 0)
        ) {
          throw error;
        }
      }
      return {
        id: order.id,
        label:
          order.invoice_number || order.receipt_number || `Order ${order.id}`,
        ...(url && {url}),
        created_at: order.created_at,
        amount: order.total_amount,
        currency: String(order.currency || '').toUpperCase(),
        status: order.status,
      };
    }),
  );
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
  signatureOrHeaders:
    | string
    | undefined
    | Record<string, string | string[] | undefined>,
) {
  if (!POLAR_WEBHOOK_SECRET) {
    throw new UnauthorizedException(
      'Polar webhook secret missing (POLAR_WEBHOOK_SECRET)',
    );
  }
  if (!signatureOrHeaders) {
    throw new UnauthorizedException('Missing Polar webhook signature');
  }

  const bodyString = rawBody.toString('utf8');
  if (typeof signatureOrHeaders !== 'string') {
    const header = (name: string) => {
      const value = signatureOrHeaders[name];
      return Array.isArray(value) ? value[0] : value;
    };
    const webhookId = header('webhook-id');
    const timestamp = header('webhook-timestamp');
    const signatureHeader = header('webhook-signature');
    if (!webhookId || !timestamp || !signatureHeader) {
      throw new UnauthorizedException('Missing Standard Webhooks headers');
    }
    const timestampSeconds = Number(timestamp);
    if (
      !Number.isFinite(timestampSeconds) ||
      Math.abs(Date.now() / 1000 - timestampSeconds) > 5 * 60
    ) {
      throw new UnauthorizedException('Polar webhook timestamp is stale');
    }
    const encodedSecret = POLAR_WEBHOOK_SECRET.startsWith('whsec_')
      ? POLAR_WEBHOOK_SECRET.slice('whsec_'.length)
      : POLAR_WEBHOOK_SECRET;
    const secret = POLAR_WEBHOOK_SECRET.startsWith('whsec_')
      ? Buffer.from(encodedSecret, 'base64')
      : Buffer.from(encodedSecret);
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${webhookId}.${timestamp}.${bodyString}`)
      .digest('base64');
    const signatures = signatureHeader
      .split(' ')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => (part.startsWith('v1,') ? part.slice(3) : part));
    if (signatures.some(signature => safeCompare(expected, signature))) return;
    throw new UnauthorizedException('Invalid Polar webhook signature');
  }

  const signatureHeader = signatureOrHeaders;
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
