/**
 * Live check of how Memento's voice model handles memory questions, using
 * the exact production voice prompt and tools with made-up context (no user
 * data). Each question opens a real Gemini Live session, so it is never run
 * in CI: run it by hand before and after changing voice prompts or tools.
 *
 *   npm run voice:memory-probe
 *   GEMINI_LIVE_MODEL_VERSION=gemini-3.8-live npm run voice:memory-probe
 *
 * Needs GEMINI_API_KEY. Prints one line per question and a pass count; exits
 * non-zero when any expectation fails. Model output varies, so run it more
 * than once before trusting a single pass or failure.
 */
import 'dotenv/config';
import {GoogleGenAI, LiveServerMessage, Session} from '@google/genai';
import {buildLiveConnectConfig} from '../module/api/ai/live-session-config';
import {buildVoiceSystemInstruction} from '../utils/ai-prompt/voice';

const MODEL = process.env.GEMINI_LIVE_MODEL_VERSION || 'gemini-3.8-live';
const TURN_TIMEOUT_MS = 25_000;

const CONTEXT = [
  'You are Memento, a personal companion for Ada.',
  'DYNAMIC PRIVATE CONTEXT',
  'Past conversations: Ada talked about starting a pottery class in September.',
].join('\n');

/** What the search tool returns for every query in this probe. */
const SEARCH_RESULT =
  'Matching memories (dates are when each was saved, not when it happened):\n' +
  "- Grandma Ngozi's kitchen (saved March 2025)\n" +
  '  In their words: "the smell of her pepper soup on Sundays in Enugu"';

type Expectation = {
  question: string;
  /** Must call search_memories. */
  search?: boolean;
  /** Must mention one of these once answered. */
  mentions?: RegExp;
};

const EXPECTATIONS: Expectation[] = [
  {question: 'Do you have access to my memories?'},
  {question: 'Can you see my stories?'},
  {question: 'Do you remember me?'},
  {question: 'What do you remember about me?', search: true},
  {
    question: 'What do you know about my family?',
    search: true,
    mentions: /ngozi|grand/i,
  },
  {
    question: 'What do you remember about my grandmother?',
    search: true,
    mentions: /ngozi|pepper soup|enugu/i,
  },
  {
    question: "Tell me about my grandmother's kitchen.",
    search: true,
    mentions: /pepper soup|enugu|ngozi/i,
  },
  {question: 'Remember the pottery class I mentioned?', mentions: /pottery/i},
];

/** Phrases Memento must never say. */
const FORBIDDEN = [
  /(don't|do not|can't|cannot|can not) (have )?(direct )?(access|see|browse|remember)/i,
  /\b(search(ing)?|look(ing)? (it |that )?up|pull(ing)? up|check(ing)? (my|our|the) (records|notes|chats|data))\b/i,
  /\b(database|stored data|records)\b/i,
];

type Outcome = {
  question: string;
  searches: string[];
  said: string;
  problems: string[];
};

async function ask(
  ai: GoogleGenAI,
  expectation: Expectation,
): Promise<Outcome> {
  const system = buildVoiceSystemInstruction(CONTEXT, {
    memoryTool: true,
    callActions: true,
  });
  const config = buildLiveConnectConfig('Aoede', system, undefined, {
    memoryTool: true,
    callActions: true,
  });
  const searches: string[] = [];
  let said = '';
  let resultSent = false;
  let saidAfterResult = '';
  let session: Session | undefined;

  await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, TURN_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    ai.live
      .connect({
        model: MODEL,
        config,
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (message.setupComplete) {
              // setupComplete can arrive before connect() resolves.
              setTimeout(() =>
                session?.sendClientContent({
                  turns: [
                    {role: 'user', parts: [{text: expectation.question}]},
                  ],
                  turnComplete: true,
                }),
              );
            }
            for (const call of message.toolCall?.functionCalls ?? []) {
              searches.push(
                String((call.args as {query?: string})?.query ?? call.name),
              );
              session?.sendToolResponse({
                functionResponses: [
                  {
                    id: call.id,
                    name: call.name,
                    response: {result: SEARCH_RESULT},
                  },
                ],
              });
              resultSent = true;
            }
            const text = message.serverContent?.outputTranscription?.text;
            if (text) {
              said += text;
              if (resultSent) saidAfterResult += text;
            }
            const done =
              message.serverContent?.turnComplete &&
              (searches.length === 0 || saidAfterResult.trim().length > 0);
            if (done) finish();
          },
          onerror: () => finish(),
          onclose: () => finish(),
        },
      })
      .then(connected => {
        session = connected;
      })
      .catch(error => {
        said += ` [connect failed: ${error instanceof Error ? error.message : error}]`;
        finish();
      });
  });
  session?.close();

  const problems: string[] = [];
  if (expectation.search && searches.length === 0)
    problems.push('did not search');
  if (searches.length && !saidAfterResult.trim())
    problems.push('said nothing after the search result');
  if (expectation.mentions && !expectation.mentions.test(said))
    problems.push(`never mentioned ${expectation.mentions}`);
  for (const pattern of FORBIDDEN) {
    if (pattern.test(said)) problems.push(`said ${pattern}`);
  }
  return {
    question: expectation.question,
    searches,
    said: said.trim(),
    problems,
  };
}

async function main() {
  if (!process.env.GEMINI_API_KEY)
    throw new Error('GEMINI_API_KEY is not set.');
  const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
  console.log(`Model: ${MODEL}`);
  let passed = 0;
  for (const expectation of EXPECTATIONS) {
    const outcome = await ask(ai, expectation);
    if (!outcome.problems.length) passed += 1;
    console.log(
      JSON.stringify({
        ok: outcome.problems.length === 0,
        question: outcome.question,
        searches: outcome.searches,
        said: outcome.said,
        problems: outcome.problems,
      }),
    );
  }
  console.log(`Passed ${passed}/${EXPECTATIONS.length}`);
  process.exitCode = passed === EXPECTATIONS.length ? 0 : 1;
}

void main();
