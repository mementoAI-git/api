import z from 'zod';

export const onboardingSchema = z.object({
  body: z.strictObject({
    first_name: z.string().trim().optional(),
    last_name: z.string().trim().optional(),
    nickname: z.string().trim().optional(), // replacing displayName
    age_range: z.string().trim().optional(),
    location: z.string().trim().optional(), // replacing whereFrom
    step: z.number().int().min(1).max(8).optional().default(1),
    join_reasons: z.array(z.string().trim()).optional().default([]), // replacing passions passionsFreetext
    audience: z.array(z.string().trim()).optional().default([]), // replacing mementoFor mementoForFreetext
    current_priority: z.array(z.string().trim()).optional().default([]), // replacing priorityDimensions
    prefered_communication_style: z.string().trim().optional(), // replacing expressionMode
    onboarding_status: z
      .enum(['never', 'skipped', 'completed', 'in_progress'])
      .optional()
      .default('never'),
    motivation: z.string().trim().optional(),
    motivation_detail: z.string().trim().optional(),
    age_bracket: z.string().trim().optional(),
    priority_dimensions: z.array(z.string().trim()).optional().default([]),
    expression_mode: z
      .enum(['text', 'voice', 'mixed'])
      .optional()
      .default('text'),
    chronotype: z.string().trim().optional(),
    sharing_intent: z.string().trim().optional(),
    life_situation: z.string().trim().optional(),
    life_situation_detail: z.string().trim().optional(),
    personality_traits: z.array(z.string().trim()).optional().default([]),
    memory_treasures: z.array(z.string().trim()).optional().default([]),
    skipped_deep_personalization: z.boolean().optional().default(false),
  }),
});
export type OnboardingBody = z.infer<typeof onboardingSchema>['body'];

export const onboardingChatPromptSchema = z.object({
  body: z.strictObject({
    messages: z
      .array(
        z.strictObject({
          role: z.enum(['user', 'assistant']),
          content: z.string().trim().default(''),
        }),
      )
      .default([]),
    nickname: z.string().trim().default(''),
    bootstrap: z.boolean().optional().default(false),
  }),
});

export type OnboardingChatPromptBody = z.infer<
  typeof onboardingChatPromptSchema
>['body'];
