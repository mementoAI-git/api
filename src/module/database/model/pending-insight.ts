import {model, Schema} from 'mongoose';
import {PERSONA_INSIGHT_FIELDS} from '../../../utils/constant';

export type PendingInsightSource = 'conversation' | 'story';
export type PendingInsightField = (typeof PERSONA_INSIGHT_FIELDS)[number];

export interface IPendingInsight {
  _id?: string;
  user: string;
  memory: string;
  source: PendingInsightSource;
  field: PendingInsightField;
  content: string;
  created_at: Date;
  updated_at: Date;
}

const pendingInsightSchema = new Schema<IPendingInsight>(
  {
    user: {type: String, ref: 'user', required: true, index: true},
    memory: {type: String, ref: 'memory', required: true},
    source: {
      type: String,
      enum: ['conversation', 'story'],
      required: true,
    },
    field: {
      type: String,
      enum: PERSONA_INSIGHT_FIELDS,
      required: true,
    },
    content: {type: String, required: true},
  },
  {
    timestamps: {createdAt: 'created_at', updatedAt: 'updated_at'},
    toJSON: {virtuals: true},
    toObject: {virtuals: true},
  },
);

pendingInsightSchema.index({user: 1, created_at: -1});

const PendingInsight = model<IPendingInsight>(
  'pending_insight',
  pendingInsightSchema,
);
export default PendingInsight;
