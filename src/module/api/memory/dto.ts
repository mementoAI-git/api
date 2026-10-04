import {z} from 'zod';

const mongoIdSchema = z
  .string()
  .min(1, 'ID is required')
  .regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const attachmentsSchema = z
  .union([
    z.string().transform(s =>
      s
        ? s
            .split(',')
            .map(x => x.trim())
            .filter(Boolean)
        : [],
    ),
    z.array(mongoIdSchema),
  ])
  .optional()
  .default([]);

const tagsSchema = z
  .union([
    z.string().transform(s =>
      s
        ? s
            .split(',')
            .map(x => x.trim())
            .filter(Boolean)
        : [],
    ),
    z.array(z.string()),
  ])
  .optional()
  .default([]);

const beneficiariesSchema = z
  .union([
    z.string().transform(s =>
      s
        ? s
            .split(',')
            .map(x => x.trim())
            .filter(Boolean)
        : [],
    ),
    z.array(mongoIdSchema),
  ])
  .optional()
  .default([]);

const groupsSchema = z
  .union([
    z.string().transform(s =>
      s
        ? s
            .split(',')
            .map(x => x.trim())
            .filter(Boolean)
        : [],
    ),
    z.array(mongoIdSchema),
  ])
  .optional()
  .default([]);

const visibilitySchema = z
  .enum(['private', 'everyone'])
  .optional()
  .default('private');

// Create memory
export const createMemorySchema = z.object({
  body: z.strictObject({
    title: z.string().optional(),
    body: z.string().optional(),
    level: z.coerce.number().int().min(1).optional().default(1),
    status: z.enum(['draft', 'save']).optional(),
    attachments: attachmentsSchema,
    tags: tagsSchema,
    groups: groupsSchema,
    beneficiaries: beneficiariesSchema,
    visibility: visibilitySchema,
  }),
});

// Update memory (path + body)
export const updateMemorySchema = z.object({
  params: z.strictObject({
    id: mongoIdSchema,
  }),
  body: z.strictObject({
    status: z.enum(['draft', 'save']).optional(),
    attachments: attachmentsSchema,
    tags: tagsSchema,
    level: z.coerce.number().int().min(1).optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    groups: groupsSchema.optional(),
    beneficiaries: beneficiariesSchema.optional(),
    visibility: z.enum(['private', 'everyone']).optional(),
  }),
});

// Remove file from memory (path param)
export const removeFileFromMemorySchema = z.object({
  params: z.strictObject({
    id: mongoIdSchema,
  }),
});

// Add message to memory
const messageItemSchema = z.strictObject({
  text: z.string().trim().min(1, 'Text is required'),
  role: z.enum(['user', 'ai']),
  is_voice: z.boolean().optional(),
  duration: z.coerce.number().int().min(0).optional(),
});

export const addMessageToMemorySchema = z
  .object({
    body: z.strictObject({
      messages: z.array(messageItemSchema).min(1, 'Messages are required'),
      memory_id: mongoIdSchema.optional(),
      session_id: z.string().trim().optional(),
    }),
  })
  .refine(
    data =>
      (data.body.memory_id !== null && data.body.memory_id !== undefined) ||
      (data.body.session_id !== null &&
        data.body.session_id !== undefined &&
        data.body.session_id.length > 0),
    {message: 'Either memory_id or session_id is required', path: ['body']},
  );

// Delete memory (path + optional body)
export const deleteMemorySchema = z.object({
  params: z.strictObject({
    id: mongoIdSchema,
  }),
  body: z
    .strictObject({
      delete_permanently: z.boolean().optional().default(false),
    })
    .optional()
    .default({delete_permanently: false}),
});

// Type exports
export type CreateMemoryBody = z.infer<typeof createMemorySchema>['body'];
export type UpdateMemoryParams = z.infer<typeof updateMemorySchema>['params'];
export type UpdateMemoryBody = z.infer<typeof updateMemorySchema>['body'];
export type RemoveFileFromMemoryParams = z.infer<
  typeof removeFileFromMemorySchema
>['params'];
export type AddMessageToMemoryBody = z.infer<
  typeof addMessageToMemorySchema
>['body'];
export type DeleteMemoryParams = z.infer<typeof deleteMemorySchema>['params'];
export type DeleteMemoryBody = z.infer<typeof deleteMemorySchema>['body'];
