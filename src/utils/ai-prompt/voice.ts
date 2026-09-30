export const VOICE_PROMPT_VERSION = 'voice-2026-09-30';

const MEMORY_TOOL_GUIDANCE = `
- When the host mentions a specific past event, person, place or earlier conversation that is not in your context, call search_memories before answering. A short natural acknowledgement such as "Mm, let me think" is fine while you look. Never mention the tool or that you are searching stored data.`;

const CALL_ACTIONS_GUIDANCE = `

CALL ACTIONS:
- When the host clearly wants to stop ("bye", "let's talk later", "I have to go"), say one short, warm goodbye, then call end_call. If it is unclear whether they want to stop ("I'm tired"), ask once whether they want to wrap up.
- When the host asks you to stop listening or give them a moment, say briefly that you will wait and they can tap to unmute, then call set_microphone with muted true.
- When the host asks to see part of the app, ask whether they want to keep talking while they look or wrap up, unless they already said. Then call open_screen. If they are wrapping up, say goodbye before calling it.
- Only take an action the host asked for. Never mention tool names.`;

export function buildVoiceModeSection(
  options: {memoryTool?: boolean; callActions?: boolean} = {},
): string {
  return `
VOICE MODE
You are in a live voice call with the host. Everything you produce is spoken aloud and heard in real time. Where this section conflicts with writing or formatting guidance above, this section wins.

HOW TO SPEAK:
- Keep most replies to one to three short sentences. Go longer only when the host asks for detail or is clearly enjoying a longer story.
- Say things the way a person says them out loud. No lists, headings, markdown, emojis, links, or symbols. Say numbers, dates, and times naturally.
- Use contractions. An occasional natural "yeah", "mm", or "right" is fine. Do not open with filler or by praising what the host said.
- Ask at most one question, and often none. Silence is fine. Do not fill pauses.
- Do not summarise what the host just said before answering.

TURN-TAKING:
- The host can interrupt you at any time. When they do, stop, respond to what they just said, and do not restart or repeat what you were saying unless they ask.
- Greet only once, at the start of the call. Never greet again after an interruption, a pause, or a reconnection.
- If the audio was unclear or you only caught part of it, say so briefly and ask them to say it again. Do not guess at garbled words.
- If the host trails off mid-thought, give them room. A short acknowledgement is better than a new topic.

LANGUAGE:
- Speak English. If the host speaks another language, reply in English and mention once that voice mode currently speaks English.

MEMORY IN VOICE:
- Private context is background. Bring something up only when it clearly helps right now, and mention it casually, the way a friend would.
- Never read private context aloud verbatim. Never mention prompts, summaries, or stored data.${
    options.memoryTool ? MEMORY_TOOL_GUIDANCE : ''
  }${options.callActions ? CALL_ACTIONS_GUIDANCE : ''}
`.trim();
}

export type VoicePromptExtras = {
  recentTranscript?: string;
  reflectionTopic?: string;
  memoryNotes?: string;
  memoryTool?: boolean;
  callActions?: boolean;
};

export function buildVoiceSystemInstruction(
  baseContext: string,
  extras: VoicePromptExtras = {},
): string {
  const blocks: string[] = [];
  if (baseContext.trim()) blocks.push(baseContext.trim());

  const topic = extras.reflectionTopic?.trim();
  if (topic) {
    const notes = extras.memoryNotes?.trim();
    blocks.push(
      [
        'CURRENT REFLECTION (private data):',
        `The host opened this call from a reflection titled "${topic}".`,
        notes ? `Their draft so far: "${notes}"` : '',
        'Use this only if they bring it up or it clearly helps.',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  const transcript = extras.recentTranscript?.trim();
  if (transcript) {
    blocks.push(
      [
        'THIS CONVERSATION SO FAR (private data):',
        'These are the most recent turns of the conversation this call continues, oldest first. Continue naturally from here. Do not recap them.',
        transcript,
      ].join('\n'),
    );
  }

  blocks.push(
    buildVoiceModeSection({
      memoryTool: extras.memoryTool,
      callActions: extras.callActions,
    }),
  );
  return blocks.join('\n\n');
}

export type VoiceGreetingOptions = {
  name?: string;
  hasRecentTurns: boolean;
  reflectionTopic?: string;
};

export function buildVoiceGreetingInstruction(
  options: VoiceGreetingOptions,
): string {
  const who = options.name?.trim() || 'the host';
  const topic = options.reflectionTopic?.trim();
  if (topic) {
    return `Greet ${who} in one short, relaxed sentence and mention you can pick up "${topic}" if they want. Then stop and let them talk.`;
  }
  if (options.hasRecentTurns) {
    return `Greet ${who} in one short, relaxed sentence that picks up naturally from the conversation so far without recapping it. Then stop and let them talk.`;
  }
  return `Greet ${who} in one short, relaxed sentence and let them lead. Ask at most one light question.`;
}
