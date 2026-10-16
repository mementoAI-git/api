import type {NextFunction, Request, Response} from 'express';
import {z} from 'zod';
import {BadRequestException} from '../../../utils/service-error';

const reason = z.string().trim().max(500).optional();
export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z
      .string()
      .min(1)
      .max(72)
      .refine(value => Buffer.byteLength(value, 'utf8') <= 72),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();
export const valueSchema = z.object({value: z.boolean(), reason}).strict();
export const overrideSchema = valueSchema.extend({
  rolloutPercentage: z.number().min(0).max(100).nullable().optional(),
});
export const rolloutSchema = z
  .object({rolloutPercentage: z.number().min(0).max(100).nullable(), reason})
  .strict();
export const deleteSchema = z.object({reason}).strict();
export const bulkSchema = valueSchema.extend({
  prefix: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_.-]+$/),
});
export const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    search: z.string().max(128).optional(),
    domain: z.string().max(128).optional(),
  })
  .strict();
const paramsSchema = z
  .object({
    key: z.string().min(1).max(128),
    scopeType: z.enum(['global', 'environment', 'user']).optional(),
    scopeId: z.string().min(1).max(128).optional(),
  })
  .refine(value => value.scopeType !== 'global' || value.scopeId === 'global');
export function validate(schema: z.ZodType, source: 'body' | 'query' = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source] || {});
    if (!result.success)
      return next(new BadRequestException('Invalid staff request'));
    req[source] = result.data;
    next();
  };
}
export function validateParams(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (
    Object.keys(req.params).length &&
    !paramsSchema.safeParse(req.params).success
  )
    return next(new BadRequestException('Invalid feature flag scope'));
  next();
}

export const accountListSchema = z
  .object({
    search: z.string().trim().max(254).default(''),
    page: z.coerce.number().int().min(1).max(1000).default(1),
  })
  .strict();
export function validateAccountId(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!/^[a-f\d]{24}$/i.test(String(req.params.id)))
    return next(new BadRequestException('Invalid account ID'));
  next();
}
