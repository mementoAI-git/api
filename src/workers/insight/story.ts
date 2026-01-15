import { createUserContent } from "@google/genai";
import { logger, prompts } from "../../utils";
import gemini, { GEMINI_MODEL } from "../../services/gemini";
import { extractJson } from "../../utils/helpers";
import Persona, { IPersona } from "../../module/database/model/persona";
import Memory from "../../module/database/model/memory";

export async function extractStoryInsights(memoryId: string, userId: string): Promise<void> {
  try {
    const memory = await Memory.findById(memoryId);
    if (!memory || memory.type !== 'story') {
      console.error(`Memory ${memoryId} not found or is not a story`);
      return;
    }

    if (!memory.body || memory.body.trim().length === 0) {
      console.error(`Story memory ${memoryId} has no body content`);
      return;
    }

    const persona = await Persona.findOne({ user: userId });
    const existingContext = persona || {} as IPersona;

    // Use the same prompt builder as conversation insights
    const prompt = prompts.buildInsightsPrompt(existingContext);

    // Format story with title and body as input text
    const storyText = memory.title
      ? `Title: ${memory.title}\n\n Content: ${memory.body}`
      : memory.body;

    const contents = createUserContent([
      prompt,
      { text: storyText }
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