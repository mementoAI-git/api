import { createUserContent } from "@google/genai";
import { prompts } from "../../utils";
import gemini, { GEMINI_MODEL } from "../../services/gemini";
import { extractJson } from "../../utils/helpers";
import Memory from "../../module/database/model/memory";
import Message from "../../module/database/model/message";
import logger from "../../utils/logger";

export async function generateConversationSummary(memoryId: string): Promise<void> {
  try {
    const memory = await Memory.findById(memoryId);
    if (!memory) {
      logger.error(`Memory ${memoryId} not found for summarization`);
      return;
    }

    // Get all messages for this conversation
    const messages = await Message.find({ memory: memoryId })
      .sort({ created_at: 1 })
      .select('role text created_at');

    if (messages.length < 10) {
      return;
    }

    // Format messages into conversation text
    const conversationText = messages
      .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}`)
      .join('\n\n');

    const prompt = prompts.buildSummarizationPrompt();
    const contents = createUserContent([
      prompt,
      { text: conversationText }
    ]);

    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents
    });

    const result = extractJson(response.text);
    if (result) {
      await Memory.findByIdAndUpdate(memoryId, {
        summary: result?.summary || '',
        topics: result?.topics || [],
        last_summarized_at: new Date()
      });
    }

    logger.info(`Generated summary for memory ${memoryId}`);
  } catch (error) {
    logger.error(error, 'Error generating conversation summary');
  }
}