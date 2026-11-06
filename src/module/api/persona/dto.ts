import {z} from 'zod';

const mongoIdSchema = z
  .string()
  .min(1, 'ID is required')
  .regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

/** GET /persona/pending-insights — no route params */
export const listPendingInsightsSchema = z.object({});

export const pendingInsightActionSchema = z.object({
  params: z.strictObject({
    pendingId: mongoIdSchema,
  }),
});

const observationIdSchema = mongoIdSchema;

export const observationParamsSchema = z.object({
  params: z.strictObject({observationId: observationIdSchema}),
});

export const updateObservationSchema = z.object({
  params: z.strictObject({observationId: observationIdSchema}),
  body: z.strictObject({
    heading: z.string().trim().min(1).max(120),
    note: z.string().trim().min(1).max(378),
  }),
});
