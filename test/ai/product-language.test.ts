import {readFileSync} from 'fs';
import * as path from 'path';
import {describe, expect, it} from 'vitest';
import {CHAT_TOOL_DECLARATIONS} from '../../src/module/api/ai/chat-tools/declarations';
import {SERVER_TOOL_DECLARATIONS} from '../../src/module/api/ai/voice/server-tool-declarations';

// Memento's product language: "connection", never "beneficiary"; "your
// Memento", never an "AI twin" or "digital twin". The AI repeats the words it
// is given, so the prompts, tool descriptions and tool results must use them.
const OLD_TERMS = /beneficiar|\btwin\b/i;

const AI_TEXT_FILES = [
  'src/utils/ai-prompt/voice.ts',
  'src/module/api/ai/chat-tools/chooser-prompt.ts',
  'src/module/api/ai/chat-tools/declarations.ts',
  'src/module/api/ai/chat-tools/tools.ts',
  'src/module/api/ai/voice/server-tool-declarations.ts',
  'src/module/api/ai/voice/content-actions.ts',
];

/**
 * Sentences in string literals. Code names (`beneficiaries`) and Mongo field
 * lists (`'groups beneficiaries visibility'`) are not prose.
 */
function proseLiterals(source: string): string[] {
  const literals = source.match(
    /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`[^`]*`/g,
  );
  return (literals ?? []).filter(
    literal => /\s/.test(literal) && !/^['"`][a-z_.\s]+['"`]$/.test(literal),
  );
}

describe('AI product language', () => {
  it('declares no tool or parameter in the old terms', () => {
    const declarations = JSON.stringify([
      ...CHAT_TOOL_DECLARATIONS,
      ...SERVER_TOOL_DECLARATIONS,
    ]);
    expect(declarations).not.toMatch(OLD_TERMS);
  });

  it.each(AI_TEXT_FILES)('keeps the old terms out of the text in %s', file => {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8');
    const offending = proseLiterals(source).filter(text =>
      OLD_TERMS.test(text),
    );
    expect(offending).toEqual([]);
  });
});
