import {BENEFICIARY_ACCESS_SCOPES} from '../../database/model/beneficiary';
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

const personParams = z.object({
  personId: z.string().regex(/^[a-fA-F0-9]{24}$/),
});
const sourceId = z.string().regex(/^[a-fA-F0-9]{24}$/);
export const contributionSchema = z.object({
  params: personParams,
  body: z.strictObject({
    title: z.string().trim().min(1).max(300),
    body: z.string().max(50000).default(''),
    kind: z.enum(['story', 'note', 'photo', 'video', 'voice']),
    attachments: z.array(sourceId).max(20).default([]),
  }),
});
export const shareSchema = z.object({
  params: personParams,
  body: z.strictObject({source_id: sourceId}),
});
export const itemSchema = z.object({params: personParams.extend({sourceId})});
export const sourcesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    search: z.string().max(200).default(''),
  }),
});
export const personSchema = z.object({params: personParams});
export const labelSchema = z.object({
  params: personParams,
  body: z.strictObject({
    label: z.string().trim().min(1).max(80),
    display_name: z.string().trim().max(100).optional(),
    about: z.string().trim().max(5000).optional(),
    group_ids: z.array(sourceId).max(100).optional(),
    access_scope: z.enum(BENEFICIARY_ACCESS_SCOPES).optional(),
    avatar_file_id: sourceId.nullable().optional(),
  }),
});
export const disconnectSchema = z.object({
  params: personParams,
  body: z.strictObject({block: z.boolean().default(false)}),
});
export const activationSchema = z.object({
  body: z.strictObject({
    approved_context: z.string().trim().max(6000),
    active: z.boolean(),
  }),
});
export const talkHistorySchema = z.object({
  params: personParams,
  query: z.object({shared_space: z.enum(['true', 'false']).optional()}),
});
export const talkSchema = z.object({
  params: personParams,
  body: z.strictObject({
    text: z.string().trim().max(4000),
    attachments: z.array(sourceId).max(20).optional(),
    request_id: z.uuid(),
    is_voice: z.boolean().default(false),
    source_id: sourceId.optional(),
    shared_input_id: sourceId.optional(),
    shared_space: z.boolean().optional(),
  }),
});

export const voiceStatusSchema = z.object({
  params: personParams.extend({sessionId: z.uuid()}),
});
export const voiceRecordSchema = z.object({
  params: personParams,
  body: z.strictObject({
    session_id: z.uuid(),
    request_id: z.uuid(),
    messages: z
      .array(
        z.strictObject({
          role: z.enum(['user', 'ai']),
          text: z.string().trim().min(1).max(12000),
          is_voice: z.boolean().optional(),
          duration: z.number().min(0).optional(),
          attachments: z.array(sourceId).max(20).optional(),
        }),
      )
      .min(1)
      .max(20),
  }),
});
