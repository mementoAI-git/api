import ai from '../../services/ai';
import {createUserContent} from '@google/genai';
import {logger, prompts, EXCLUDED_STORAGE_PROVIDER} from '../../utils';
import gemini, {GEMINI_MODEL} from '../../services/gemini';
import {extractJson} from '../../utils/helpers';
import Persona, {IPersona} from '../../module/database/model/persona';
import Memory from '../../module/database/model/memory';
import {saveConfirmedSocialAccounts} from './social-accounts';
import {buildMemoryContent} from '../../module/api/ai/utils';

export async function extractStoryInsights(
  memoryId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const memory = await Memory.findOne({_id: memoryId, user: userId}).populate(
      {
        path: 'attachments',
        match: {provider: {$ne: EXCLUDED_STORAGE_PROVIDER}},
      },
    );
    if (!memory) return null;
    const {text, processedImages} = await buildMemoryContent(memory);

    const persona = await Persona.findOne({user: userId});
    const existingContext = persona || ({} as IPersona);

    const prompt = prompts.buildInsightsPrompt(existingContext);

    const textMessages = [
      {role: 'user' as const, content: `${prompt}\n\n${text}`},
    ];
    let responseText: string;
    if (processedImages.length) {
      try {
        const response = await gemini.models.generateContent({
          model: GEMINI_MODEL,
          contents: createUserContent([prompt, {text}, ...processedImages]),
        });
        responseText = response.text || '';
      } catch {
        // Text-backed ownership remains usable if the image provider is unavailable.
        responseText = await ai.generateText(textMessages);
      }
    } else {
      responseText = await ai.generateText(textMessages);
    }

    const insights = extractJson(responseText);
    if (insights && typeof insights === 'object') {
      const ownershipText = [
        memory.body?.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '),
        ...memory.attachments.map(file =>
          typeof file !== 'string' ? file.transcription?.full_text : '',
        ),
      ]
        .filter(Boolean)
        .join('\n\n');
      await saveConfirmedSocialAccounts(
        userId,
        memoryId,
        insights.social_accounts,
        ownershipText,
      );
    }
    return insights;
  } catch (error) {
    logger.error(error, 'Error extracting story insights');
    return null;
  }
}
