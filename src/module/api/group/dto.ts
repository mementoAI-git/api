import {z} from 'zod';

const mongoIdSchema = z
  .string()
  .min(1, 'ID is required')
  .regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const nameSchema = z
  .string()
  .min(1, 'Name is required')
  .trim()
  .max(120, 'Name must be at most 120 characters');

const descriptionSchema = z
  .string()
  .trim()
  .max(500, 'Description must be at most 500 characters')
  .optional()
  .default('');

// Create group
export const createGroupSchema = z.object({
  body: z.strictObject({
    name: nameSchema,
    description: descriptionSchema,
  }),
});

// Get group (path param)
export const getGroupSchema = z.object({
  params: z.strictObject({
    id: mongoIdSchema,
  }),
});

// Update group (path param + body)
export const updateGroupSchema = z.object({
  params: z.strictObject({
    id: mongoIdSchema,
  }),
  body: z
    .strictObject({
      name: nameSchema.optional(),
      description: descriptionSchema.optional(),
    })
    .refine(data => data.name !== undefined || data.description !== undefined, {
      message: 'At least one of name or description is required',
    }),
});

// Delete group (path param)
export const deleteGroupSchema = z.object({
  params: z.strictObject({
    id: mongoIdSchema,
  }),
});

// Add members (path param + body)
export const addMembersSchema = z.object({
  params: z.strictObject({
    id: mongoIdSchema,
  }),
  body: z.strictObject({
    beneficiaryIds: z
      .array(mongoIdSchema)
      .min(1, 'beneficiaryIds must be a non-empty array'),
  }),
});

// Remove member (path params)
export const removeMemberSchema = z.object({
  params: z.strictObject({
    id: mongoIdSchema,
    beneficiaryId: mongoIdSchema,
  }),
});

export const searchSchema = z.object({
  query: z.strictObject({
    q: z
      .string()
      .min(1, 'Search query is required')
      .trim()
      .max(100, 'Query too long'),
    resource: z.enum(['group', 'beneficiary', 'all']).optional().default('all'),
  }),
});

// Type exports
export type CreateGroupBody = z.infer<typeof createGroupSchema>['body'];
export type GetGroupParams = z.infer<typeof getGroupSchema>['params'];
export type UpdateGroupParams = z.infer<typeof updateGroupSchema>['params'];
export type UpdateGroupBody = z.infer<typeof updateGroupSchema>['body'];
export type DeleteGroupParams = z.infer<typeof deleteGroupSchema>['params'];
export type AddMembersParams = z.infer<typeof addMembersSchema>['params'];
export type AddMembersBody = z.infer<typeof addMembersSchema>['body'];
export type RemoveMemberParams = z.infer<typeof removeMemberSchema>['params'];
export type SearchQuery = z.infer<typeof searchSchema>['query'];
