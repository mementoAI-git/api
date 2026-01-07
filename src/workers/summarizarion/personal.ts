import { createUserContent } from "@google/genai";
import gemini, { GEMINI_MODEL } from "../../services/gemini";
import Persona, { IPersona } from "../../module/database/model/persona";
import { prompts } from "../../utils";
import { queuePersonaBatchSummarization } from "../../services/queues/summarization";
import { Types } from "mongoose";
import { BatchProgressTracker, logger, extractJson } from "../../utils";

async function processSection(section: 'important_notes' | 'key_preferences', items: string[]): Promise<string[]> {
  try {
    const prompt = prompts.buildTopicSummarizationPrompt(
      items,
      section
    );

    const contents = createUserContent([
      prompt,
      { text: `Items to consolidate:\n${items.join('\n')}` }
    ]);

    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents
    });

    const result = extractJson(response.text);
    return result?.summarized_items || [];
  } catch (error) {
    logger.error(error, `Error summarizing ${section} items`);
    return [];
  }
}

export async function summarizePersona(
  persona: IPersona,
): Promise<void> {
  try {
    // Check if summarization is needed
    const needsSummarization =
      (persona.last_array_update &&
        (!persona.last_summarized_at ||
          persona.last_array_update > persona.last_summarized_at)) ||
      (!persona.last_summarized_at &&
        ((persona.important_notes && persona.important_notes.length > 0) ||
          (persona.key_preferences && persona.key_preferences.length > 0)));

    if (!needsSummarization) {
      return;
    }

    const updateData: Partial<IPersona> = {};

    // Process important_notes
    if (persona.important_notes && persona.important_notes.length > 0) {
      const summarizedItems = await processSection(
        'important_notes',
        persona.important_notes.slice(-100) // Take last 100 items
      );

      if (summarizedItems && Array.isArray(summarizedItems)) {
        updateData.important_notes = summarizedItems;
      }
    }

    if (persona.key_preferences && persona.key_preferences.length > 0) {
      const summarizedItems = await processSection(
        'key_preferences',
        persona.key_preferences.slice(-100) // Take last 100 items
      );

      if (summarizedItems && Array.isArray(summarizedItems)) {
        updateData.key_preferences = summarizedItems;
      }
    }

    // Update persona with summarized data and timestamp
    if (Object.keys(updateData).length > 0) {
      updateData.last_summarized_at = new Date();

      await Persona.findByIdAndUpdate(persona._id, updateData);

      logger.info(`Successfully summarized persona ${persona._id}`);
    } else {
      // Even if no updates, mark as summarized if arrays exist
      if ((persona.important_notes && persona.important_notes.length > 0) ||
        (persona.key_preferences && persona.key_preferences.length > 0)) {
        await Persona.findByIdAndUpdate(persona._id, {
          last_summarized_at: new Date()
        });
      }
    }
  } catch (error) {
    logger.error(error, `Error summarizing persona topics for persona ${persona._id}`);
    throw error;
  }
}

const tracker = new BatchProgressTracker('persona:summarization:', 86400);

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
        // Personas with arrays modified since last summarization
        {
          last_array_update: { $exists: true, $ne: null },
          $or: [
            { last_summarized_at: null },
            { $expr: { $gt: ['$last_array_update', '$last_summarized_at'] } }
          ]
        },
        // Personas with data but never summarized
        {
          last_summarized_at: null,
          $or: [
            { important_notes: { $exists: true, $ne: [], $not: { $size: 0 } } },
            { key_preferences: { $exists: true, $ne: [], $not: { $size: 0 } } }
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

