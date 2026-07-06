import {z} from 'zod';

const mongoIdSchema = z
  .string()
  .min(1, 'ID is required')
  .regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

// Prompt (send message in existing memory)
// text is optional — media-only messages (attachments without caption) are valid.
export const promptSchema = z.object({
  body: z
    .strictObject({
      text: z.string().trim().optional(),
      memory: mongoIdSchema,
      attachments: z.array(mongoIdSchema).optional(),
      replyTo: z
        .object({
          role: z.string(),
          text: z.string(),
        })
        .optional(),
    })
    .refine(
      data => {
        const hasText = (data.text ?? '').length > 0;
        const hasAttachments = (data.attachments ?? []).length > 0;
        return hasText || hasAttachments;
      },
      {
        message: 'Send at least a message or an attachment',
      },
    ),
});

// Start new conversation
export const startConversationSchema = z.object({
  body: z.strictObject({
    text: z.string().min(1, 'Text is required').trim(),
    prompt_id: mongoIdSchema.optional(),
    attachments: z.array(mongoIdSchema).optional(),
  }),
});

// Generate tags for a story (title and/or body)
export const generateTagsSchema = z.object({
  body: z
    .strictObject({
      title: z.string().trim().optional(),
      body: z.string().trim().optional(),
    })
    .refine(
      data => {
        const title = (data.title ?? '').trim();
        const bodyText = (data.body ?? '').trim();
        return title.length > 0 || bodyText.length > 0;
      },
      {message: 'At least one of title or body is required'},
    ),
});

// Suggest a title from story text and/or a draft title (add-memory flow)
export const generateStoryTitleSchema = z.object({
  body: z
    .strictObject({
      title: z.string().trim().optional(),
      body: z.string().trim().optional(),
    })
    .refine(
      data => {
        const title = (data.title ?? '').trim();
        const bodyText = (data.body ?? '').trim();
        return title.length > 0 || bodyText.length > 0;
      },
      {message: 'Add some story text or a title to suggest from'},
    ),
});

// Get messages by conversation (path param)
export const getMessagesByConversationSchema = z.object({
  params: z.strictObject({
    id: mongoIdSchema,
  }),
});

// AI observability overview query
export const aiMetricsOverviewSchema = z.object({
  query: z
    .strictObject({
      hours: z.coerce.number().int().min(1).max(168).optional(),
    })
    .optional(),
});

// AI observability time-series query
export const aiMetricsTimeseriesSchema = z.object({
  query: z
    .strictObject({
      hours: z.coerce.number().int().min(1).max(168).optional(),
      interval_minutes: z.coerce.number().int().min(5).max(60).optional(),
    })
    .optional(),
});

export const aiPromptGovernanceSchema = z.object({
  query: z.strictObject({}).optional(),
});

export const aiVoicesSchema = z.object({
  query: z
    .strictObject({
      provider: z.enum(['gemini', 'elevenlabs']).optional(),
    })
    .optional(),
});

export const aiVoicePreviewSchema = z.object({
  body: z.strictObject({
    provider: z.enum(['gemini', 'elevenlabs']).optional(),
    voice_id: z.string().min(1),
    text: z.string().trim().min(1).max(240).optional(),
  }),
});

// Type exports
export type PromptBody = z.infer<typeof promptSchema>['body'];
export type StartConversationBody = z.infer<
  typeof startConversationSchema
>['body'];
export type GenerateTagsBody = z.infer<typeof generateTagsSchema>['body'];
export type GenerateStoryTitleBody = z.infer<
  typeof generateStoryTitleSchema
>['body'];
export type GetMessagesByConversationParams = z.infer<
  typeof getMessagesByConversationSchema
>['params'];
export type AiMetricsOverviewQuery = z.infer<
  typeof aiMetricsOverviewSchema
>['query'];
export type AiMetricsTimeseriesQuery = z.infer<
  typeof aiMetricsTimeseriesSchema
>['query'];
export type AiPromptGovernanceQuery = z.infer<
  typeof aiPromptGovernanceSchema
>['query'];
export type AiVoicesQuery = z.infer<typeof aiVoicesSchema>['query'];
export type AiVoicePreviewBody = z.infer<typeof aiVoicePreviewSchema>['body'];
