import {z} from 'zod';
import {PERSONA_INSIGHT_FIELDS} from '../../../utils/constant';

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

const observationIdSchema = z
  .string()
  .regex(
    new RegExp(`^(${PERSONA_INSIGHT_FIELDS.join('|')})-[a-f0-9]{24}$`),
    'Invalid observation ID',
  );

export const observationParamsSchema = z.object({
  params: z.strictObject({observationId: observationIdSchema}),
});

export const updateObservationSchema = z.object({
  params: z.strictObject({observationId: observationIdSchema}),
  body: z.strictObject({content: z.string().trim().min(1).max(500)}),
});
