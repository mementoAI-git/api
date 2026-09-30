import express from 'express';
import request from 'supertest';
import {describe, expect, it} from 'vitest';
import {z} from 'zod';
import validate from '../../src/middleware/validator';
import errorHandler from '../../src/middleware/error-handler';

function appWith(schema: z.ZodType<any>) {
  const app = express();
  app.use(express.json());
  app.post('/t', validate(schema), (_req, res) => res.json({ok: true}));
  app.use(errorHandler);
  return app;
}

describe('validate()', () => {
  const schema = z.object({body: z.strictObject({name: z.string().min(1)})});

  it('passes valid input through', async () => {
    const res = await request(appWith(schema)).post('/t').send({name: 'a'});
    expect(res.status).toBe(200);
  });

  it('returns 422 with field paths for invalid input', async () => {
    const res = await request(appWith(schema)).post('/t').send({name: ''});
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('body.name');
  });
});
