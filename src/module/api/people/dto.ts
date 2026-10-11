import {z} from 'zod';

export const spaceSchema = z.object({
  params: z.object({personId: z.string().regex(/^[a-fA-F0-9]{24}$/)}),
  query: z.object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    filter: z
      .enum(['all', 'stories', 'photos', 'voice', 'videos', 'notes'])
      .default('all'),
  }),
});
