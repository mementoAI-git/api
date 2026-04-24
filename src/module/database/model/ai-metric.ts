import { model, Schema } from "mongoose";

export interface IAiMetric {
  event: string;
  task?: string;
  endpoint?: string;
  provider?: string;
  model?: string;
  user?: string;
  memory?: string;
  prompt_version?: string;
  used_fallback?: boolean;
  duration_ms?: number;
  stream_connect_ms?: number;
  request_setup_ms?: number;
  fallback_count?: number;
  fast_mode?: boolean;
  token_usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error_code?: string;
  error_message?: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

const aiMetricSchema = new Schema<IAiMetric>({
  event: { type: String, required: true, index: true },
  task: { type: String, index: true },
  endpoint: { type: String, index: true },
  provider: { type: String, index: true },
  model: String,
  user: { type: String, index: true },
  memory: { type: String, index: true },
  prompt_version: String,
  used_fallback: Boolean,
  duration_ms: Number,
  stream_connect_ms: Number,
  request_setup_ms: Number,
  fallback_count: Number,
  fast_mode: Boolean,
  token_usage: {
    prompt_tokens: Number,
    completion_tokens: Number,
    total_tokens: Number,
  },
  error_code: String,
  error_message: String,
  metadata: Schema.Types.Mixed,
}, {
  timestamps: {
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
});

aiMetricSchema.index({ created_at: -1 });
aiMetricSchema.index({ task: 1, provider: 1, created_at: -1 });

const AiMetric = model<IAiMetric>("ai_metric", aiMetricSchema);
export default AiMetric;
