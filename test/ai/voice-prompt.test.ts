import {describe, expect, it} from 'vitest';
import {
  buildVoiceGreetingInstruction,
  buildVoiceModeSection,
  buildVoiceSystemInstruction,
} from '../../src/utils/ai-prompt/voice';

describe('voice prompt', () => {
  it('voice section covers brevity, interruptions, re-greeting and mishearing', () => {
    const section = buildVoiceModeSection();
    expect(section).toContain('VOICE MODE');
    expect(section).toMatch(/one to three short sentences/i);
    expect(section).toMatch(/interrupt/i);
    expect(section).toMatch(/Greet only once/i);
    expect(section).toMatch(/unclear/i);
    expect(section).toMatch(/this section wins/i);
  });

  it('places conversation turns before the voice section, which comes last', () => {
    const result = buildVoiceSystemInstruction('BASE CONTEXT', {
      recentTranscript: 'Host: hi\nMemento: hey',
      reflectionTopic: 'My first job',
      memoryNotes: 'It was at a bakery.',
    });
    const baseAt = result.indexOf('BASE CONTEXT');
    const reflectionAt = result.indexOf('My first job');
    const transcriptAt = result.indexOf('Host: hi');
    const voiceAt = result.indexOf('VOICE MODE');
    expect(baseAt).toBe(0);
    expect(reflectionAt).toBeGreaterThan(baseAt);
    expect(transcriptAt).toBeGreaterThan(reflectionAt);
    expect(voiceAt).toBeGreaterThan(transcriptAt);
    expect(result).toContain('It was at a bakery.');
  });

  it('omits empty optional blocks', () => {
    const result = buildVoiceSystemInstruction('BASE', {
      recentTranscript: '  ',
    });
    expect(result).not.toContain('THIS CONVERSATION SO FAR');
    expect(result).not.toContain('CURRENT REFLECTION');
  });

  it('greeting adapts to reflection, history, and first contact', () => {
    expect(
      buildVoiceGreetingInstruction({
        name: 'Sam',
        hasRecentTurns: false,
        reflectionTopic: 'Grandma',
      }),
    ).toContain('"Grandma"');
    expect(
      buildVoiceGreetingInstruction({name: 'Sam', hasRecentTurns: true}),
    ).toMatch(/without recapping/i);
    const first = buildVoiceGreetingInstruction({hasRecentTurns: false});
    expect(first).toMatch(/^Greet the host/);
    expect(first).toMatch(/one short/i);
  });

  it('adds memory tool guidance only when the tool is enabled', () => {
    expect(buildVoiceModeSection()).not.toContain('search_memories');
    expect(buildVoiceModeSection({memoryTool: true})).toContain(
      'call search_memories',
    );
    expect(buildVoiceSystemInstruction('BASE', {memoryTool: true})).toContain(
      'call search_memories',
    );
  });

  it('adds call action guidance only when call actions are enabled', () => {
    expect(buildVoiceModeSection()).not.toContain('CALL ACTIONS');
    const section = buildVoiceModeSection({callActions: true});
    expect(section).toContain('CALL ACTIONS');
    expect(section).toContain('call end_call');
    expect(section).toContain('set_microphone');
    expect(section).toMatch(/keep talking while they look or wrap up/);
    expect(buildVoiceSystemInstruction('BASE', {callActions: true})).toContain(
      'CALL ACTIONS',
    );
  });
});
