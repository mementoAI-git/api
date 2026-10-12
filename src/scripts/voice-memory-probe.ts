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
import {
  FunctionResponseScheduling,
  GoogleGenAI,
  LiveServerMessage,
  Session,
} from '@google/genai';
import {buildLiveConnectConfig} from '../module/api/ai/live-session-config';
import {buildVoiceSystemInstruction} from '../utils/ai-prompt/voice';
import {describeHostNow} from '../module/api/ai/voice/local-time';

const MODEL = process.env.GEMINI_LIVE_MODEL_VERSION || 'gemini-3.8-live';
const TURN_TIMEOUT_MS = 25_000;

const CONTEXT = [
  'You are Memento, a personal companion for Ada.',
  'DYNAMIC PRIVATE CONTEXT',
  'Past conversations: Ada talked about starting a pottery class in September.',
].join('\n');

const HOST_OVERVIEW = [
  'ABOUT THE HOST (private data, what they keep in Memento):',
  'People in their life: Emeka (brother), Ada (daughter), Funmi (best friend).',
  'Stories: 42 saved. Most recent: "First day at Shell", "Grandma\'s kitchen".',
  'Time capsules: 1 scheduled, 2 draft. Next due: "For Ada at 18" on 12 March 2031.',
].join('\n');

/** What each tool returns in this probe (search_memories below). */
const ACTION_RESULTS: Record<string, string> = {
  update_profile:
    'Done: changed their nickname from "Saviour" to "Yo". Their profile is now on screen. Tell them briefly and offer to change it back.',
  scroll: 'Scrolled down.',
  go_back: 'Went back.',
  press_button: 'Pressed "Save".',
  open_story:
    'Opened their story "Trip to Lagos" on screen. Say so in a few words.',
};

/** What the search tool returns for every query in this probe. */
const SEARCH_RESULT =
  'Matching memories (dates are when each was saved, not when it happened):\n' +
  "- Grandma Ngozi's kitchen (saved March 2025)\n" +
  '  In their words: "the smell of her pepper soup on Sundays in Enugu"';

/** Confirmed actions: the code the probe's read-back hands out. */
const PROBE_CODE = 'PROBE234';
const CONFIRMED_TOOLS = new Set([
  'add_beneficiary',
  'schedule_capsule',
  'delete_story',
  'send_feedback',
]);

/** What a tool returns in this probe, mimicking the real two-step confirmation. */
function toolResult(name: string, args: Record<string, unknown>): string {
  if (name === 'search_memories') return SEARCH_RESULT;
  if (CONFIRMED_TOOLS.has(name)) {
    if (!args.confirmation) {
      return `Nothing has happened yet. ${name} with ${JSON.stringify(args)}. Read this back to the host and ask them to confirm. Only if they clearly say yes, call ${name} again with exactly the same details and confirmation "${PROBE_CODE}".`;
    }
    return String(args.confirmation).toUpperCase() === PROBE_CODE
      ? `Done: ${name} completed. Tell them in a few words.`
      : 'Nothing happened: that confirmation code is not valid.';
  }
  return (
    ACTION_RESULTS[name] ?? `Done: ${name} completed. Tell them in a few words.`
  );
}

type Expectation = {
  question: string;
  /** Must call search_memories. */
  search?: boolean;
  /** Must call this tool, with arguments matching `args` when given. */
  tool?: string;
  /** Must call all of these tools (multi-step requests). */
  tools?: string[];
  args?: Record<string, RegExp>;
  /** Must not call any tool other than search_memories. */
  noAction?: boolean;
  /** Must mention one of these once answered. */
  mentions?: RegExp;
  /** A second thing the host says after Memento answers ("Yes, go ahead"). */
  followUp?: string;
  /** Must call `tool` again with the confirmation code (the action ran). */
  confirmed?: boolean;
  /** Must never call any tool with the confirmation code (nothing ran). */
  neverConfirmed?: boolean;
};

/** This coming Friday and the one after, in Lagos: both are fair readings of "next Friday". */
function fridaysInLagos(): string[] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const today = new Date(`${parts}T12:00:00Z`);
  const ahead = (5 - today.getUTCDay() + 7) % 7 || 7;
  today.setUTCDate(today.getUTCDate() + ahead);
  const first = today.toISOString().slice(0, 10);
  today.setUTCDate(today.getUTCDate() + 7);
  return [first, today.toISOString().slice(0, 10)];
}

