import {createHmac} from 'crypto';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const axiosMock = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
  isAxiosError: vi.fn(() => false),
  patch: vi.fn(),
  post: vi.fn(),
}));

vi.mock('axios', () => ({default: axiosMock}));
vi.mock('../../src/utils/config', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/utils/config')>()),
  POLAR_ACCESS_TOKEN: 'polar_test_token',
  POLAR_BASE_URL: 'https://api.polar.test/v1',
  POLAR_WEBHOOK_SECRET: 'whsec_dGVzdC1zZWNyZXQ=',
  POLAR_PRODUCT_PRO_MONTHLY: 'product-pro-monthly',
  POLAR_PRODUCT_PRO_ANNUAL: 'product-pro-annual',
  POLAR_PRODUCT_LEGACY_MONTHLY: 'product-legacy-monthly',
  POLAR_PRODUCT_LEGACY_ANNUAL: 'product-legacy-annual',
  POLAR_PRODUCT_LEGACY_LIFETIME: 'product-legacy-lifetime',
}));

import {
  cancelPolarSubscription,
  createPolarCheckoutSession,
  listPolarInvoices,
  resumePolarSubscription,
  resolvePolarProductPlan,
  verifyPolarWebhookSignature,
} from '../../src/module/api/billing/providers/polar';

describe('Polar billing provider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('schedules and revokes a period-end cancellation through Polar', async () => {
    axiosMock.patch
      .mockResolvedValueOnce({
        data: {
          id: 'subscription-id',
          status: 'active',
          cancel_at_period_end: true,
          canceled_at: '2026-08-30T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: 'subscription-id',
          status: 'active',
          cancel_at_period_end: false,
          canceled_at: null,
        },
      });

    await cancelPolarSubscription('subscription-id');
    await resumePolarSubscription('subscription-id');

    expect(axiosMock.patch).toHaveBeenNthCalledWith(
      1,
      'https://api.polar.test/v1/subscriptions/subscription-id',
      {cancel_at_period_end: true},
      expect.objectContaining({headers: expect.any(Object)}),
    );
    expect(axiosMock.patch).toHaveBeenNthCalledWith(
      2,
      'https://api.polar.test/v1/subscriptions/subscription-id',
      {cancel_at_period_end: false},
      expect.objectContaining({headers: expect.any(Object)}),
    );
  });

  it('returns customer-scoped paid order receipts as invoice links', async () => {
    axiosMock.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/orders/')) {
        return {
          data: {
            items: [
              {
                id: 'order-id',
                status: 'paid',
                invoice_number: 'INV-1042',
                created_at: '2026-08-01T12:00:00.000Z',
                total_amount: 1200,
                currency: 'usd',
              },
              {
                id: 'pending-order',
                status: 'pending',
                created_at: '2026-08-02T12:00:00.000Z',
                total_amount: 1200,
                currency: 'usd',
              },
            ],
          },
        };
      }
      return {data: {url: 'https://downloads.polar.test/receipt.pdf'}};
    });

    const invoices = await listPolarInvoices('memento-user-id');

    expect(axiosMock.get).toHaveBeenNthCalledWith(
      1,
      'https://api.polar.test/v1/orders/',
      expect.objectContaining({
        params: expect.objectContaining({
          external_customer_id: 'memento-user-id',
        }),
      }),
    );
    expect(axiosMock.get.mock.calls[0][1].params.status).toBeUndefined();
    expect(invoices).toEqual([
      {
        id: 'order-id',
        label: 'INV-1042',
        url: 'https://downloads.polar.test/receipt.pdf',
        created_at: '2026-08-01T12:00:00.000Z',
        amount: 1200,
        currency: 'USD',
        status: 'paid',
      },
    ]);
  });

  it('verifies Standard Webhooks signatures and rejects stale deliveries', () => {
    const body = Buffer.from('{"type":"subscription.active"}');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const webhookId = 'evt_123';
    const signature = createHmac('sha256', Buffer.from('test-secret'))
      .update(`${webhookId}.${timestamp}.${body.toString('utf8')}`)
      .digest('base64');

    expect(() =>
      verifyPolarWebhookSignature(body, {
        'webhook-id': webhookId,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${signature}`,
      }),
    ).not.toThrow();
    expect(() =>
      verifyPolarWebhookSignature(body, {
        'webhook-id': webhookId,
        'webhook-timestamp': String(Number(timestamp) - 600),
        'webhook-signature': `v1,${signature}`,
      }),
    ).toThrow(/timestamp/i);
  });

  it('maps only configured Polar product ids to entitlement plans', () => {
    expect(resolvePolarProductPlan('product-pro-monthly', {})).toEqual({
      tier: 'pro',
      interval: 'monthly',
    });
    expect(() =>
      resolvePolarProductPlan('unknown-product', {
        tier: 'pro',
        interval: 'monthly',
      }),
    ).toThrow(/unknown polar product/i);
  });
});

describe('checkout trials', () => {
  const checkout = {
    userId: 'user-1',
    email: 'member@example.com',
    tier: 'pro',
    interval: 'monthly',
    successUrl: 'https://web.test/success',
  } as const;
  const sentPayload = () => axiosMock.post.mock.calls.at(-1)?.[1];

  beforeEach(() => {
    axiosMock.post.mockReset();
    axiosMock.post.mockResolvedValue({data: {url: 'https://polar.test/c'}});
  });

  it('leaves the trial to the product for a first-time subscriber', async () => {
    await createPolarCheckoutSession({...checkout, allowTrial: true});
    expect(sentPayload()).not.toHaveProperty('allow_trial');
  });

  it('turns the trial off for a returning subscriber', async () => {
    await createPolarCheckoutSession({...checkout, allowTrial: false});
    expect(sentPayload()).toMatchObject({allow_trial: false});
  });
});
