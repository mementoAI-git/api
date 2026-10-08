import {vi} from 'vitest';
vi.mock('../../src/utils/config', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/utils/config')>()),
  POLAR_ACCESS_TOKEN: 'test-only-token',
  POLAR_BASE_URL: 'https://polar.test/v1',
}));
import assert from 'node:assert/strict';
import {test, mock} from '../helpers/legacy-test';
import axios from 'axios';

// Isolated provider fixture; never contacts Polar or reads application credentials.
process.env.POLAR_ACCESS_TOKEN = 'test-only-token';
process.env.POLAR_BASE_URL = 'https://polar.test/v1';
import {
  createPolarPortalSession,
  getPolarCustomer,
  listPolarInvoices,
  listPolarPaymentMethods,
} from '../../src/module/api/billing/providers/polar';

void test('uses the documented customer_portal_url response', async () => {
  const post = mock.method(axios, 'post', async () => ({
    data: {customer_portal_url: 'https://polar.test/portal'},
  }));
  try {
    assert.deepEqual(
      await createPolarPortalSession({
        externalCustomerId: 'user_1',
        returnUrl: 'http://localhost:5173/settings/billing',
      }),
      {portalUrl: 'https://polar.test/portal'},
    );
    const call = post.mock.calls[0].arguments;
    assert.deepEqual(call[1], {
      external_customer_id: 'user_1',
      return_url: 'http://localhost:5173/settings/billing',
    });
  } finally {
    post.mock.restore();
  }
});
void test('returns only masked metadata, excluding processor secrets', async () => {
  const get = mock.method(axios, 'get', async () => ({
    data: {
      items: [
        {
          id: 'pm_1',
          type: 'card',
          is_default: true,
          processor: 'stripe',
          method_metadata: {
            brand: 'mastercard',
            last4: '1312',
            exp_month: 5,
            exp_year: 2030,
          },
          secret: 'private',
        },
      ],
    },
  }));
  try {
    assert.deepEqual(await listPolarPaymentMethods('user/1'), [
      {id: 'pm_1', brand: 'mastercard', last4: '1312', is_default: true},
    ]);
    assert.match(
      String(get.mock.calls[0].arguments[0]),
      /user%2F1\/payment-methods$/,
    );
  } finally {
    get.mock.restore();
  }
});
void test('scopes order queries to the authenticated external customer and fetches generated invoices', async () => {
  const get = mock.method(axios, 'get', async (url: string) =>
    url.endsWith('/invoice')
      ? {data: {url: 'https://polar.test/invoice'}}
      : {
          data: {
            items: [
              {
                id: 'order_1',
                invoice_number: 'INV-1',
                created_at: '2026-10-01',
                total_amount: 1500,
                currency: 'usd',
                status: 'paid',
                is_invoice_generated: true,
              },
              {
                id: 'order_2',
                created_at: '2026-10-02',
                total_amount: 1000,
                currency: 'usd',
                status: 'pending',
                is_invoice_generated: false,
              },
            ],
          },
        },
  );
  try {
    const invoices = await listPolarInvoices('user_1');
    assert.equal(invoices[0].url, 'https://polar.test/invoice');
    assert.equal(invoices[0].amount, 1500);
    assert.equal(invoices.length, 1);
    assert.equal(get.mock.callCount(), 2);
    assert.equal(
      get.mock.calls[0].arguments[1].params.external_customer_id,
      'user_1',
    );
  } finally {
    get.mock.restore();
  }
});
void test('missing customer is empty, provider failures remain errors', async () => {
  const get = mock.method(axios, 'get', async () => {
    throw {isAxiosError: true, response: {status: 404}};
  });
  try {
    assert.equal(await getPolarCustomer('user_1'), null);
    get.mock.mockImplementation(async () => {
      throw new Error('Provider unavailable');
    });
    await assert.rejects(getPolarCustomer('user_1'), /Provider unavailable/);
  } finally {
    get.mock.restore();
  }
});

void test('authenticates Polar delivery headers and rejects tampering and replays', async () => {
  const {verifyPolarWebhookSignature} = await import(
    '../../src/module/api/billing/providers/polar'
  );
  const {createHmac} = await import('node:crypto');
  const secret = 'polar_whs_test_only';
  const body = Buffer.from('{"type":"subscription.active"}');
  const id = 'delivery_1';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    'v1,' +
    createHmac('sha256', secret)
      .update(`${id}.${timestamp}.${body}`)
      .digest('base64');
  assert.doesNotThrow(() =>
    verifyPolarWebhookSignature(body, {id, timestamp, signature}, secret),
  );
  assert.throws(
    () =>
      verifyPolarWebhookSignature(
        Buffer.from('{}'),
        {id, timestamp, signature},
        secret,
      ),
    /Invalid Polar/,
  );
  assert.throws(
    () =>
      verifyPolarWebhookSignature(
        body,
        {id: 'other', timestamp, signature},
        secret,
      ),
    /Invalid Polar/,
  );
  assert.throws(
    () =>
      verifyPolarWebhookSignature(
        body,
        {id, timestamp: '1', signature},
        secret,
      ),
    /tolerance/,
  );
  assert.throws(() => verifyPolarWebhookSignature(body, {}, secret), /headers/);
});

void test('cancellation and resume use the provider subscription endpoint and explicit period-end flag', async () => {
  const {updatePolarCancellation} = await import(
    '../../src/module/api/billing/providers/polar'
  );
  const patch = mock.method(
    axios,
    'patch',
    async (_url: string, body: {cancel_at_period_end: boolean}) => ({
      data: {cancel_at_period_end: body.cancel_at_period_end},
    }),
  );
  try {
    await updatePolarCancellation('sub/1', true, {
      reason: 'unused',
      comment: 'Taking a break',
    });
    assert.equal(
      patch.mock.calls[0].arguments[0],
      'https://polar.test/v1/subscriptions/sub%2F1',
    );
    assert.deepEqual(patch.mock.calls[0].arguments[1], {
      cancel_at_period_end: true,
      customer_cancellation_reason: 'unused',
      customer_cancellation_comment: 'Taking a break',
    });
    await updatePolarCancellation('sub/1', false);
    assert.deepEqual(patch.mock.calls[1].arguments[1], {
      cancel_at_period_end: false,
    });
  } finally {
    patch.mock.restore();
  }
});

void test('keeps legacy free-text feedback out of Polar enum fields', async () => {
  const {updatePolarCancellation} = await import(
    '../../src/module/api/billing/providers/polar'
  );
  const patch = mock.method(axios, 'patch', async () => ({
    data: {cancel_at_period_end: true},
  }));
  try {
    await updatePolarCancellation('sub_1', true, {
      reason: 'Taking a break from the app',
      comment: 'I will return later',
    });
    assert.deepEqual(patch.mock.calls[0].arguments[1], {
      cancel_at_period_end: true,
    });
  } finally {
    patch.mock.restore();
  }
});
