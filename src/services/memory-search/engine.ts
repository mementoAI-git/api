import {spawn} from 'node:child_process';
import {z} from 'zod';
import {engineConfig, type EngineConfig} from './config';

export type EmbeddingInput = {op: 'text' | 'image'; inputs: string[]};
const MODEL_REVISION = 'bfcd298762cc34d0357ece5ebdd31791a3a374d8';
const readySchema = z.object({
  ready: z.literal(true),
  info: z.object({
    model: z.literal('google/embeddinggemma-2'),
    revision: z.literal(MODEL_REVISION),
    runtime: z.literal('llama.cpp-vectors1'),
    dtype: z.literal('text-q8_0+mmproj-q8_0'),
    dim: z.literal(768),
  }),
});
const replySchema = z.object({
  id: z.number().int(),
  ok: z.literal(true),
  dim: z.literal(768),
  count: z.number().int().nonnegative(),
  vectors: z.string(),
  errors: z.array(z.null()),
});
let active = 0;

/** External local process only. Rejects incompatible models, invalid vectors and partial inputs. */
export async function embedInputs(
  batches: EmbeddingInput[],
  config: EngineConfig = engineConfig(),
  timeoutMs = 120_000,
): Promise<number[][][]> {
  if (!config) throw new Error('Description search is not configured');
  if (active >= 2) throw new Error('Description search is busy');
  if (!batches.length) return [];
  if (
    batches.some(batch => !batch.inputs.length || batch.inputs.length > 16) ||
    batches.length > 128
  )
    throw new Error('Embedding input exceeds pilot limits');
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(
        config.executable,
        [
          'worker',
          ...(batches.every(batch => batch.op === 'text')
            ? ['--text-only']
            : []),
        ],
        {
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            TMPDIR: process.env.TMPDIR,
            DIGUP_MODELS: config.modelDir,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let settled = false;
      let output = '';
      const finish = (error?: Error, result?: number[][][]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          child.kill('SIGKILL');
          reject(error);
        } else resolve(result);
      };
      const timer = setTimeout(
        () => finish(new Error('Description search timed out')),
        timeoutMs,
      );
      child.on('error', () =>
        finish(new Error('Description search engine is unavailable')),
      );
      child.stdin.on('error', () =>
        finish(new Error('Description search engine stopped')),
      );
      child.stderr.resume(); // Never log paths, sample contents or model inputs.
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
        if (output.length > 4 * 1024 * 1024)
          finish(new Error('Description search response is too large'));
      });
      child.on('close', code => {
        if (settled) return;
        try {
          if (code !== 0) throw new Error('Description search engine failed');
          const lines = output
            .trim()
            .split('\n')
            .map(line => JSON.parse(line));
          readySchema.parse(lines.shift());
          const result = batches.map((batch, index) => {
            const reply = replySchema.parse(lines[index]);
            if (
              reply.id !== index + 1 ||
              reply.count !== batch.inputs.length ||
              reply.errors.length !== batch.inputs.length
            )
              throw new Error('Description search response is incomplete');
            const bytes = Buffer.from(reply.vectors, 'base64');
            if (bytes.length !== reply.count * 768 * 4)
              throw new Error('Description search vector is incomplete');
            return batch.inputs.map((_, row) => {
              const vector = Array.from({length: 768}, (__, column) =>
                bytes.readFloatLE((row * 768 + column) * 4),
              );
              const norm = Math.sqrt(
                vector.reduce((sum, value) => sum + value * value, 0),
              );
              if (
                !vector.every(Number.isFinite) ||
                !Number.isFinite(norm) ||
                norm < 0.001
              )
                throw new Error(
                  'Description search returned an invalid vector',
                );
              return vector.map(value => value / norm);
            });
          });
          finish(undefined, result);
        } catch {
          finish(
            new Error(
              'Description search returned invalid or incompatible embeddings',
            ),
          );
        }
      });
      child.stdin.end(
        batches
          .map((batch, index) =>
            JSON.stringify({id: index + 1, ...batch, budget: 140}),
          )
          .join('\n') +
          '\n' +
          JSON.stringify({id: batches.length + 1, op: 'quit'}) +
          '\n',
      );
    });
  } finally {
    active--;
  }
}

export async function embedQuery(query: string): Promise<number[]> {
  return (
    await embedInputs(
      [{op: 'text', inputs: [`task: search result | query: ${query}`]}],
      undefined,
      3000,
    )
  )[0][0];
}
