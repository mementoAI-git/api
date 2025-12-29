import { createUserContent } from "@google/genai";
import { buildInsightsPrompt, buildSummarizationPrompt } from "../../module/api/ai/utils/prompts";
import User from "../../module/database/model/user";
import gemini, { GEMINI_MODEL } from "../../services/gemini";
import { extractJson } from "../../utils/helpers";
import Memory from "../../module/database/model/memory";
import Message from "../../module/database/model/message";

async function updateUserWithInsights(userId: string, insights: any): Promise<void> {
  const updateData: any = {};

  if (insights.important_notes && insights.important_notes.length > 0) {
    updateData['$addToSet'] = {
      'context.important_notes': { $each: insights.important_notes }
    };
  }

  if (insights.key_preferences && insights.key_preferences.length > 0) {
    if (!updateData['$addToSet']) updateData['$addToSet'] = {};
    updateData['$addToSet']['context.key_preferences'] = { $each: insights.key_preferences };
  }

  if (insights.emotional_state_trends && insights.emotional_state_trends.length > 0) {
    if (!updateData['$addToSet']) updateData['$addToSet'] = {};
    updateData['$addToSet']['context.emotional_state_trends'] = { $each: insights.emotional_state_trends };
  }

  if (insights.goals_and_aspirations && insights.goals_and_aspirations.length > 0) {
    if (!updateData['$addToSet']) updateData['$addToSet'] = {};
    updateData['$addToSet']['context.goals_and_aspirations'] = { $each: insights.goals_and_aspirations };
  }

  if (Object.keys(updateData).length > 0) {
    await User.findByIdAndUpdate(userId, updateData);
  }
}

export async function extractBatchInsights(
  user_id: string,
  exchanges: Array<{ user: string; ai: string }>
): Promise<void> {
  if (!exchanges || exchanges.length === 0) return;

  try {
    const user = await User.findById(user_id);
    if (!user) return;

    const existingContext = user.context || {};
    const prompt = buildInsightsPrompt(existingContext);

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

    const insights = extractJson(response.text);
    await updateUserWithInsights(user_id, insights);

    console.log(`Extracted insights from ${exchanges.length} exchanges for user ${user_id}`);
  } catch (error) {
    console.error('Error extracting batch insights:', error);
  }
}

export async function generateConversationSummary(memoryId: string): Promise<void> {
  try {
    const memory = await Memory.findById(memoryId);
    if (!memory) {
      console.error(`Memory ${memoryId} not found for summarization`);
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

    const prompt = buildSummarizationPrompt();
    const contents = createUserContent([
      prompt,
      { text: conversationText }
    ]);

    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents
    });

    const result = extractJson(response.text);

    // Update memory with summary
    await Memory.findByIdAndUpdate(memoryId, {
      summary: result.summary || '',
      topics: result.topics || [],
      last_summarized_at: new Date()
    });

    console.log(`Generated summary for memory ${memoryId}`);
  } catch (error) {
    console.error('Error generating conversation summary:', error);
  }
}