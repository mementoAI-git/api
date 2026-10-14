import {createHash} from 'crypto';
import {homedir} from 'os';
import {join} from 'path';
import gemini from '../gemini';
import {withRateLimitRetry} from './retry';

/**
 * Meaning fingerprints (embeddings) for memory search. Vectors are
 * normalised to unit length and packed into signed 8-bit values, which keeps
 * them small enough for the Atlas free tier and fast to compare in the API.
 *
 * Two providers, chosen with EMBEDDING_PROVIDER:
 * - 'local' (default): all-MiniLM-L6-v2 running on the API server itself
 *   (Transformers.js, CPU, about 4 ms and 170 MB). Free, no rate limits, and
 *   the host's words never leave the server. 384 dimensions.
 * - 'gemini': gemini-embedding-001 on the Gemini API. Better on rare words
 *   and other languages; needs the paid tier (the free tier may use content
 *   to improve Google's products and allows 100 requests a minute).
 *
 * Every vector records its model; search and the indexer only use vectors
 * from the current one, so switching re-embeds instead of mixing scales.
 */

export const EMBEDDING_PROVIDER: 'local' | 'gemini' =
  process.env.EMBEDDING_PROVIDER === 'gemini' ? 'gemini' : 'local';

const LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2';
const PROVIDERS = {
  local: {model: 'local:all-MiniLM-L6-v2', dimensions: 384, minScore: 0.25},
  gemini: {model: 'gemini-embedding-001@768', dimensions: 768, minScore: 0.5},
} as const;

export const EMBEDDING_MODEL = PROVIDERS[EMBEDDING_PROVIDER].model;
export const EMBEDDING_DIMENSIONS = PROVIDERS[EMBEDDING_PROVIDER].dimensions;
/** Below this similarity a match is noise (scales differ by model). */
export const EMBEDDING_MIN_SCORE = PROVIDERS[EMBEDDING_PROVIDER].minScore;

/**
 * Where the local model is downloaded once (about 90 MB). Outside the
 * release folder so deploys do not download it again.
 */
const MODEL_CACHE_DIR =
  process.env.EMBEDDING_CACHE_DIR ||
  join(homedir(), '.cache', 'memento-models');
const MAX_BATCH = 100;
const SCALE = 127;

export type EmbeddingTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/** Swappable for tests. */
export type Embedder = (
  texts: string[],
  task: EmbeddingTask,
) => Promise<number[][]>;

type Extractor = (
  texts: string[],
  options: {pooling: 'mean'; normalize: boolean},
) => Promise<{tolist(): number[][]}>;

let localPipeline: Promise<Extractor> | undefined;

/** Loaded on first use and kept: later calls reuse it. */
function loadLocalPipeline(): Promise<Extractor> {
  localPipeline ??= import('@huggingface/transformers').then(
    async ({pipeline, env}) => {
      env.cacheDir = MODEL_CACHE_DIR;
      return (await pipeline('feature-extraction', LOCAL_MODEL, {
        dtype: 'q8',
      })) as unknown as Extractor;
    },
  );
  localPipeline.catch(() => {
    // Let a later call try again (for example after a network blip).
    localPipeline = undefined;
  });
  return localPipeline;
}

/**
 * Loads the local model in the background at startup, so the first memory
 * search after a restart does not wait for it (about 15 s on a cold cache,
 * 1 s after). Never throws: search falls back to keywords until it is ready.
 */
export function warmUpEmbeddings(
  onError: (error: unknown) => void = () => undefined,
): void {
  if (EMBEDDING_PROVIDER !== 'local') return;
  loadLocalPipeline().catch(onError);
}

const LOCAL_BATCH = 32;

const localEmbedder: Embedder = async texts => {
  const extract = await loadLocalPipeline();
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += LOCAL_BATCH) {
    const output = await extract(texts.slice(start, start + LOCAL_BATCH), {
      pooling: 'mean',
      normalize: true,
    });
    vectors.push(...output.tolist());
  }
  return vectors;
};

const geminiEmbedder: Embedder = async (texts, task) => {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += MAX_BATCH) {
    const batch = texts.slice(start, start + MAX_BATCH);
    const response = await withRateLimitRetry(() =>
      gemini.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: batch,
        config: {taskType: task, outputDimensionality: EMBEDDING_DIMENSIONS},
      }),
    );
    for (const embedding of response.embeddings ?? []) {
      vectors.push(embedding.values ?? []);
    }
  }
  if (vectors.length !== texts.length) {
    throw new Error('Embedding count does not match the input');
  }
  return vectors;
};

const defaultEmbedder: Embedder =
  EMBEDDING_PROVIDER === 'gemini' ? geminiEmbedder : localEmbedder;
let embedder: Embedder = defaultEmbedder;

export function setEmbedderForTests(next: Embedder | null): void {
  embedder = next ?? defaultEmbedder;
}

export function embed(
  texts: string[],
  task: EmbeddingTask,
): Promise<number[][]> {
  return texts.length ? embedder(texts, task) : Promise.resolve([]);
}

/** Unit-length vector packed as signed bytes. */
export function pack(values: number[]): Buffer {
  const length = Math.hypot(...values) || 1;
  const bytes = Buffer.alloc(values.length);
  values.forEach((value, index) => {
    const scaled = Math.round((value / length) * SCALE);
    bytes.writeInt8(Math.max(-SCALE, Math.min(SCALE, scaled)), index);
  });
  return bytes;
}

/** Cosine similarity of two packed unit vectors (about -1 to 1). */
export function similarity(a: Buffer, b: Buffer): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i += 1) sum += a.readInt8(i) * b.readInt8(i);
  return sum / (SCALE * SCALE);
}

export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}
