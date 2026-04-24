import { ITranscriptionData } from "../../module/database/model/file";

export interface AsrTranscriptionInput {
  transcriptionPrompt: string;
  processedFilePart: unknown;
}

export interface AsrTranscriptionResult {
  data: ITranscriptionData | { full_text: string };
  provider: string;
  model: string;
  tokenUsage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface AsrRouterResult extends AsrTranscriptionResult {
  usedFallback: boolean;
}

export interface AsrShadowResult extends AsrTranscriptionResult {
  durationMs: number;
}

export interface AsrProvider {
  readonly providerId: string;
  transcribe(input: AsrTranscriptionInput): Promise<AsrTranscriptionResult>;
}
