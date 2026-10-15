#!/usr/bin/env node
/**
 * Memento embedding server: keeps EmbeddingGemma 2 (through the verified
 * DigUp worker) loaded and answers embedding requests from the API and
 * workers over the private network. Loading the model once is what makes
 * search fast enough for voice; spawning DigUp per query reloads it each time.
 *
 * Two lanes, each its own DigUp worker, so a search never waits behind
 * indexing: "query" (short search queries, more threads) and "index" (story
 * and chat text, which takes seconds per chunk on CPU).
 *
 * No dependencies beyond Node 20. Never logs inputs, vectors or paths.
 *
 *   POST /v1/embed   {lane?: 'query'|'index', batches: [{op: 'text', inputs: [...]}, ...]}
 *                    -> {info, replies: [{count, vectors}]}  (base64 float32)
 *   GET  /health     -> {ready, info, lanes: {query, index}}
 *
 * Every request needs "Authorization: Bearer $EMBEDDING_SERVER_TOKEN".
 *
 * Environment:
 *   DIGUP_PATH, DIGUP_MODELS     absolute paths to the verified runtime/models
 *   EMBEDDING_SERVER_TOKEN       shared secret, at least 32 characters
 *   EMBEDDING_SERVER_HOST        address to listen on (default 127.0.0.1)
 *   EMBEDDING_SERVER_PORT        default 8790
 *   EMBEDDING_TEXT_ONLY          default true (photos off: skips the image encoder)
 *   EMBEDDING_QUERY_THREADS      default 2
 *   EMBEDDING_INDEX_THREADS      default 2
 *
 * Keep the two thread counts within the machine's cores: llama.cpp threads
 * spin while they wait, so oversubscribing slows a search from ~140 ms to
 * ~2.8 s while indexing runs (measured on a 4-vCPU Hetzner box).
 */
import {spawn} from 'node:child_process';
import {timingSafeEqual} from 'node:crypto';
import {existsSync} from 'node:fs';
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
/** A query-lane request: a few short inputs, never a story. */
const MAX_QUERY_INPUTS = 4;
const MAX_QUERY_CHARS = 1_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** One batch should never take this long; the worker is restarted if it does. */
const BATCH_TIMEOUT_MS = 120_000;
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

function validInfo(info) {
  return (
    info &&
    info.model === MODEL &&
    info.revision === REVISION &&
    info.runtime === RUNTIME &&
    info.dim === DIM
  );
}

/**
 * The verified runtime's `digup` wrapper pins two threads; when its binary
 * sits next to it, run that directly so each lane picks its own count.
 */
function command(threads) {
  const dir = path.dirname(executable);
  const binary = path.join(dir, 'digup.bin');
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    DIGUP_MODELS: models,
  };
  const args = ['worker', ...(textOnly ? ['--text-only'] : [])];
  if (existsSync(binary)) {
    return {
      file: binary,
      args,
      env: {
        ...env,
        DIGUP_BACKENDS: path.join(dir, 'lib'),
        DIGUP_THREADS: String(threads),
      },
    };
  }
  return {file: executable, args, env};
}

