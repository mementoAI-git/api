import {z} from 'zod';

export const checkoutSchema = z.object({
  body: z.strictObject({
    success_url: z.string().url(),
    cancel_url: z.string().url(),
    tier: z.enum(['free', 'pro', 'legacy']).optional(),
    interval: z.enum(['monthly', 'annual', 'lifetime']).optional(),
  }),
});

export const portalSchema = z.object({
  body: z.strictObject({
    return_url: z.string().url(),
  }),
});

export const promoRedeemSchema = z.object({
  body: z.strictObject({
    code: z.string().min(1, 'Code is required').trim(),
  }),
});

export const iapVerifySchema = z.object({
  body: z
    .object({
      platform: z.enum(['ios', 'android']),
      productId: z.string().min(1, 'Product ID is required').trim(),
      transactionId: z.string().min(1, 'Transaction ID is required').trim(),
      receiptData: z.string().trim().optional(),
      purchaseToken: z.string().trim().optional(),
    })
    .refine(
      data =>
        data.platform === 'ios'
          ? Boolean(data.receiptData || data.purchaseToken)
          : Boolean(data.purchaseToken),
      {
        message:
          'Store receiptData or purchaseToken is required for verification',
        path: ['purchaseToken'],
      },
    ),
});

export type IapVerifyBody = z.infer<typeof iapVerifySchema>['body'];

export const cancelSubscriptionSchema = z.object({
  body: z
    .object({
      reason: z.string().trim().max(500).optional(),
      details: z.string().trim().max(2000).optional(),
    })
    .optional(),
});
