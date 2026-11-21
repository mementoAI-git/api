import {readFileSync, readdirSync, statSync} from 'fs';
import * as path from 'path';
import ts from 'typescript';
import {describe, expect, it} from 'vitest';
import {CHAT_TOOL_DECLARATIONS} from '../../src/module/api/ai/chat-tools/declarations';
import {CALL_ACTION_DECLARATIONS} from '../../src/module/api/ai/live-session-config';
import {SERVER_TOOL_DECLARATIONS} from '../../src/module/api/ai/voice/server-tool-declarations';

// Memento's product language: "connection", never "beneficiary"; "your
// Memento", never an "AI twin" or "digital twin". The AI repeats the words it
// is given, so everything it reads (prompts, tool declarations, tool results)
// and everything it says for us must use them.
const OLD_TERMS = /beneficiar|\btwin\b/i;

const AI_SOURCE_DIRS = ['src/utils/ai-prompt', 'src/module/api/ai'];

/**
 * Screen names the clients already use as open_screen destinations. The web
 * app maps "beneficiaries" to its settings page, so the enum keeps it until
 * the clients accept a new name.
 */
const CLIENT_CODE_NAMES = ['beneficiaries'];

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'their',
  'your',
  'them',
  'they',
  'it',
  'is',
  'as',
  'to',
  'of',
  'or',
  'and',
  'with',
  'which',
  'who',
  'not',
  'yet',
  'no',
  'for',
  'on',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

/** A Mongo field list like 'groups beneficiaries visibility', not a sentence. */
function isFieldList(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return (
    words.every(word => /^[a-z_][a-z0-9_.]*$/.test(word)) &&
    !words.some(word => STOPWORDS.has(word))
  );
}

/** Every string and template literal in the file, without comments. */
function literals(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      found.push(
        [
          node.head.text,
          ...node.templateSpans.map(span => span.literal.text),
        ].join(' '),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('AI product language', () => {
  it('declares no tool or parameter in the old terms', () => {
    let declarations = JSON.stringify([
      ...CHAT_TOOL_DECLARATIONS,
      ...SERVER_TOOL_DECLARATIONS,
      ...CALL_ACTION_DECLARATIONS,
    ]);
    for (const name of CLIENT_CODE_NAMES) {
      declarations = declarations.split(JSON.stringify(name)).join('');
    }
    expect(declarations).not.toMatch(OLD_TERMS);
  });

  const files = AI_SOURCE_DIRS.flatMap(dir =>
    sourceFiles(path.join(process.cwd(), dir)),
  );

  it('covers the AI source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map(file => path.relative(process.cwd(), file)))(
    'keeps the old terms out of the text in %s',
    file => {
      const offending = literals(path.join(process.cwd(), file)).filter(
        text => /\s/.test(text) && !isFieldList(text) && OLD_TERMS.test(text),
      );
      expect(offending).toEqual([]);
    },
  );

  it('still catches lowercase sentences and template results', () => {
    expect(isFieldList('groups beneficiaries visibility')).toBe(true);
    expect(isFieldList('ask which beneficiaries to share it with.')).toBe(
      false,
    );
    expect(isFieldList('added them as a beneficiary')).toBe(false);
  });
});
