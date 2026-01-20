import { createUserContent } from "@google/genai";
import Memory from "../../module/database/model/memory";
import { extractJson, logger, prompts } from "../../utils";
import { buildMemoryContent } from "../../module/api/ai/utils";
import gemini, { GEMINI_MODEL } from "../../services/gemini";

export default async function summarizeStory(memoryId: string): Promise<void> {
  try {
    const memory = await Memory.findById(memoryId).populate('attachments');
    const { text, processedImages, hasAttachments, hasTranscription } = await buildMemoryContent(memory);

    const prompt = prompts.buildSummarizationPrompt(
      hasAttachments,
      hasTranscription,
    );

    const contents = createUserContent([
      prompt,
      { text },
      ...processedImages
    ]);

    const summaryResponse = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents
    });

    let summaryData = extractJson(summaryResponse.text);
    if (summaryData) {
      await Memory.findByIdAndUpdate(memoryId, {
        summary: summaryData?.summary,
        topics: summaryData?.topics || [],
        last_summarized_at: new Date()
      });
    }

    return summaryData;
  } catch (error) {
    logger.error(error, 'Error summarizing story');
  }
}