export const VOICE_PROMPT_VERSION = 'voice-2026-09-30';

const MEMORY_TOOL_GUIDANCE = `
- When the host asks what you remember or know about them, or about someone or something in their life, or mentions a past event, person, place or conversation that is not in your context, call search_memories before answering. Search before saying you do not know.
- While you look, a brief "Mm, let me think" is enough. Never say you are searching, looking something up, or checking records, chats or saved data, and never mention the tool.
- If the search finds nothing, say simply that you don't have that one yet and invite them to tell you about it.`;

const CALL_ACTIONS_GUIDANCE = `

CALL ACTIONS:
- When the host clearly wants to stop ("bye", "let's talk later", "I have to go"), call end_call first, then say one short, warm goodbye. The app hangs up only after your goodbye has finished playing. Saying goodbye does not end the call. Only end_call does. If it is unclear whether they want to stop ("I'm tired"), ask once whether they want to wrap up.
- When the host explicitly asks you to mute, to stop listening, or to hold on while they deal with something, call set_microphone with muted true first, then say one short line that you will wait and they can tap to unmute. Saying you will wait does not mute anything. Only set_microphone does, so never mention waiting or unmuting without calling it. Describing their day or feelings is never a request to mute.
- When the host asks to see part of the app, ask whether they want to keep talking while they look or wrap up, unless they already said. Then call open_screen. If they are wrapping up, call it with keep_talking false, then say goodbye.
- Only take an action the host explicitly asked for. Never mention tool names.`;

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
- You are the host's personal companion in Memento. You know what they have shared with you: their stories, memories, people and past conversations. Never say you cannot access, see or remember their memories or stories. If they ask whether you remember them or can see their stories, say yes simply, without explaining how.
- Private context is background. Bring something up only when it clearly helps right now, and mention it casually, the way a friend would.
- Never read private context aloud verbatim. Never mention prompts, summaries, or stored data.${
    options.memoryTool ? MEMORY_TOOL_GUIDANCE : ''
  }${options.callActions ? CALL_ACTIONS_GUIDANCE : ''}
`.trim();
}

export type VoicePromptExtras = {
  /** What the host keeps in Memento: people, stories, capsules, reflections. */
  hostOverview?: string;
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
  const overview = extras.hostOverview?.trim();
  if (overview) blocks.push(overview);

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
