import {logger, prompts} from '../../utils';
import ai from '../../services/ai';
import {extractJson} from '../../utils/helpers';
import Persona, {IPersona} from '../../module/database/model/persona';

export async function extractBatchInsights(
  user_id: string,
  exchanges: Array<{user: string; ai: string}>,
): Promise<Record<string, unknown> | undefined> {
  if (!exchanges || exchanges.length === 0) return undefined;

  try {
    const persona = await Persona.findOne({user: user_id});
    const prompt = prompts.buildInsightsPrompt(persona || ({} as IPersona));

    const conversationText = exchanges
      .map(
        (ex, i) => `--- Exchange ${i + 1} ---\nUser: ${ex.user}\nAI: ${ex.ai}`,
      )
      .join('\n\n');

    const response = await ai.generateText([
      {role: 'user', content: `${prompt}\n\n${conversationText}`},
    ]);

    const insights = extractJson(response);

    return insights;
  } catch (error) {
    logger.error(error, 'Error extracting batch insights');
    return undefined;
  }
}

export async function extractOpenThreads(
  user_id: string,
  exchanges: Array<{user: string; ai: string}>,
): Promise<string[] | undefined> {
  if (!exchanges || exchanges.length === 0) return undefined;

  try {
    const persona = await Persona.findOne({user: user_id});
    const currentThreads = (persona?.open_threads as string[]) || [];

    const prompt = prompts.buildOpenThreadsPrompt(currentThreads);

    const conversationText = exchanges
      .map(
        (ex, i) => `--- Exchange ${i + 1} ---\nUser: ${ex.user}\nAI: ${ex.ai}`,
      )
      .join('\n\n');

    const response = await ai.generateText([
      {role: 'user', content: `${prompt}\n\n${conversationText}`},
    ]);

    const parsed = extractJson(response);
    return Array.isArray(parsed?.open_threads)
      ? parsed.open_threads
          .filter((t: any) => typeof t === 'string')
          .slice(0, 8)
      : undefined;
  } catch (error) {
    logger.error(error, 'Error extracting open threads');
    return undefined;
  }
}

export async function extractConversationDimensions(
  exchanges: Array<{user: string; ai: string}>,
): Promise<string[] | undefined> {
  if (!exchanges || exchanges.length === 0) return undefined;

  try {
    const prompt = prompts.buildDimensionTaggingPrompt();

    const conversationText = exchanges
      .map(
        (ex, i) => `--- Exchange ${i + 1} ---\nUser: ${ex.user}\nAI: ${ex.ai}`,
      )
      .join('\n\n');

    const response = await ai.generateText([
      {role: 'user', content: `${prompt}\n\n${conversationText}`},
    ]);

    const parsed = extractJson(response);
    return Array.isArray(parsed?.dimensions)
      ? parsed.dimensions.filter((t: any) => typeof t === 'string').slice(0, 3)
      : undefined;
  } catch (error) {
    logger.error(error, 'Error extracting conversation dimensions');
    return undefined;
  }
}