/** One DigUp worker: its readiness, and the batches waiting on it, in order. */
function createLane(name, threads) {
  const lane = {
    name,
    child: null,
    info: null,
    ready: null,
    nextId: 1,
    pending: new Map(),
    restarts: 0,
    chain: Promise.resolve(),
    queued: 0,
  };

  function failPending(error) {
    for (const {reject, timer} of lane.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    lane.pending.clear();
  }

  function start() {
    lane.info = null;
    const {file, args, env} = command(threads);
    const child = spawn(file, args, {env, stdio: ['pipe', 'pipe', 'pipe']});
    lane.child = child;
    const began = Date.now();
    lane.ready = new Promise((resolve, reject) => {
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
            lane.info = message.info;
            log('engine_ready', {lane: name, threads, ms: Date.now() - began});
            resolve();
          } else {
            log('engine_incompatible', {lane: name});
            reject(new Error('incompatible engine'));
            child.kill('SIGKILL');
          }
          return;
        }
        const waiting = lane.pending.get(message.id);
        if (!waiting) return;
        lane.pending.delete(message.id);
        clearTimeout(waiting.timer);
        waiting.resolve(message);
      });
    });
    lane.ready.catch(() => {});
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => log('engine_spawn_failed', {lane: name}));
    child.on('exit', code => {
      if (lane.child !== child) return;
      lane.child = null;
      lane.info = null;
      failPending(new Error('engine stopped'));
      lane.restarts++;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(lane.restarts, 5));
      log('engine_exit', {lane: name, code, restartInMs: delay});
      setTimeout(start, delay);
    });
  }

  async function runBatch(batch) {
    await lane.ready;
    const child = lane.child;
    if (!child || !lane.info) throw new Error('engine not ready');
    const id = lane.nextId++;
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        lane.pending.delete(id);
        reject(new Error('batch timed out'));
        log('engine_restart', {lane: name, reason: 'timeout'});
        child.kill('SIGKILL');
      }, BATCH_TIMEOUT_MS);
      lane.pending.set(id, {resolve, reject, timer});
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

  /** Queues a request's batches behind earlier ones on this lane. */
  lane.embed = batches => {
    lane.queued++;
    const run = lane.chain.then(async () => {
      const replies = [];
      for (const batch of batches) replies.push(await runBatch(batch));
      return replies;
    });
    lane.chain = run.catch(() => {}).finally(() => lane.queued--);
    return run;
  };
  lane.start = start;
  lane.stop = () => {
    const child = lane.child;
    lane.child = null;
    child?.stdin.end(JSON.stringify({id: 0, op: 'quit'}) + '\n');
  };
  return lane;
}

const lanes = {
  query: createLane('query', Number(process.env.EMBEDDING_QUERY_THREADS || 2)),
  index: createLane('index', Number(process.env.EMBEDDING_INDEX_THREADS || 2)),
};

function invalid(body) {
  const batches = body?.batches;
  if (body?.lane !== undefined && !(body.lane in lanes)) return 'unknown lane';
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
  if (body.lane === 'query') {
    const inputs = batches.flatMap(batch => batch.inputs);
    if (
      inputs.length > MAX_QUERY_INPUTS ||
      inputs.some(input => input.length > MAX_QUERY_CHARS)
    )
      return 'the query lane takes up to 4 short inputs';
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
    const ready = Object.values(lanes).every(lane => lane.info);
    return send(response, ready ? 200 : 503, {
      ready,
      info: lanes.query.info || lanes.index.info,
      lanes: Object.fromEntries(
        Object.entries(lanes).map(([name, lane]) => [
          name,
          {
            ready: Boolean(lane.info),
            restarts: lane.restarts,
            queued: lane.queued,
          },
        ]),
      ),
    });
  }
  if (request.method !== 'POST' || request.url !== '/v1/embed') {
    return send(response, 404, {error: 'not found'});
  }
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
    const lane = lanes[body.lane || 'index'];
    if (lane.queued >= MAX_QUEUED) return send(response, 503, {error: 'busy'});
    const began = Date.now();
    try {
      const replies = await lane.embed(body.batches);
      const inputs = body.batches.reduce((sum, b) => sum + b.inputs.length, 0);
      log('embedded', {lane: lane.name, inputs, ms: Date.now() - began});
      send(response, 200, {info: lane.info, replies});
    } catch (error) {
      log('embed_failed', {
        lane: lane.name,
        reason: error.message,
        ms: Date.now() - began,
      });
      send(response, 503, {error: 'engine unavailable'});
    }
  });
});

for (const lane of Object.values(lanes)) lane.start();
server.listen(port, host, () =>
  log('listening', {host, port: server.address().port}),
);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close();
    for (const lane of Object.values(lanes)) lane.stop();
    setTimeout(() => process.exit(0), 2_000).unref();
  });
}
