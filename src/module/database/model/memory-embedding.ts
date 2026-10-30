import {Document, model, Schema} from 'mongoose';

/**
 * A meaning fingerprint of something the host wrote or said (a story, or
 * their own line in a chat or voice call), so memory search can match by
 * meaning instead of exact words. Lives next to the data it describes and
 * is deleted with it (account purge, story deletion).
 */
export type EmbeddingSource = 'story' | 'message';

export interface IMemoryEmbedding extends Document {
  user: string;
  source: EmbeddingSource;
  /** The story or message id. */
  source_id: string;
  /** For stories, which piece of a long story this is. */
  chunk: number;
  /** The story, or the conversation the message belongs to. */
  memory: string;
  /** What this vector was made from, shortened, to quote back. */
  text: string;
  /** Detects edits: re-embedded only when the text changes. */
  text_hash: string;
  /** Unit-length vector stored as signed 8-bit values (768 bytes). */
  vector: Buffer;
  embedding_model: string;
  /** When the original was written. */
  written_at?: Date;
}

const memoryEmbedding = new Schema(
  {
    user: {type: String, ref: 'user', required: true, index: true},
    source: {type: String, enum: ['story', 'message'], required: true},
    source_id: {type: String, required: true},
    chunk: {type: Number, default: 0},
    memory: {type: String, ref: 'memory'},
    text: {type: String, default: ''},
    text_hash: {type: String, required: true},
    vector: {type: Buffer, required: true},
    embedding_model: {type: String, required: true},
    written_at: Date,
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

memoryEmbedding.index(
  {source: 1, source_id: 1, chunk: 1},
  {unique: true, name: 'embedding_source_unique'},
);

const MemoryEmbedding = model<IMemoryEmbedding>(
  'memory_embedding',
  memoryEmbedding,
);
export default MemoryEmbedding;
