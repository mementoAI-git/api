/**
 * Checks which tools chat's chooser picks for fixed messages, against the
 * live model, so a prompt or model change cannot quietly break tool choice.
 *
 *   yarn eval:chat-tools                 # Groq (GROQ_MODEL_CHAT_TOOLS)
 *   CHOOSER=gemini yarn eval:chat-tools  # Gemini, the fallback
 *
 * Cases live in test/fixtures/chat-tool-cases.json: `expect` is the tools
 * that must be called (empty: none), `allow` extra tools that are fine.
 * Requests are spaced to stay inside Groq's tokens-per-minute limit.
 */
import {readFileSync} from 'fs';
import path from 'path';
import {FunctionCallingConfigMode} from '@google/genai';
import {chooseToolCallsWithGroq, type GroqMessage} from '../services/ai/groq';
import gemini, {GEMINI_MODEL} from '../services/gemini';
import {GROQ_MODEL_CHAT_TOOLS} from '../utils/config';
import {CHAT_ACTION_DECLARATIONS} from '../module/api/ai/chat-tools/actions';
import {CHAT_TOOL_DECLARATIONS} from '../module/api/ai/chat-tools/declarations';
import {
  chooserPrompt,
  MAX_CALLS,
} from '../module/api/ai/chat-tools/chooser-prompt';

type Case = {
  say: string;
  before?: string[];
  expect: string[];
  allow?: string[];
};

const tools = [...CHAT_TOOL_DECLARATIONS, ...CHAT_ACTION_DECLARATIONS];
const useGemini = process.env.CHOOSER === 'gemini';
const SPACING_MS = useGemini
  ? 300
  : Number(process.env.EVAL_SPACING_MS ?? 15_000);

async function choose(messages: GroqMessage[]): Promise<string[]> {
  if (!useGemini) {
    const calls = await chooseToolCallsWithGroq({
      model: GROQ_MODEL_CHAT_TOOLS,
      tools,
      messages,
      timeoutMs: 10_000,
      maxCalls: MAX_CALLS,
    });
    return calls.map(call => call.name);
  }
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: messages
      .filter(message => message.role !== 'system')
      .map(message => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{text: message.content}],
      })),
    config: {
      systemInstruction: messages[0].content,
      tools: [
        {
          functionDeclarations: tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: tool.parameters,
          })),
        },
      ],
      toolConfig: {
        functionCallingConfig: {mode: FunctionCallingConfigMode.AUTO},
      },
      temperature: 0,
      thinkingConfig: {thinkingBudget: 0},
    },
  });
  return (response.functionCalls ?? []).map(call => String(call.name));
}

export function judge(testCase: Case, picked: string[]): boolean {
  const allowed = new Set([...testCase.expect, ...(testCase.allow ?? [])]);
  return (
    testCase.expect.every(name => picked.includes(name)) &&
    picked.every(name => allowed.has(name))
  );
}

async function main() {
  const cases: Case[] = JSON.parse(
    readFileSync(
      path.join(__dirname, '../../test/fixtures/chat-tool-cases.json'),
      'utf8',
    ),
  );
  console.log(
    `Chooser: ${useGemini ? `gemini ${GEMINI_MODEL}` : `groq ${GROQ_MODEL_CHAT_TOOLS}`}, ${cases.length} cases`,
  );
  let failures = 0;
  for (const [index, testCase] of cases.entries()) {
    if (index) await new Promise(resolve => setTimeout(resolve, SPACING_MS));
    const messages: GroqMessage[] = [
      {role: 'system', content: chooserPrompt(new Date())},
      ...(testCase.before ?? []).flatMap((text): GroqMessage[] => [
        {role: 'user', content: text},
        {role: 'assistant', content: 'Okay.'},
      ]),
      {role: 'user', content: testCase.say},
    ];
    try {
      const picked = await choose(messages);
      const ok = judge(testCase, picked);
      if (!ok) failures += 1;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  "${testCase.say}" -> [${picked.join(', ')}]${ok ? '' : `  expected [${testCase.expect.join(', ')}]`}`,
      );
    } catch (error) {
      failures += 1;
      const message = String((error as Error).message).replace(/\s+/g, ' ');
      console.log(`ERROR "${testCase.say}": ${message.slice(0, 160)}`);
    }
  }
  console.log(`${cases.length - failures}/${cases.length} passed`);
  process.exitCode = failures ? 1 : 0;
}

if (require.main === module) void main();
