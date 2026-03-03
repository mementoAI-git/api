import { z } from "zod";

const mongoIdSchema = z
  .string()
  .min(1, "ID is required")
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid ID format");

// Prompt (send message in existing memory)
export const promptSchema = z.object({
  body: z.strictObject({
    text: z.string().min(1, "Text is required").trim(),
    memory: mongoIdSchema,
    attachments: z.array(mongoIdSchema).optional(),
  }),
});

// Start new conversation
export const startConversationSchema = z.object({
  body: z.strictObject({
    text: z.string().min(1, "Text is required").trim(),
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
      (data) => {
        const title = (data.title ?? "").trim();
        const bodyText = (data.body ?? "").trim();
        return title.length > 0 || bodyText.length > 0;
      },
      { message: "At least one of title or body is required" }
    ),
});

// Get messages by conversation (path param)
export const getMessagesByConversationSchema = z.object({
  params: z.strictObject({
    id: mongoIdSchema,
  }),
});

// Type exports
export type PromptBody = z.infer<typeof promptSchema>["body"];
export type StartConversationBody = z.infer<typeof startConversationSchema>["body"];
export type GenerateTagsBody = z.infer<typeof generateTagsSchema>["body"];
export type GetMessagesByConversationParams = z.infer<
  typeof getMessagesByConversationSchema
>["params"];
