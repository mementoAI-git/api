import { RedisConnection } from "../../services/redis";
import { Worker } from "bullmq";
import { extractBatchInsights } from "./persona";
import { extractStoryInsights } from "./story";
import { PERSONA_INSIGHT_FIELDS } from "../../utils";
import Persona from "../../module/database/model/persona";

async function updatePersonaInsights(insights: any, userId: string) {
  const updateData: any = {};
  const now = new Date();

  const fieldsUpdated: string[] = [];

  PERSONA_INSIGHT_FIELDS.forEach(field => {
    if (insights?.[field] && insights?.[field].length > 0) {
      updateData['$addToSet'] = {
        [field]: { $each: insights[field] }
      };
      fieldsUpdated.push(field);
    }
  })

  if (Object.keys(updateData).length > 0) {
    if (!updateData['$set']) updateData['$set'] = {};

    // Set per-field update timestamps
    if (fieldsUpdated.length > 0) {
      updateData['$set'].last_array_update = now;

      fieldsUpdated.forEach(field => {
        updateData['$set'][`last_update.${field}`] = now;
      });
    }

    await Persona.findOneAndUpdate(
      { user: userId },
      updateData,
      { upsert: true, new: true }
    );
  }
}

export default function startInsightsExtractionWorker(connection: RedisConnection) {
  return new Worker(
    'insights-extraction',
    async (job) => {
      const { user_id, memory_id, exchanges } = job.data;

      let insights: any = null;

      if (memory_id && (!exchanges || exchanges.length === 0)) {
        insights = await extractStoryInsights(memory_id, user_id);
      } else {
        insights = await extractBatchInsights(user_id, exchanges);
      }

      if (insights) {
        await updatePersonaInsights(insights, user_id);
      }
      return;
    },
    {
      connection,
      concurrency: 2,
      limiter: { max: 10, duration: 60000 }
    }
  );
}