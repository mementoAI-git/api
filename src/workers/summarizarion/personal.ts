import ai from "../../services/ai";
import Persona, { IPersona } from "../../module/database/model/persona";
import { prompts } from "../../utils";
import { queuePersonaBatchSummarization } from "../../services/queues/summarization";
import { Types } from "mongoose";
import { BatchProgressTracker, logger, extractJson } from "../../utils";

type SummarizableField = 'important_notes' | 'key_preferences' | 'goals_and_aspirations';

async function processSection(section: SummarizableField, items: string[]): Promise<string[]> {
  try {
    const prompt = prompts.buildTopicSummarizationPrompt(
      items,
      section
    );

    const response = await ai.generateText([
      { role: "user", content: `${prompt}\n\nItems to consolidate:\n${items.join('\n')}` }
    ]);

    const result = extractJson(response);
    return result?.summarized_items || [];
  } catch (error) {
    logger.error(error, `Error summarizing ${section} items`);
    return [];
  }
}

function shouldSummarizeField(field: SummarizableField, persona: IPersona): boolean {
  const fieldArray = persona[field];
  if (!fieldArray || fieldArray.length === 0) {
    return false;
  }

  const lastUpdate = persona.last_update?.[field];
  const lastSummarized = persona.last_summarized?.[field];

  // If never updated, don't summarize
  if (!lastUpdate) {
    return false;
  }

  // If never summarized, or last update is after last summarization, needs summarization
  return !lastSummarized || lastUpdate > lastSummarized;
}

export async function summarizePersona(
  persona: IPersona,
): Promise<void> {
  try {
    const updateData: Partial<IPersona> = {};
    const now = new Date();
    const fieldsToProcess: SummarizableField[] = [
      'important_notes',
      'key_preferences',
      'goals_and_aspirations'
    ];
    let hasUpdates = false;

    // Process each field only if it needs summarization
    for (const field of fieldsToProcess) {
      if (shouldSummarizeField(field, persona)) {
        const fieldArray = persona[field];
        if (fieldArray && fieldArray.length > 0) {
          const summarizedItems = await processSection(
            field,
            fieldArray.slice(-100) // Take last 100 items
          );

          if (summarizedItems && Array.isArray(summarizedItems)) {
            updateData[field] = summarizedItems;
            updateData.last_summarized[field] = now;
            hasUpdates = true;
          }
        }
      }
    }

    // Update persona with summarized data and per-field timestamps
    if (hasUpdates) {
      updateData.last_summarized_at = now; // Keep for backward compatibility

      await Persona.findByIdAndUpdate(persona._id, updateData);

      logger.info(`Successfully summarized persona ${persona._id}`);
    }
  } catch (error) {
    logger.error(error, `Error summarizing persona topics for persona ${persona._id}`);
    throw error;
  }
}

const tracker = new BatchProgressTracker({
  redisKey: 'persona:summarization:',
  ttl: 86400
});

export async function summarizeAllPersonas(
  cursor?: string,
  batchSize: number = 50,
  batchNumber: number = 1
): Promise<void> {
  try {
    if (batchNumber === 1 && !cursor) {
      if (await tracker.isRunning(2)) return;
      await tracker.initialize();
    }

    const query: any = {
      $or: [
        // Personas with fields that have updates but no summarization timestamp
        {
          $or: [
            {
              'last_update.important_notes': { $exists: true, $ne: null },
              $or: [
                { 'last_summarized.important_notes': { $exists: false } },
                { 'last_summarized.important_notes': null },
                { $expr: { $gt: ['$last_update.important_notes', '$last_summarized.important_notes'] } }
              ]
            },
            {
              'last_update.key_preferences': { $exists: true, $ne: null },
              $or: [
                { 'last_summarized.key_preferences': { $exists: false } },
                { 'last_summarized.key_preferences': null },
                { $expr: { $gt: ['$last_update.key_preferences', '$last_summarized.key_preferences'] } }
              ]
            },
            {
              'last_update.goals_and_aspirations': { $exists: true, $ne: null },
              $or: [
                { 'last_summarized.goals_and_aspirations': { $exists: false } },
                { 'last_summarized.goals_and_aspirations': null },
                { $expr: { $gt: ['$last_update.goals_and_aspirations', '$last_summarized.goals_and_aspirations'] } }
              ]
            }
          ]
        },
        // Fallback: Personas with data but never summarized (backward compatibility)
        {
          last_summarized_at: null,
          $or: [
            { important_notes: { $exists: true, $ne: [], $not: { $size: 0 } } },
            { key_preferences: { $exists: true, $ne: [], $not: { $size: 0 } } },
            { goals_and_aspirations: { $exists: true, $ne: [], $not: { $size: 0 } } }
          ]
        }
      ]
    };

    if (cursor && Types.ObjectId.isValid(cursor)) {
      query._id = { $gt: new Types.ObjectId(cursor) };
    }

    const personas = await Persona.find(query)
      .sort({ _id: 1 })
      .limit(batchSize + 1);

    const hasMore = personas.length > batchSize;
    const batchToProcess = hasMore ? personas.slice(0, batchSize) : personas;

    let processedCount = 0;
    let lastProcessedId: string | null = null;

    // Process each persona in the batch
    for (const persona of batchToProcess) {
      try {
        await summarizePersona(persona);
        processedCount++;
        lastProcessedId = persona._id?.toString() || null;
      } catch (error) {
        logger.error(error, `Error processing persona ${persona._id}, continuing with next`);
      }
    }

    // Update Redis state
    await tracker.updateProgress(lastProcessedId, processedCount, batchNumber);

    // Queue next batch if more personas exist
    if (hasMore && lastProcessedId) {
      await queuePersonaBatchSummarization(lastProcessedId, batchSize, batchNumber + 1);
    } else {
      await tracker.markCompleted();
      logger.info('Persona summarization completed. All batches processed.');
    }
  } catch (error) {
    logger.error(error, 'Error processing persona batch summarization');
    await tracker.markFailed();
    throw error;
  }
}

