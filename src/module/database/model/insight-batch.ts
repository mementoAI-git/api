import {model, Schema} from 'mongoose';
import type {EnrichmentCategory} from '../../../services/enrichment';

/** One memory on one day. A chat earns a separate piece for each day. */
export interface IInsightEvidence {
  memory: string;
  /** YYYY-MM-DD */
  date: string;
}

export interface IInsightBatchItem {
  _id?: string;
  title: string;
  body: string;
  /** Every enrichment field the insight relates to, most relevant first. */
  categories: EnrichmentCategory[];
  /** Grows as new evidence appears. Removed when a memory is purged. */
  evidence: IInsightEvidence[];
  first_seen_at: Date;
  updated_at: Date;
}

/** One member's current understanding, revised on each evaluation. */
export interface IInsightBatch {
  _id?: string;
  user: string;
  insights: IInsightBatchItem[];
  /** When the evidence was last evaluated, whether or not anything changed. */
  generated_at?: Date | null;
  next_refresh_at: Date;
  /** Lease held by the process evaluating the evidence. */
  generating_until?: Date | null;
  /** Retired titles, so the same understanding does not come straight back. */
  previous_titles: string[];
}

const insightEvidenceSchema = new Schema<IInsightEvidence>(
  {
    memory: {type: String, required: true},
    date: {type: String, required: true},
  },
  {_id: false},
);

const insightBatchItemSchema = new Schema<IInsightBatchItem>({
  title: {type: String, required: true},
  body: {type: String, required: true},
  categories: {type: [String], required: true},
  evidence: {type: [insightEvidenceSchema], default: []},
  first_seen_at: {type: Date, required: true},
  updated_at: {type: Date, required: true},
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

insightBatchSchema.index({'insights.evidence.memory': 1});

const InsightBatch = model<IInsightBatch>('insight_batch', insightBatchSchema);
export default InsightBatch;
