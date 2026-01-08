import { createUserContent } from "@google/genai";
import { logger, prompts } from "../../utils";
import User from "../../module/database/model/user";
import gemini, { GEMINI_MODEL } from "../../services/gemini";
import { extractJson } from "../../utils/helpers";
import Persona, { IPersona } from "../../module/database/model/persona";
import { RedisConnection } from "../../services/redis";
import { Worker } from "bullmq";

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

async function extractBatchInsights(
  user_id: string,
  exchanges: Array<{ user: string; ai: string }>
): Promise<void> {
  if (!exchanges || exchanges.length === 0) return;

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

    const insights = extractJson(response.text);
    await updateUserWithInsights(user_id, insights);

    logger.debug(`Extracted insights from ${exchanges.length} exchanges for user ${user_id}`);
  } catch (error) {
    logger.error(error, 'Error extracting batch insights');
  }
}

export default function startInsightsExtractionWorker(connection: RedisConnection) {
  return new Worker(
    'insights-extraction',
    async (job) => {
      const { user_id, exchanges } = job.data;

      return await extractBatchInsights(user_id, exchanges);
    },
    {
      connection,
      concurrency: 2,
      limiter: { max: 10, duration: 60000 }
    }
  );
}