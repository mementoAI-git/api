import { createUserContent } from "@google/genai";
import gemini, { GEMINI_MODEL } from "../gemini";
import { extractJson } from "../../utils/helpers";
import { ITranscriptionData } from "../../module/database/model/file";
import { AsrProvider, AsrTranscriptionInput, AsrTranscriptionResult } from "./types";

export class GeminiAsrProvider implements AsrProvider {
  readonly providerId: string;
  private readonly modelName: string;

  constructor(providerId = "gemini", modelName = GEMINI_MODEL) {
    this.providerId = providerId;
    this.modelName = modelName;
  }

  async transcribe(input: AsrTranscriptionInput): Promise<AsrTranscriptionResult> {
    const contents = createUserContent([input.transcriptionPrompt, input.processedFilePart as any]);
    const response = await gemini.models.generateContent({ model: this.modelName, contents });
    const parsed: ITranscriptionData = extractJson(response.text);

    const normalizedData =
      parsed?.full_text && Array.isArray(parsed?.segments) ?
        parsed
      : { full_text: response.text };

    return {
      data: normalizedData,
      provider: this.providerId,
      model: this.modelName,
      tokenUsage: {
        prompt_tokens: response.usageMetadata?.promptTokenCount,
        completion_tokens: response.usageMetadata?.candidatesTokenCount,
        total_tokens: response.usageMetadata?.totalTokenCount
      }
    };
  }
}
