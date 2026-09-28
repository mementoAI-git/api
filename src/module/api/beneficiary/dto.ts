import {BENEFICIARY_ACCESS_SCOPES} from '../../database/model/beneficiary';
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
    about: z.string().trim().optional().default(''),
    relationship: z.string().trim().optional().default('friend'),
    access_scope: z.enum(BENEFICIARY_ACCESS_SCOPES).optional(),
    avatar_file_id: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format')
      .optional()
      .nullable(),
    groups: groupsSchema,
    group_ids: groupsSchema, // Alias supported by frontend
  }),
});

export type CreateBeneficiaryBody = z.infer<
  typeof createBeneficiarySchema
>['body'];

export const updateBeneficiarySchema = z.object({
  body: z.strictObject({
    email: z
      .string()
      .email('Invalid email address')
      .trim()
      .toLowerCase()
      .optional(),
    name: z.string().trim().optional(),
    about: z.string().trim().optional(),
    relationship: z.string().trim().optional(),
    access_scope: z.enum(BENEFICIARY_ACCESS_SCOPES).optional(),
    level: z.number().int().optional(),
    avatar_file_id: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/, 'Invalid ID format')
      .optional()
      .nullable(),
    groups: groupsSchema,
    group_ids: groupsSchema,
  }),
});

export type UpdateBeneficiaryBody = z.infer<
  typeof updateBeneficiarySchema
>['body'];