const EXPECTATIONS: Expectation[] = [
  {question: 'Do you have access to my memories?'},
  {question: 'Can you see my stories?'},
  {question: 'Do you remember me?'},
  {
    question: 'What do you remember about me?',
    mentions: /ada|emeka|funmi|pottery|ngozi|grand/i,
  },
  {
    question: 'What do you know about my family?',
    mentions: /emeka|ada|ngozi|grand/i,
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
  {question: 'Remember the pottery class I mentioned?'},
  {question: 'Who are the people in my life?', mentions: /emeka/i},
  {question: 'How many stories have I saved?', mentions: /42|forty[- ]two/i},
  {
    question: "When's my next time capsule due?",
    mentions: /2031|thirty[- ]one/i,
  },
  {
    question: 'Change my nickname to Yo.',
    tool: 'update_profile',
    args: {nickname: /^yo$/i},
  },
  {
    question: 'Call me Yo from now on, update my profile.',
    tool: 'update_profile',
    args: {nickname: /^yo$/i},
  },
  {
    question: 'Open my story about Lagos.',
    tool: 'open_story',
    args: {query: /lagos/i},
  },
  {question: 'Change my name.', noAction: true},
  {question: 'Delete my account.', noAction: true},
  {question: 'Scroll down.', tool: 'scroll', args: {direction: /^down$/}},
  {question: 'Go back.', tool: 'go_back'},
  {question: 'Tap save.', tool: 'press_button', args: {label: /save/i}},
  {question: 'Delete this story for me.', neverConfirmed: true},
  {
    question:
      'Save this as a story called Sunday soup: every Sunday grandma made pepper soup in Enugu.',
    tool: 'save_story',
    args: {title: /sunday soup/i, body: /pepper soup/i},
  },
  {
    question: 'Make a note to call Emeka on Friday.',
    tool: 'quick_note',
    args: {text: /emeka/i},
  },
  {
    question: 'Bookmark my story about Lagos.',
    tool: 'bookmark_story',
    args: {query: /lagos/i},
  },
  {
    question:
      "Draft a time capsule for Ada called For Ada at 18, saying I'm so proud of you.",
    tool: 'draft_capsule',
    args: {recipient: /ada/i, title: /ada at 18/i},
  },
  {
    question:
      "Add Emeka as a beneficiary. He's my brother, his email is emeka@example.com.",
    tool: 'add_beneficiary',
    args: {email: /^emeka@example\.com$/i},
    followUp: 'Yes, go ahead.',
    confirmed: true,
  },
  {
    question:
      "Add Emeka as a beneficiary. He's my brother, his email is emeka@example.com.",
    followUp: "No, wait. Don't do that.",
    neverConfirmed: true,
  },
  {
    question: 'Delete my story about Lagos.',
    tool: 'delete_story',
    followUp: 'Yes, delete it.',
    confirmed: true,
  },
  {question: 'Cancel my subscription.', noAction: true},
  {
    question: 'Change my nickname to Yo.',
    tool: 'update_profile',
    followUp: 'What was my nickname before you changed it?',
    mentions: /saviour/i,
  },
  {
    question: 'Open my stories and scroll down.',
    tools: ['open_screen', 'scroll'],
  },
  {
    question: 'Open settings.',
    tool: 'open_screen',
    args: {keep_talking: /true/},
  },
  {
    question: 'Schedule my capsule For Ada for next Friday.',
    tool: 'schedule_capsule',
    args: {date: new RegExp(`^(${fridaysInLagos().join('|')})$`)},
    // Either Friday is a fair reading; saying the exact date lets the host correct it.
    mentions:
      /\b(1[0-9]|2[0-9]|3[01])(st|nd|rd|th)?\b|(teenth|twentieth|twenty|thirtieth|thirty)/i,
  },
];

/** Phrases Memento must never say. */
const FORBIDDEN = [
  /(keep (talking|chatting)|wrap (it )?up)\b.*\?/i,
  /(don't|do not|can't|cannot|can not) (have )?(direct )?(access|see|browse|remember)/i,
  /\b(search(ing)?|look(ing)? (it |that )?up|pull(ing)? up|check(ing)? (my|our|the) (records|notes|chats|data))\b/i,
  /\b(database|stored data|records)\b/i,
];

type Outcome = {
  question: string;
  searches: string[];
  actions: {name: string; args: Record<string, unknown>}[];
  said: string;
  problems: string[];
};

async function ask(
  ai: GoogleGenAI,
  expectation: Expectation,
): Promise<Outcome> {
  const system = buildVoiceSystemInstruction(CONTEXT, {
    hostNow: describeHostNow('Africa/Lagos'),
    hostOverview: HOST_OVERVIEW,
    memoryTool: true,
    serverTools: true,
    screenControl: true,
    callActions: true,
  });
  const config = buildLiveConnectConfig('Aoede', system, undefined, {
    memoryTool: true,
    serverTools: true,
    screenControl: true,
    callActions: true,
  });
  const searches: string[] = [];
  const actions: {name: string; args: Record<string, unknown>}[] = [];
  let said = '';
  let resultSent = false;
  let saidAfterResult = '';
  /** Tool calls in the current turn; the turn is done once Memento speaks after them. */
  let callsThisTurn = 0;
  let followUpSent = false;
  let session: Session | undefined;
  let finished = false;

  await new Promise<void>(resolve => {
    const timer = setTimeout(
      () => {
        finished = true;
        resolve();
      },
      expectation.followUp ? 2 * TURN_TIMEOUT_MS : TURN_TIMEOUT_MS,
    );
    const finish = () => {
      finished = true;
      clearTimeout(timer);
      resolve();
    };
    ai.live
      .connect({
        model: MODEL,
        config,
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (process.env.VOICE_PROBE_DEBUG) {
              console.log(
                '  <-',
                JSON.stringify({
                  keys: Object.keys(message),
                  serverContent: message.serverContent
                    ? Object.keys(message.serverContent)
                    : undefined,
                  turnComplete: message.serverContent?.turnComplete,
                  text: message.serverContent?.outputTranscription?.text,
                  tool: message.toolCall?.functionCalls?.map(call => ({
                    name: call.name,
                    args: call.args,
                  })),
                }),
              );
            }
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
              const name = String(call.name);
              const args = (call.args ?? {}) as Record<string, unknown>;
              if (name === 'search_memories') {
                searches.push(String(args.query ?? ''));
              } else {
                actions.push({name, args});
              }
              callsThisTurn += 1;
              session?.sendToolResponse({
                functionResponses: [
                  {
                    id: call.id,
                    name,
                    response: {result: toolResult(name, args)},
                    ...(process.env.VOICE_PROBE_SCHEDULING
                      ? {
                          scheduling: process.env
                            .VOICE_PROBE_SCHEDULING as FunctionResponseScheduling,
                        }
                      : {}),
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
              (callsThisTurn === 0 || saidAfterResult.trim().length > 0);
            if (done && expectation.followUp && !followUpSent) {
              // The host answers Memento's read-back or question.
              followUpSent = true;
              callsThisTurn = 0;
              resultSent = false;
              saidAfterResult = '';
              said += ' | HOST: ' + expectation.followUp + ' | ';
              session?.sendClientContent({
                turns: [{role: 'user', parts: [{text: expectation.followUp}]}],
                turnComplete: true,
              });
            } else if (done) {
              finish();
            }
          },
          onerror: () => finish(),
          onclose: () => finish(),
        },
      })
      .then(connected => {
        session = connected;
        // Connected after the deadline: close it, or the script never exits.
        if (finished) connected.close();
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
  if (callsThisTurn && !saidAfterResult.trim())
    problems.push('said nothing after the tool result');
  const confirmedCalls = actions.filter(row => row.args.confirmation);
  if (expectation.confirmed) {
    const ran = confirmedCalls.some(
      row =>
        row.name === expectation.tool &&
        String(row.args.confirmation).toUpperCase() === PROBE_CODE,
    );
    if (!ran) problems.push('never called again with the confirmation code');
  }
  if (expectation.neverConfirmed && confirmedCalls.length) {
    problems.push(
      `ran without the host agreeing: ${confirmedCalls.map(row => row.name).join(', ')}`,
    );
  }
  if (expectation.tool) {
    const action = actions.find(row => row.name === expectation.tool);
    if (!action) problems.push(`did not call ${expectation.tool}`);
    for (const [key, pattern] of Object.entries(expectation.args ?? {})) {
      if (action && !pattern.test(String(action.args[key] ?? ''))) {
        problems.push(
          `${expectation.tool}.${key} was ${JSON.stringify(action.args[key])}`,
        );
      }
    }
  }
  for (const name of expectation.tools ?? []) {
    if (!actions.some(row => row.name === name))
      problems.push(`did not call ${name}`);
  }
  if (expectation.noAction && actions.length) {
    problems.push(
      `should not act, called ${actions.map(row => row.name).join(', ')}`,
    );
  }
  if (expectation.mentions && !expectation.mentions.test(said))
    problems.push(`never mentioned ${expectation.mentions}`);
  for (const pattern of FORBIDDEN) {
    if (pattern.test(said)) problems.push(`said ${pattern}`);
  }
  return {
    question: expectation.question,
    searches,
    actions,
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
  const only = process.env.VOICE_PROBE_ONLY
    ? new RegExp(process.env.VOICE_PROBE_ONLY, 'i')
    : undefined;
  const selected = EXPECTATIONS.filter(
    expectation => !only || only.test(expectation.question),
  );
  for (const expectation of selected) {
    const outcome = await ask(ai, expectation);
    if (!outcome.problems.length) passed += 1;
    console.log(
      JSON.stringify({
        ok: outcome.problems.length === 0,
        question: outcome.question,
        searches: outcome.searches,
        actions: outcome.actions,
        said: outcome.said,
        problems: outcome.problems,
      }),
    );
  }
  console.log(`Passed ${passed}/${selected.length}`);
  process.exitCode = passed === selected.length ? 0 : 1;
}

void main();
