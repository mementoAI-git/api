import {z} from 'zod';

export const FEEDBACK_TYPES = [
  'Bug',
  'Feature Request',
  'UI/UX Issue',
  'General Feedback',
  'Other',
] as const;

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid screenshot id');

export const createFeedbackSchema = z.object({
  body: z
    .strictObject({
      type: z.enum(FEEDBACK_TYPES),
      email: z.string().trim().email().max(320),
      message: z.string().trim().min(1, 'Message is required').max(5000),
      screenshot: objectId.optional(),
      screenshots: z.array(objectId).max(5).optional(),
    })
    .superRefine((value, context) => {
      const ids = [value.screenshot, ...(value.screenshots ?? [])].filter(
        (id): id is string => Boolean(id),
      );
      if (new Set(ids).size > 5) {
        context.addIssue({
          code: 'custom',
          path: ['screenshots'],
          message: 'A maximum of 5 screenshots is allowed',
        });
      }
    }),
});

export type CreateFeedbackBody = z.infer<typeof createFeedbackSchema>['body'];
