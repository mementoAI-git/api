#!/usr/bin/env node
/**
 * Memento embedding server: keeps one DigUp worker (EmbeddingGemma 2)
 * loaded and answers embedding requests from the API and workers over the
 * private network. Loading the model once is what makes search fast enough
 * for voice; spawning DigUp per query reloads the model every time.
 *
 * No dependencies beyond Node 20. Never logs inputs, vectors or paths.
 *
 *   POST /v1/embed   {batches: [{op: 'text', inputs: [...]}, ...]}
 *                    -> {info, replies: [{count, vectors}]}  (base64 float32)
 *   GET  /health     -> {ready, info, restarts, queued}
 *
 * Every request needs "Authorization: Bearer $EMBEDDING_SERVER_TOKEN".
 *
 * Environment:
 *   DIGUP_PATH, DIGUP_MODELS     absolute paths to the verified runtime/models
 *   EMBEDDING_SERVER_TOKEN       shared secret, at least 32 characters
 *   EMBEDDING_SERVER_HOST        private-network address to listen on
 *   EMBEDDING_SERVER_PORT        default 8790
 *   EMBEDDING_TEXT_ONLY          default true (photos off: skips the image encoder)
 */
import {spawn} from 'node:child_process';
import {timingSafeEqual} from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';

const MODEL = 'google/embeddinggemma-2';
const REVISION = 'bfcd298762cc34d0357ece5ebdd31791a3a374d8';
const RUNTIME = 'llama.cpp-vectors1';
const DIM = 768;
const MAX_BATCHES = 128;
const MAX_INPUTS = 16;
const MAX_INPUT_CHARS = 8_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** One batch should never take this long; the worker is restarted if it does. */
const BATCH_TIMEOUT_MS = 60_000;
const MAX_QUEUED = 512;
const BUDGET = 140;

const executable = process.env.DIGUP_PATH || '';
const models = process.env.DIGUP_MODELS || '';
const token = process.env.EMBEDDING_SERVER_TOKEN || '';
const host = process.env.EMBEDDING_SERVER_HOST || '127.0.0.1';
const port = Number(process.env.EMBEDDING_SERVER_PORT || 8790);
const textOnly = process.env.EMBEDDING_TEXT_ONLY !== 'false';

if (!path.isAbsolute(executable) || !path.isAbsolute(models)) {
  console.error('DIGUP_PATH and DIGUP_MODELS must be absolute paths');
  process.exit(1);
}
if (token.length < 32) {
  console.error('EMBEDDING_SERVER_TOKEN must be at least 32 characters');
  process.exit(1);
}

function log(event, fields = {}) {
  console.log(JSON.stringify({at: new Date().toISOString(), event, ...fields}));
}

/** The running DigUp worker, its readiness, and requests waiting on it. */
const engine = {
  child: null,
  info: null,
  ready: null,
  nextId: 1,
  pending: new Map(),
  restarts: 0,
  /** Batches run one at a time, in order. */
  chain: Promise.resolve(),
  queued: 0,
};

function failPending(error) {
  for (const {reject, timer} of engine.pending.values()) {
    clearTimeout(timer);
    reject(error);
  }
  engine.pending.clear();
}

function validInfo(info) {
  return (
    info &&
    info.model === MODEL &&
    info.revision === REVISION &&
    info.runtime === RUNTIME &&
    info.dim === DIM
  );
}

function start() {
  engine.info = null;
  const child = spawn(
    executable,
    ['worker', ...(textOnly ? ['--text-only'] : [])],
    {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        DIGUP_MODELS: models,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  engine.child = child;
  const began = Date.now();
  engine.ready = new Promise((resolve, reject) => {
    const lines = readline.createInterface({input: child.stdout});
    let first = true;
    lines.on('line', line => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (first) {
        first = false;
        if (message.ready === true && validInfo(message.info)) {
          engine.info = message.info;
          log('engine_ready', {ms: Date.now() - began, textOnly});
          resolve();
        } else {
          log('engine_incompatible');
          reject(new Error('incompatible engine'));
          child.kill('SIGKILL');
        }
        return;
      }
      const waiting = engine.pending.get(message.id);
      if (!waiting) return;
      engine.pending.delete(message.id);
      clearTimeout(waiting.timer);
      waiting.resolve(message);
    });
  });
  engine.ready.catch(() => {});
  child.stderr.resume();
  child.stdin.on('error', () => {});
  child.on('error', () => log('engine_spawn_failed'));
  child.on('exit', code => {
    if (engine.child !== child) return;
    engine.child = null;
    engine.info = null;
    failPending(new Error('engine stopped'));
    engine.restarts++;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(engine.restarts, 5));
    log('engine_exit', {code, restartInMs: delay});
    setTimeout(start, delay);
  });
}

