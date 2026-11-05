import {model, Schema} from 'mongoose';
import type {EnrichmentCategory} from '../../../services/enrichment';

export interface IInsightBatchItem {
  _id?: string;
  title: string;
  body: string;
  /** Every enrichment field the insight relates to, most relevant first. */
  categories: EnrichmentCategory[];
  /** Memories that support the insight. Removed when a memory is purged. */
  memories: string[];
}

/** The rotating set of insights for one member. One document per user. */
export interface IInsightBatch {
  _id?: string;
  user: string;
  insights: IInsightBatchItem[];
  generated_at?: Date | null;
  next_refresh_at: Date;
  /** Lease held by the process generating the next batch. */
  generating_until?: Date | null;
  /** Recent titles, so a new batch surfaces something new. */
  previous_titles: string[];
}

const insightBatchItemSchema = new Schema<IInsightBatchItem>({
  title: {type: String, required: true},
  body: {type: String, required: true},
  categories: {type: [String], required: true},
  memories: {type: [String], default: []},
});

const insightBatchSchema = new Schema<IInsightBatch>(
  {
    user: {type: String, ref: 'user', required: true, unique: true},
    insights: {type: [insightBatchItemSchema], default: []},
    generated_at: {type: Date, default: null},
    next_refresh_at: {type: Date, required: true},
    generating_until: {type: Date, default: null},
    previous_titles: {type: [String], default: []},
  },
  {timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'}},
);

insightBatchSchema.index({'insights.memories': 1});

const InsightBatch = model<IInsightBatch>('insight_batch', insightBatchSchema);
export default InsightBatch;
