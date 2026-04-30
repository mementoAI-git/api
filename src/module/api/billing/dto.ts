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