function restart(reason) {
  log('engine_restart', {reason});
  engine.child?.kill('SIGKILL');
}

async function runBatch(batch) {
  await engine.ready;
  const child = engine.child;
  if (!child || !engine.info) throw new Error('engine not ready');
  const id = engine.nextId++;
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      engine.pending.delete(id);
      reject(new Error('batch timed out'));
      restart('timeout');
    }, BATCH_TIMEOUT_MS);
    engine.pending.set(id, {resolve, reject, timer});
  });
  child.stdin.write(
    JSON.stringify({id, op: batch.op, inputs: batch.inputs, budget: BUDGET}) +
      '\n',
  );
  const message = await reply;
  const bytes = Buffer.from(String(message.vectors || ''), 'base64');
  if (
    message.ok !== true ||
    message.dim !== DIM ||
    message.count !== batch.inputs.length ||
    bytes.length !== batch.inputs.length * DIM * 4
  ) {
    throw new Error('incomplete reply');
  }
  return {count: message.count, vectors: message.vectors};
}

/** Queues a request's batches behind earlier ones. */
function embed(batches) {
  engine.queued++;
  const run = engine.chain.then(async () => {
    const replies = [];
    for (const batch of batches) replies.push(await runBatch(batch));
    return replies;
  });
  engine.chain = run.catch(() => {}).finally(() => engine.queued--);
  return run;
}

function invalid(body) {
  const batches = body?.batches;
  if (
    !Array.isArray(batches) ||
    !batches.length ||
    batches.length > MAX_BATCHES
  )
    return 'batches must be a non-empty list';
  for (const batch of batches) {
    if (batch?.op !== 'text' && batch?.op !== 'image') return 'unknown op';
    if (batch.op === 'image' && textOnly) return 'images are disabled';
    if (
      !Array.isArray(batch.inputs) ||
      !batch.inputs.length ||
      batch.inputs.length > MAX_INPUTS ||
      batch.inputs.some(
        input => typeof input !== 'string' || input.length > MAX_INPUT_CHARS,
      )
    )
      return 'inputs must be 1-16 strings';
  }
  return null;
}

function authorised(request) {
  const given = Buffer.from(String(request.headers.authorization || ''));
  const wanted = Buffer.from(`Bearer ${token}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

function send(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
}

const server = http.createServer((request, response) => {
  if (!authorised(request)) return send(response, 401, {error: 'unauthorised'});
  if (request.method === 'GET' && request.url === '/health') {
    return send(response, engine.info ? 200 : 503, {
      ready: Boolean(engine.info),
      info: engine.info,
      restarts: engine.restarts,
      queued: engine.queued,
    });
  }
  if (request.method !== 'POST' || request.url !== '/v1/embed') {
    return send(response, 404, {error: 'not found'});
  }
  if (engine.queued >= MAX_QUEUED) return send(response, 503, {error: 'busy'});
  const chunks = [];
  let size = 0;
  request.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      send(response, 413, {error: 'too large'});
      request.destroy();
    } else chunks.push(chunk);
  });
  request.on('end', async () => {
    if (response.headersSent) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(response, 400, {error: 'invalid json'});
    }
    const problem = invalid(body);
    if (problem) return send(response, 400, {error: problem});
    const began = Date.now();
    try {
      const replies = await embed(body.batches);
      const inputs = body.batches.reduce((sum, b) => sum + b.inputs.length, 0);
      log('embedded', {inputs, ms: Date.now() - began});
      send(response, 200, {info: engine.info, replies});
    } catch (error) {
      log('embed_failed', {reason: error.message, ms: Date.now() - began});
      send(response, 503, {error: 'engine unavailable'});
    }
  });
});

start();
server.listen(port, host, () =>
  log('listening', {host, port: server.address().port}),
);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close();
    const child = engine.child;
    engine.child = null;
    child?.stdin.end(JSON.stringify({id: 0, op: 'quit'}) + '\n');
    setTimeout(() => process.exit(0), 2_000).unref();
  });
}
