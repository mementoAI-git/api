import z from 'zod';

export const onboardingSchema = z.object({
  body: z.strictObject({
    first_name: z.string().trim().optional().default(''),
    last_name: z.string().trim().optional().default(''),
    nickname: z.string().trim().optional().default(''), // replacing displayName
    age_range: z.string().trim().optional().default(''),
    location: z.string().trim().optional().default(''), // replacing whereFrom
    step: z.number().int().min(1).max(8).optional().default(1),
    join_reasons: z.array(z.string().trim()).optional().default([]), // replacing passions passionsFreetext
    audience: z.array(z.string().trim()).optional().default([]), // replacing mementoFor mementoForFreetext
    current_priority: z.array(z.string().trim()).optional().default([]), // replacing priorityDimensions
    prefered_communication_style: z.string().trim().optional().default(''), // replacing expressionMode
    onboarding_status: z
      .enum(['never', 'skipped', 'completed', 'in_progress'])
      .optional()
      .default('never'),
    motivation: z.string().trim().optional().default(''),
    age_bracket: z.string().trim().optional().default(''),
    priority_dimensions: z.array(z.string().trim()).optional().default([]),
    expression_mode: z
      .enum(['text', 'voice', 'mixed'])
      .optional()
      .default('text'),
  }),
});
export type OnboardingBody = z.infer<typeof onboardingSchema>['body'];
