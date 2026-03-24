import { createUserContent } from "@google/genai";
import { logger, prompts } from "../../utils";
import gemini, { GEMINI_MODEL } from "../../services/gemini";
import { extractJson } from "../../utils/helpers";
import Persona, { IPersona } from "../../module/database/model/persona";

export async function extractBatchInsights(
  user_id: string,
  exchanges: Array<{ user: string; ai: string }>
): Promise<Record<string, unknown> | undefined> {
  if (!exchanges || exchanges.length === 0) return undefined;

  try {
    const persona = await Persona.findOne({ user: user_id });
    const prompt = prompts.buildInsightsPrompt(persona || {} as IPersona);

    // Format all exchanges into a single conversation text
    const conversationText = exchanges
      .map((ex, i) => `--- Exchange ${i + 1} ---\nUser: ${ex.user}\nAI: ${ex.ai}`)
      .join('\n\n');

    const contents = createUserContent([
      prompt,
      { text: conversationText }
    ]);

    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents
    });

    const insights = extractJson(response.text)

    return insights;
  } catch (error) {
    logger.error(error, 'Error extracting batch insights');
    return undefined;
  }
}