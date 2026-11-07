import {readFileSync} from 'fs';
import path from 'path';
import {describe, expect, it} from 'vitest';
import {CHAT_ACTION_NAMES} from '../../src/module/api/ai/chat-tools/actions';
import {CHAT_TOOL_DECLARATIONS} from '../../src/module/api/ai/chat-tools/declarations';
import {judge} from '../../src/scripts/eval-chat-tools';

const cases: {say: string; expect: string[]; allow?: string[]}[] = JSON.parse(
  readFileSync(
    path.join(__dirname, '../fixtures/chat-tool-cases.json'),
    'utf8',
  ),
);
const tools = new Set<string>([
  ...CHAT_TOOL_DECLARATIONS.map(tool => tool.name),
  ...CHAT_ACTION_NAMES,
]);

describe('tool-choice cases (run live with yarn eval:chat-tools)', () => {
  it('only name tools chat has', () => {
    for (const testCase of cases) {
      for (const name of [...testCase.expect, ...(testCase.allow ?? [])]) {
        expect(tools.has(name), `${testCase.say}: ${name}`).toBe(true);
      }
    }
  });

  it('include messages that must not use any tool', () => {
    expect(
      cases.filter(testCase => !testCase.expect.length).length,
    ).toBeGreaterThan(3);
  });

  it('judge strictly: expected tools present, nothing unexpected', () => {
    expect(judge({say: '', expect: ['list_people']}, ['list_people'])).toBe(
      true,
    );
    expect(judge({say: '', expect: ['list_people']}, [])).toBe(false);
    expect(judge({say: '', expect: []}, ['delete_story'])).toBe(false);
    expect(
      judge({say: '', expect: [], allow: ['search_memories']}, [
        'search_memories',
      ]),
    ).toBe(true);
  });
});
