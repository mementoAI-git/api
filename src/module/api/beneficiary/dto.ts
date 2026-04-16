import {z} from 'zod';

const mongoIdSchema = z
  .string()
  .min(1, 'ID is required')
  .regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format');

const groupsSchema = z.array(mongoIdSchema).optional().default([]);

// Create beneficiary
export const createBeneficiarySchema = z.object({
  body: z.strictObject({
    email: z
      .email('Invalid email address')
      .nonempty('Email is required')
      .trim()
      .toLowerCase(),
    name: z.string().trim().optional().default(''),
    relationship: z.string().trim().optional().default('friend'),
    groups: groupsSchema,
  }),
});

export type CreateBeneficiaryBody = z.infer<
  typeof createBeneficiarySchema
>['body'];
