import z from 'zod';
import {Request, Response, NextFunction} from 'express';
import {UnprocessableContent} from '../utils/service-error';

export default function validate(schema: z.ZodType<any>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      Object.assign(req, validated);

      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        return next(
          new UnprocessableContent(errors[0]?.message || 'Invalid request', {
            errors,
          }),
        );
      }
      next(error);
    }
  };
}
