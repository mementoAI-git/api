import Memory from '../../database/model/memory';

export type ReplyCountPrompt = {prompt_id: string} | {prompt_text: string};

/** AI slots have no catalog id; match the complete question, ignoring casing/spacing. */
export function aiPromptReplyPattern(text: string): RegExp {
  const escapedWords = text
    .trim()
    .split(/\s+/)
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^\\s*${escapedWords.join('\\s+')}\\s*$`, 'i');
}

/** Count respondents, rather than memories, across all reflection dates. */
export async function getPromptReplyUserCount(
  prompt: ReplyCountPrompt,
): Promise<number> {
  const identity =
    'prompt_id' in prompt ? prompt.prompt_id : prompt.prompt_text;
  if (!identity.trim()) return 0;
  const promptScope =
    'prompt_id' in prompt
      ? {prompt: prompt.prompt_id}
      : {
          prompt_type: 'ai-generated',
          prompt_text: aiPromptReplyPattern(prompt.prompt_text),
        };
  const [result] = await Memory.aggregate<{count: number}>([
    {
      $match: {
        ...promptScope,
        status: {$nin: ['draft', 'deleted']},
        user: {$type: 'string', $ne: ''},
      },
    },
    {$group: {_id: '$user'}},
    {$count: 'count'},
  ]);
  return result?.count ?? 0;
}
