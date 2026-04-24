import AiMetric from "../../module/database/model/ai-metric";

export interface AiTokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface AiMetricPayload {
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
  token_usage?: AiTokenUsage;
  error_code?: string;
  error_message?: string;
  metadata?: Record<string, unknown>;
}

export async function recordAiMetric(payload: AiMetricPayload) {
  console.log("AI metric", payload);
  try {
    await AiMetric.create(payload);
  } catch (error) {
    // Never fail request flow on metrics persistence.
    console.error("Failed to persist AI metric", {
      event: payload.event,
      error: (error as Error)?.message
    });
  }
}
