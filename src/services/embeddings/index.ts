import {createHash} from 'crypto';
import gemini from '../gemini';

/**
 * Meaning fingerprints (embeddings) for memory search, made with Gemini's
 * embedding model on the paid API (content is not used to train Google's
 * models). Vectors are normalised to unit length and packed into signed
 * 8-bit values: 768 bytes each, which keeps them small enough for the
 * Atlas free tier and fast to compare in the API.
 */

export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 768;
const MAX_BATCH = 100;
const SCALE = 127;

export type EmbeddingTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/** Swappable for tests. */
export type Embedder = (
  texts: string[],
  task: EmbeddingTask,
) => Promise<number[][]>;

const geminiEmbedder: Embedder = async (texts, task) => {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += MAX_BATCH) {
    const batch = texts.slice(start, start + MAX_BATCH);
    const response = await gemini.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: batch,
      config: {taskType: task, outputDimensionality: EMBEDDING_DIMENSIONS},
    });
    for (const embedding of response.embeddings ?? []) {
      vectors.push(embedding.values ?? []);
    }
  }
  if (vectors.length !== texts.length) {
    throw new Error('Embedding count does not match the input');
  }
  return vectors;
};

let embedder: Embedder = geminiEmbedder;

export function setEmbedderForTests(next: Embedder | null): void {
  embedder = next ?? geminiEmbedder;
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
