import { z } from "zod";

const mongoIdSchema = z
  .string()
  .min(1, "ID is required")
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid ID format");

/** GET /persona/pending-insights — no route params */
export const listPendingInsightsSchema = z.object({});

export const pendingInsightActionSchema = z.object({
  params: z.strictObject({
    pendingId: mongoIdSchema,
  }),
});
