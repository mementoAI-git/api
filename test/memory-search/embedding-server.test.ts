import {spawn, type ChildProcess} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {afterEach, describe, expect, it} from 'vitest';
import {engineConfig} from '../../src/services/memory-search/config';
import {embedInputs} from '../../src/services/memory-search/engine';

const SERVER = path.resolve(
  __dirname,
  '../../ops/memory-search/embedding-server/server.mjs',
);
const TOKEN = 'test-token-0123456789abcdef0123456789';
const INFO = {
  model: 'google/embeddinggemma-2',
  revision: 'bfcd298762cc34d0357ece5ebdd31791a3a374d8',
  runtime: 'llama.cpp-vectors1',
  dtype: 'text-q8_0+mmproj-q8_0',
  dim: 768,
};

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/**
 * A stand-in DigUp worker: counts its starts in a file, answers each line
 * with a vector whose first value is the input's length, and misbehaves on
 * request ("crash", "hang").
 */
async function fakeDigup(info = INFO) {
  const folder = await mkdtemp(path.join(tmpdir(), 'memento-embed-server-'));
  cleanup.push(() => rm(folder, {recursive: true, force: true}));
  const starts = path.join(folder, 'starts');
  const executable = path.join(folder, 'digup');
  await writeFile(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(starts)}, 'x');
console.log(JSON.stringify({ready: true, info: ${JSON.stringify(info)}}));
require('node:readline').createInterface({input: process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  if (request.op === 'quit') return process.stdout.write('', () => process.exit(0));
  if (request.inputs.includes('crash')) process.exit(3);
  if (request.inputs.includes('hang')) return;
  const values = Buffer.alloc(request.inputs.length * 768 * 4);
  request.inputs.forEach((input, row) => values.writeFloatLE(input.length, row * 768 * 4));
  console.log(JSON.stringify({id: request.id, ok: true, dim: 768, count: request.inputs.length, vectors: values.toString('base64'), errors: request.inputs.map(() => null)}));
});
`,
    {mode: 0o700},
  );
  return {executable, folder, starts};
}

async function startServer(executable: string, folder: string) {
  const child: ChildProcess = spawn(process.execPath, [SERVER], {
    env: {
      PATH: process.env.PATH,
      DIGUP_PATH: executable,
      DIGUP_MODELS: folder,
      EMBEDDING_SERVER_TOKEN: TOKEN,
      EMBEDDING_SERVER_HOST: '127.0.0.1',
      EMBEDDING_SERVER_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  cleanup.push(() => {
    child.kill('SIGKILL');
  });
  const lines = readline.createInterface({input: child.stdout!});
  const events: Record<string, unknown>[] = [];
  const port = await new Promise<number>((resolve, reject) => {
    child.on('exit', code => reject(new Error(`server exited ${code}`)));
    lines.on('line', line => {
      const event = JSON.parse(line);
      events.push(event);
      if (event.event === 'listening') resolve(event.port);
    });
  });
  return {url: `http://127.0.0.1:${port}`, events};
}

const text = (...inputs: string[]) => ({op: 'text' as const, inputs});

describe('embedding server', () => {
  it('loads the model once and answers many requests, in order', async () => {
    const digup = await fakeDigup();
    const {url} = await startServer(digup.executable, digup.folder);
    const config = {url, token: TOKEN};

    const results = await Promise.all(
      ['a', 'bb', 'ccc', 'dddd', 'eeeee'].map(input =>
        embedInputs([text(input), text(input + input)], config, 5_000),
      ),
    );

    // First value is the input length before normalising, so after
    // normalising it is 1 for every row.
    expect(results.every(r => r.length === 2 && r[0][0][0] === 1)).toBe(true);
    expect(await readFile(digup.starts, 'utf8')).toBe('x');
  });

  it('refuses a wrong token', async () => {
    const digup = await fakeDigup();
    const {url} = await startServer(digup.executable, digup.folder);

    await expect(
      embedInputs([text('a')], {url, token: 'x'.repeat(40)}, 5_000),
    ).rejects.toThrow('unavailable');
  });

  it('restarts the model after a crash', async () => {
    const digup = await fakeDigup();
    const {url, events} = await startServer(digup.executable, digup.folder);
    const config = {url, token: TOKEN};

    await expect(embedInputs([text('crash')], config, 5_000)).rejects.toThrow(
      'unavailable',
    );
    await expect
      .poll(() => events.filter(e => e.event === 'engine_ready').length, {
        timeout: 8_000,
      })
      .toBe(2);
    const [[vector]] = await embedInputs([text('back')], config, 5_000);
    expect(vector[0]).toBe(1);
  }, 15_000);

  it('times out a stuck request without waiting for it', async () => {
    const digup = await fakeDigup();
    const {url} = await startServer(digup.executable, digup.folder);

    await expect(
      embedInputs([text('hang')], {url, token: TOKEN}, 300),
    ).rejects.toThrow('timed out');
  });

  it('rejects a model it was not verified with', async () => {
    const digup = await fakeDigup({...INFO, dtype: 'f16'});
    const {url} = await startServer(digup.executable, digup.folder);

    await expect(
      embedInputs([text('a')], {url, token: TOKEN}, 5_000),
    ).rejects.toThrow('incompatible');
  });

  it('does not take photos while photo search is off', async () => {
    const digup = await fakeDigup();
    const {url} = await startServer(digup.executable, digup.folder);

    await expect(
      embedInputs([{op: 'image', inputs: ['/x.png']}], {url, token: TOKEN}),
    ).rejects.toThrow('unavailable');
  });
});

describe('engine configuration', () => {
  const saved = {...process.env};
  afterEach(() => {
    process.env = {...saved};
  });

  it('prefers the embedding server, and needs a real token for it', () => {
    process.env.MEMORY_SEARCH_DIGUP_PATH = '/opt/digup';
    process.env.MEMORY_SEARCH_MODELS_DIR = '/opt/models';
    process.env.MEMORY_SEARCH_ENGINE_URL = 'http://10.0.0.5:8790/';
    process.env.MEMORY_SEARCH_ENGINE_TOKEN = TOKEN;
    expect(engineConfig()).toEqual({url: 'http://10.0.0.5:8790', token: TOKEN});

    process.env.MEMORY_SEARCH_ENGINE_TOKEN = 'short';
    expect(engineConfig()).toBeNull();
  });

  it('falls back to the local helper without a server', () => {
    delete process.env.MEMORY_SEARCH_ENGINE_URL;
    process.env.MEMORY_SEARCH_DIGUP_PATH = '/opt/digup';
    process.env.MEMORY_SEARCH_MODELS_DIR = '/opt/models';
    expect(engineConfig()).toEqual({
      executable: '/opt/digup',
      modelDir: '/opt/models',
    });
  });
});
