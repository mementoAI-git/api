import { createUserContent } from "@google/genai";
import { logger, prompts } from "../../utils";
import gemini, { GEMINI_MODEL } from "../../services/gemini";
import { extractJson } from "../../utils/helpers";
import Persona, { IPersona } from "../../module/database/model/persona";
import Memory from "../../module/database/model/memory";
import { buildMemoryContent } from "../../module/api/ai/utils";

export async function extractStoryInsights(memoryId: string, userId: string): Promise<void> {
  try {
    const memory = await Memory.findById(memoryId).populate('attachments');
    const { text, processedImages } = await buildMemoryContent(memory);

    const persona = await Persona.findOne({ user: userId });
    const existingContext = persona || {} as IPersona;

    const prompt = prompts.buildInsightsPrompt(existingContext);

    const contents = createUserContent([
      prompt,
      { text },
      ...processedImages
    ]);

    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents
    });

    const insights = extractJson(response.text);
    return insights;
  } catch (error) {
    logger.error(error, 'Error extracting story insights');
    return null;
  }
}