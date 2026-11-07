import gemini, {GEMINI_MODEL} from '../../../services/gemini';
import {processFiles} from '../ai/utils';
import {z} from 'zod';
import ai from '../../../services/ai';
import {ChatMessage} from '../../../services/ai/types';
import {ServiceUnavailableException} from '../../../utils/service-error';
const replySchema = z.object({
  text: z.string().trim().min(1).max(12000),
  source_ids: z.array(z.string()).max(20).default([]),
});
export async function generateConnectionReply(
  messages: ChatMessage[],
  attachments: string[] = [],
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      attachments.length
        ? (async () => {
            const parts = await processFiles(attachments);
            const result = await gemini.models.generateContent({
              model: GEMINI_MODEL,
              contents: [
                {
                  role: 'user',
                  parts: [{text: JSON.stringify(messages)}, ...parts],
                },
              ],
              config: {
                systemInstruction: messages[0].content,
                responseMimeType: 'application/json',
              },
            });
            return result.text || '';
          })()
        : ai.generateText(messages),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Generation timed out')),
          45000,
        );
      }),
    ]);
    return replySchema.parse(
      JSON.parse(
        raw
          .trim()
          .replace(/^```(?:json)?\s*/, '')
          .replace(/```$/, ''),
      ),
    );
  } catch {
    throw new ServiceUnavailableException(
      'Your connection’s Memento couldn’t respond. Please try again.',
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
