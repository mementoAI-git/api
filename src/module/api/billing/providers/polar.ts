import axios from 'axios';
import crypto from 'crypto';
import {CANCELLATION_REASONS} from '../dto';
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
  /** False turns off a trial configured on the Polar product for this checkout. */
  allowTrial?: boolean;
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
    ...(input.allowTrial === false ? {allow_trial: false} : {}),
    metadata: {
      user_id: input.userId,
      tier: input.tier,
      interval: input.interval,
    },
  };
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

  const portalUrl = data?.customer_portal_url || data?.url || data?.portal_url;
  if (!portalUrl || typeof portalUrl !== 'string') {
    throw new BadRequestException('Polar portal response missing url');
  }
  return {portalUrl};
}

export interface PolarWebhookHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}
export function verifyPolarWebhookSignature(
  rawBody: Buffer,
  headers: PolarWebhookHeaders | Record<string, string | string[] | undefined>,
  secret = POLAR_WEBHOOK_SECRET,
) {
  if (!secret)
    throw new UnauthorizedException(
      'Polar webhook secret missing (POLAR_WEBHOOK_SECRET)',
    );
  const value = (key: string) => {
    const v = headers[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const id = value('id') || value('webhook-id');
  const timestamp = value('timestamp') || value('webhook-timestamp');
  const signature = value('signature') || value('webhook-signature');
  if (
    !id ||
    !timestamp ||
    !signature ||
    !/^\d+$/.test(timestamp) ||
    id.includes('.')
  ) {
    throw new UnauthorizedException('Missing or invalid Polar webhook headers');
  }
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    throw new UnauthorizedException(
      'Polar webhook timestamp outside tolerance',
    );
  }
  // Polar SDK uses the full literal secret as the HMAC key. Also accept the
  // Standard Webhooks key form for whsec_ secrets, supporting the transition.
  const keys = [Buffer.from(secret, 'utf8')];
  if (secret.startsWith('whsec_'))
    keys.push(Buffer.from(secret.slice(6), 'base64'));
  const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), rawBody]);
  for (const key of keys) {
    const expected = crypto.createHmac('sha256', key).update(signed).digest();
    for (const value of signature.split(' ')) {
      const [version, encoded] = value.split(',');
      if (version !== 'v1' || !encoded) continue;
      const actual = Buffer.from(encoded, 'base64');
      if (
        actual.length === expected.length &&
        crypto.timingSafeEqual(actual, expected)
      )
        return;
    }
  }
  throw new UnauthorizedException('Invalid Polar webhook signature');
}

interface PolarCustomer {
  id: string;
  email: string;
  name?: string | null;
  billing_name?: string | null;
  billing_address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  } | null;
}
interface PolarPaymentMethod {
  id: string;
  type: string;
  is_default: boolean;
  method_metadata?: {brand?: string; last4?: string};
}
interface PolarOrder {
  id: string;
  invoice_number?: string;
  created_at: string;
  total_amount: number;
  currency: string;
  status: string;
  is_invoice_generated: boolean;
}
function polarOptions() {
  requirePolarAccessToken();
  return {
    headers: {Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`},
    timeout: 15000,
  };
}
export async function getPolarCustomer(externalId: string) {
  try {
    const {data} = await axios.get<PolarCustomer>(
      `${POLAR_BASE_URL}/customers/external/${encodeURIComponent(externalId)}`,
      polarOptions(),
    );
    return data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404)
      return null;
    throw error;
  }
}
export async function listPolarPaymentMethods(externalId: string) {
  const {data} = await axios.get<{items: PolarPaymentMethod[]}>(
    `${POLAR_BASE_URL}/customers/external/${encodeURIComponent(externalId)}/payment-methods`,
    {...polarOptions(), params: {limit: 100}},
  );
  return data.items.map(method => ({
    id: method.id,
    brand: method.method_metadata?.brand || method.type.replace(/_/g, ' '),
    last4: method.method_metadata?.last4 || null,
    is_default: method.is_default,
  }));
}
export async function listPolarInvoices(externalId: string) {
  const {data} = await axios.get<{items: PolarOrder[]}>(
    `${POLAR_BASE_URL}/orders/`,
    {
      ...polarOptions(),
      params: {
        external_customer_id: externalId,
        limit: 20,
        sorting: '-created_at',
      },
    },
  );
  return Promise.all(
    data.items
      .filter(order => order.status === 'paid')
      .map(async order => {
        const invoice = order.is_invoice_generated
          ? await axios.get<{url: string}>(
              `${POLAR_BASE_URL}/orders/${encodeURIComponent(order.id)}/invoice`,
              polarOptions(),
            )
          : null;
        const receipt = !invoice
          ? await axios
              .get<{
                url: string;
              }>(
                `${POLAR_BASE_URL}/orders/${encodeURIComponent(order.id)}/receipt`,
                polarOptions(),
              )
              .catch(error => {
                if (
                  axios.isAxiosError(error) &&
                  [202, 404].includes(error.response?.status || 0)
                )
                  return null;
                throw error;
              })
          : null;
        return {
          id: order.id,
          label: order.invoice_number || 'Invoice',
          created_at: order.created_at,
          amount: order.total_amount,
          currency: order.currency.toUpperCase(),
          status: order.status,
          url: invoice?.data.url || receipt?.data.url,
        };
      }),
  );
}

export async function updatePolarCancellation(
  subscriptionId: string,
  cancel: boolean,
  feedback: {reason?: string; comment?: string} = {},
) {
  // Older clients submit free-text reasons; retain those locally while sending
  // only the cancellation flag to Polar, as the existing mobile API did.
  const supportedFeedback =
    !feedback.reason ||
    (CANCELLATION_REASONS as readonly string[]).includes(feedback.reason);
  const {data} = await axios.patch<{
    cancel_at_period_end: boolean;
    status?: string;
    current_period_end?: string;
  }>(
    `${POLAR_BASE_URL}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      cancel_at_period_end: cancel,
      ...(cancel && supportedFeedback && feedback.reason
        ? {customer_cancellation_reason: feedback.reason}
        : {}),
      ...(cancel && supportedFeedback && feedback.comment
        ? {customer_cancellation_comment: feedback.comment.slice(0, 1000)}
        : {}),
    },
    polarOptions(),
  );
  if (data.cancel_at_period_end !== cancel)
    throw new BadRequestException(
      'Billing provider did not confirm the subscription change',
    );
  return data;
}

export async function getPolarSubscriptionInterval(subscriptionId: string) {
  const {data} = await axios.get<{recurring_interval: string}>(
    `${POLAR_BASE_URL}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    polarOptions(),
  );
  if (data.recurring_interval === 'month') return 'monthly' as const;
  if (data.recurring_interval === 'year') return 'annual' as const;
  throw new BadRequestException('Unsupported subscription billing interval');
}

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

export async function cancelPolarSubscription(subscriptionId: string) {
  requirePolarAccessToken();
  const {data} = await axios.patch(
    `${POLAR_BASE_URL}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {cancel_at_period_end: true},
    polarOptions(),
  );
  return data as Record<string, unknown>;
}

export async function resumePolarSubscription(subscriptionId: string) {
  requirePolarAccessToken();
  const {data} = await axios.patch(
    `${POLAR_BASE_URL}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {cancel_at_period_end: false},
    polarOptions(),
  );
  return data as Record<string, unknown>;
}
