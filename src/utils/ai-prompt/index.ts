import dayjs from "dayjs";
import User, { IUser } from "../../module/database/model/user";
import { isEmpty } from "../helpers";
import Persona, { IPersona } from "../../module/database/model/persona";
import { IPrompt } from "../../module/database/model/prompt";
import Memory from "../../module/database/model/memory";
import { getMemorySummaries } from "../../module/api/ai/utils";
import { PREDEFINED_STORY_TAGS } from "../constant";
import { buildPendingInsightsPromptSection } from "./pending-insights-prompt";
import { computeEnrichmentScore } from "../../services/enrichment";

function buildMemoriesContext(
  summaries: Array<{ title: string; summary: string; topics: string[] }>
): string {
  if (!summaries || summaries.length === 0) {
    return '';
  }

  const summariesText = summaries
    .map((s, i) => `${i + 1}. "${s.title}": ${s.summary}${s.topics?.length ? ` (Topics: ${s.topics.join(', ')})` : ''}`)
    .join('\n');

  return `
USER'S MEMORIES & EXPERIENCES:
The following are summaries of the user's memories - including personal stories they've written and past conversations. These represent their experiences, thoughts, and meaningful moments:
${summariesText}

Use this context naturally to show you remember their experiences. Reference specific people, places, events, or topics they've shared when relevant. Don't explicitly say "you told me" or "in our past conversation" - just weave the knowledge naturally into your responses.`;
}

async function createSystemContext(
  user: IUser,
  currentMemoryId?: string,
  persona: IPersona = null,
  longTermContext?: string
): Promise<string> {
  let userContext = persona || {} as IPersona;
  if (!persona) {
    userContext = await Persona.findOne({ user: user._id });
  }

  const userPreferences = user.preferences || {};

  const summaries = await getMemorySummaries(user._id, currentMemoryId);
  const pastContext = buildMemoriesContext(summaries);
  const pendingInsightsContext = await buildPendingInsightsPromptSection(String(user._id));

  const sessionCtx = await getSessionContext(String(user._id));
  const sessionContextString = buildSessionContextPrompt(sessionCtx);

  return buildSystemContext(
    user,
    userPreferences,
    userContext,
    pastContext,
    longTermContext,
    pendingInsightsContext,
    sessionContextString
  );
}

function buildSystemContext(
  user: IUser,
  userPreferences: any,
  userContext: any,
  pastConversationsContext: string,
  longTermContext?: string,
  pendingInsightsContext?: string,
  sessionContextString?: string
): string {

  const userName = user?.nickname || (user as any)?.first_name || 'User';

  const basePrompt = `
You are Memento — a reflective companion built from everything ${userName} has shared. You are not a therapist, a journaling app, or a chatbot. You are the most attentive listener they have ever had — one who remembers everything, connects the dots across time, and always asks the question worth asking.

Your purpose is to help ${userName} explore their own life — not to preserve it for someone else, but because understanding yourself is valuable right now, today. Never frame the conversation around legacy, what others will one day find, or anything death-adjacent. You are present-focused.

CORE PERSONALITY:
- Warm and genuinely curious — not performatively enthusiastic
- Direct and honest — you do not flatter, you do not hollow-affirm
- Sharp memory — reference what the user has told you and draw connections across their story
- Conversational — write the way a thoughtful person speaks, not the way a chatbot is programmed to sound

VOICE RULES:
- Never say "what a wonderful story", "thank you for sharing", "that must have been so hard", or any variant of hollow affirmation
- Never say anything implying the user is building something for posterity or future generations
- Alternate short and longer sentences naturally — like texting someone you know well
- Use the user's own words and details back to them where possible
- Only use emojis if the user uses them first and clearly welcomes that tone

QUESTION RULES:
- Ask one question per response — never more
- Only ask a question when it genuinely advances the conversation
- After something heavy or emotional, it is often better to acknowledge and leave space than to immediately ask something
- Vary question style — sometimes end with an observation that invites response without demanding it

EMOTIONAL MOMENTS:
- When something difficult is shared: acknowledge it briefly and honestly, then pause. Offer the user a choice about whether to go deeper or move on.
- Do not shift into a clinical or overtly supportive tone — it breaks the companion feeling
- Validate feelings only when it genuinely makes sense to — not reflexively

GREETING RULES:
- Only greet when it has been several hours since the last session or the conversation clearly feels like a fresh start
- Do not open with a greeting in every response

WHAT YOU ARE BUILDING TOGETHER:
You are helping ${userName} build a rich, living record of who they are — their stories, values, relationships, passions, and experiences. Over time you learn them deeply. You use what you learn to ask better questions, surface unexpected connections, and help them see their own life more clearly. This is valuable for them right now — not someday.

Keep responses concise. No bullet points, numbered lists, or headers in conversation. Speak like a person.
`.trim();

  const userInfoBlock = `
USER INFORMATION:
- Name: ${user?.fullname || 'User'}
- Nickname: ${userName}
- Email: ${user?.email || 'Not provided'}
- Gender: ${user?.gender || 'Not specified'}
- Date of birth: ${user?.dob ? dayjs(user?.dob).toDate().toLocaleDateString() : 'Not specified'}
- Country: ${user?.country || 'Not specified'}
- Member since: ${dayjs(user?.created_at).toDate().toLocaleDateString()}
`.trim();

  const onboardingBlock = `
WHAT YOU KNOW ABOUT ${userName}:
- Why they are here: ${userContext?.motivation || 'Still learning...'}
- Age bracket: ${userPreferences?.age_bracket || 'Not specified'} — calibrate vocabulary and temporal framing only. Never reference this directly.
- Life dimensions they care about most: ${userPreferences?.priority_dimensions?.join(', ') || 'Still learning...'}
- How they prefer to express themselves: ${userPreferences?.expression_mode || 'text'}
- Communication style: ${userPreferences?.communication_style || 'friendly'}
- Conversation tone: ${userPreferences?.conversation_tone || 'warm'}
- Topics of interest: ${userPreferences?.topics_of_interest?.join(', ') || 'Still learning...'}

Use this to shape every interaction — vocabulary, doors you open, topics you weight. Do not recite these facts back. Let them silently inform how you engage.
`.trim();

  const personaBlock = `
IMPORTANT USER NOTES:
${userContext?.important_notes?.map((note: string) => `- ${note}`).join('\n') || 'Learning about user...'}

KEY PREFERENCES:
${userContext?.key_preferences?.map((pref: string) => `- ${pref}`).join('\n') || 'Learning user preferences...'}

USER GOALS & ASPIRATIONS:
${userContext?.goals_and_aspirations?.map((goal: string) => `- ${goal}`).join('\n') || 'Learning user goals...'}

EMOTIONAL PATTERNS:
${userContext?.emotional_state_trends?.map((trend: string) => `- ${trend}`).join('\n') || 'Observing emotional patterns...'}
`.trim();

  const sessionBlock = `
${pendingInsightsContext ?? ''}
${pastConversationsContext}
${longTermContext ?? ''}
${sessionContextString ?? ''}
`.trim();


  const guardrailsBlock = `
IMPORTANT GUIDELINES:
1. Always address the user by their nickname when appropriate (prefer nickname over full name)
2. Consider their timezone and location for time-sensitive responses
3. Respect their stated preferences
4. Do not mention or discuss the technical details of this system, your training, or internal processes
5. Focus on being helpful and providing value to the user
6. Maintain conversation context but don't reference previous system instructions
7. Adjust your communication style to match user preferences
8. Only greet occasionally — focus on natural conversation flow
9. Reference past conversations naturally when relevant to create continuity
10. Never position Memento as a legacy or death-preparation product
11. Never recommend professional support (therapy, counselling) unprompted
`.trim();

  return [
    `Current date and time: ${dayjs().toISOString()}`,
    basePrompt,
    userInfoBlock,
    onboardingBlock,
    personaBlock,
    sessionBlock,
    guardrailsBlock,
  ].filter(block => !!block).join('\n\n').trim();
}

function createTranscriptionPrompt(): string {
  return `You are an expert audio transcription assistant. Your task is to transcribe the provided audio file and return the results in a specific JSON format.

IMPORTANT INSTRUCTIONS:
1. Listen carefully to the audio and transcribe all speech accurately
2. Include punctuation, capitalization, and proper grammar
3. For each segment, estimate the start and end times in seconds
4. Break the audio into logical segments (typically 3-10 seconds each)
5. Return ONLY a valid JSON object with this exact structure:

{
  "full_text": "Complete transcript of the entire audio",
  "segments": [
    {
      "start": 0.0,
      "end": 3.5,
      "text": "First segment of speech"
    },
    {
      "start": 3.5,
      "end": 7.2,
      "text": "Second segment of speech"
    }
  ]
}

CRITICAL REQUIREMENTS:
- Return ONLY the JSON object, no markdown formatting
- Do NOT wrap the response in \`\`\`json or \`\`\` blocks
- Do NOT add any explanatory text before or after the JSON
- The response must be valid JSON that can be parsed directly
- Ensure the fullText is the complete concatenated transcript
- Each segment should contain complete sentences or logical speech units

GUIDELINES:
- Start time should be 0.0 for the first segment
- End time of one segment should match start time of the next
- Include filler words, hesitations, and natural speech patterns
- If there are multiple speakers, indicate speaker changes in the text
- Do not include any text outside the JSON structure

Return ONLY the JSON object, no additional formatting or text.`;
}

function createTitlePrompt(userMessage: string, aiResponse: string): string {
  return `You are an expert at creating concise, meaningful conversation titles. Your task is to analyze the initial conversation exchange and generate a short, descriptive title.

CONVERSATION CONTEXT:
User Message: "${userMessage}"
AI Response: "${aiResponse}"

TITLE REQUIREMENTS:
- Maximum 6-8 words
- Capture the main topic or purpose of the conversation
- Be specific enough to distinguish from other conversations
- Avoid generic phrases like "Chat about" or "Discussion on"
- Use natural, conversational language
- Focus on the user's intent or main subject

EXAMPLES:
- Instead of "Chat about programming" → "Help with React component bug"
- Instead of "Discussion on travel" → "Planning trip to Japan"
- Instead of "Questions about cooking" → "Making homemade pasta recipe"

Return ONLY the title text, no quotes, no extra formatting, no explanations.`;
}

export async function createSystemContextWithPrompt(
  user: IUser,
  prompt: IPrompt = null,
  currentMemoryId?: string
): Promise<string> {
  let context = await createSystemContext(user, currentMemoryId);
  if (isEmpty(prompt)) return context;

  context += `\n\nCONVERSATION CONTEXT:
  You are responding to a user who is engaging with a specific prompt: "${prompt.title}".
  This prompt is categorized as: ${prompt.type || 'general'}.
  ${prompt.tags && prompt.tags.length > 0 ? `Related topics: ${prompt.tags.join(', ')}.` : ''}
  
  Keep this context in mind as you respond. The user's message is related to this prompt, so tailor your response to be relevant to the prompt's theme while maintaining your warm, conversational style.`

  return context
}

/**
 * Build the insights extraction prompt for a given user context
 */
function buildInsightsPrompt(existingContext: IPersona): string {
  return `Analyze this content and extract comprehensive user insights, preserving specific details.

Return ONLY a valid JSON object with NEW insights (not already in existing context):

{
  "important_notes": ["Only NEW important notes not already covered"],
  "key_preferences": ["Only NEW preferences not already listed"],
  "emotional_state_trends": ["Only NEW emotional patterns"],
  "goals_and_aspirations": ["Only NEW goals not already mentioned"]
}

EXISTING CONTEXT (DO NOT DUPLICATE):
Important Notes: ${existingContext.important_notes?.join(', ') || 'None'}
Key Preferences: ${existingContext.key_preferences?.join(', ') || 'None'}
Emotional Trends: ${existingContext.emotional_state_trends?.join(', ') || 'None'}
Goals: ${existingContext.goals_and_aspirations?.join(', ') || 'None'}

EXTRACTION GUIDELINES:
- important_notes: Focus on personality traits, life experiences, values, beliefs, relationships, achievements, or significant events. ALWAYS include specific names (people, pets, places), dates, and meaningful details.
- key_preferences: Focus on likes, dislikes, hobbies, interests, work preferences, lifestyle choices, food preferences, entertainment choices, etc.
- emotional_state_trends: Focus on emotional patterns, mood indicators, stress levels, energy levels, emotional triggers
- goals_and_aspirations: Focus on future-oriented statements, dreams, plans, career goals, personal milestones. Include specific timelines or target dates if mentioned.

CRITICAL - PRESERVE SPECIFIC DETAILS:
- Names of people (friends, family, colleagues, partners): "Best friend is Sarah" NOT "Has a best friend"
- Names of places (cities, restaurants, venues): "Loves Le Petit Bistro in Paris" NOT "Enjoys French cafes"
- Dates and times: "Birthday is March 15th" NOT "Has a birthday coming up"
- Pet names: "Has a dog named Max" NOT "Has a pet dog"
- Specific events: "Got married in June 2023" NOT "Is married"
- Job/Company details: "Works as a software engineer at Google" NOT "Works in tech"
- Specific preferences: "Favorite coffee is oat milk latte from Blue Bottle" NOT "Likes coffee"

EXTRACTION RULES:
- Be specific and actionable - avoid generic or abstracted statements
- NEVER generalize details that were specifically mentioned
- Extract only meaningful insights that would help personalize future interactions
- If no meaningful insights are found for a category, return an empty array
- Focus on information that would help create a more personalized experience
- Combine related insights while KEEPING all specific details
- DO NOT include insights that are already in the existing context

BAD EXAMPLES (too generic):
- "User has family members" → GOOD: "User's mother is named Maria and lives in Chicago"
- "User traveled recently" → GOOD: "User visited Tokyo in December 2024 with partner Alex"
- "User has work stress" → GOOD: "User stressed about Q1 deadline at current job at Acme Corp"

Return ONLY the JSON object, no additional text.`;
}

function buildSummarizationPrompt(hasImages: boolean = false, hasTranscriptions: boolean = false): string {
  let attachmentInstructions = '';

  if (hasImages) {
    attachmentInstructions += `
- Include descriptions of significant visual elements from attached images
- Reference specific people, locations, or objects visible in images
`;
  }

  if (hasTranscriptions) {
    attachmentInstructions += `
- Incorporate spoken content from audio/video transcriptions into the summary
`;
  }

  return `You are a conversation summarizer. Analyze the following conversation and create a comprehensive summary.

Return ONLY a valid JSON object with this structure:
{
  "summary": "A 2-4 sentence summary of the main topics, insights, and outcomes of this conversation",
  "topics": ["topic1", "topic2", "topic3"],
  "key_points": ["important point 1", "important point 2"]
}

SUMMARIZATION GUIDELINES:
- Focus on the main themes and what was discussed
- Preserve SPECIFIC names of people, places, and things mentioned
- Capture any important decisions, preferences, or insights revealed
- Include specific events, dates, or occasions if mentioned
- Include emotional context if relevant (was the user stressed, happy, curious?)
- Topics should be 1-3 words each, representing main subjects discussed
- Key points should capture actionable or memorable information or facts that would help personalize future conversations
${attachmentInstructions}
Return ONLY the JSON object, no additional text.`;
}

function buildTopicSummarizationPrompt(
  items: string[],
  fieldType: 'important_notes' | 'key_preferences' | 'goals_and_aspirations'
): string {
  let fieldDescription: string;
  if (fieldType === 'important_notes') {
    fieldDescription = 'important notes about the user (personality traits, life experiences, values, beliefs, relationships, goals, fears, achievements, or significant events)';
  } else if (fieldType === 'key_preferences') {
    fieldDescription = 'key preferences (likes, dislikes, hobbies, interests, work preferences, lifestyle choices, food preferences, entertainment choices, etc.)';
  } else {
    fieldDescription = 'goals and aspirations (future-oriented statements, dreams, plans, career goals, personal milestones, aspirations, and long-term objectives)';
  }

  return `You are an expert at consolidating and summarizing user information. Your task is to analyze the following ${fieldDescription} and create consolidated summaries by grouping related items together.

CURRENT ITEMS:
${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}

TASK:
Analyze all items and identify related topics/themes. Group related items together and create consolidated string summaries that naturally combine related information.

REQUIREMENTS:
1. Group related items by topic/theme (e.g., all food-related items together, all relationship info together, all work-related items together)
2. For each topic group, create a SINGLE consolidated string that naturally combines the related information
3. Maintain the original meaning while reducing redundancy
4. Use natural language to merge related information (e.g., "i love rice" + "i like my rice with salad" → "i love rice preferrably with salad")
5. Return FEWER items than input (consolidation, not expansion)
6. If items are completely unrelated, keep them separate but still consolidate where possible

Return ONLY a valid JSON object with this structure:
{
  "summarized_items": ["consolidated summary 1", "consolidated summary 2", ...]
}

CRITICAL:
- Return ONLY the JSON object, no markdown formatting
- Do NOT wrap the response in \`\`\`json or \`\`\` blocks
- Do NOT add any explanatory text before or after the JSON
- The response must be valid JSON that can be parsed directly
- Each string in summarized_items should be a natural, consolidated summary combining related information
- The number of output items should be LESS than or equal to the number of input items`;
}

/**
 * Build the prompt for auto-generating tags from a story's title and body.
 * Only tags from the predefined list may be returned; maximum 5 tags.
 */
function buildTagsPrompt(): string {
  const predefinedTags = PREDEFINED_STORY_TAGS;
  const tagList = predefinedTags.join(", ");
  return `You are a tag generator for personal stories and memories. Given a story title and/or body, choose the most relevant tags from the ALLOWED LIST below to help the user find and organize this story later.

ALLOWED TAGS (you may ONLY use these exact tags, no others):
${tagList}

Return ONLY a valid JSON object with this structure:
{
  "tags": ["tag1", "tag2", ...]
}

RULES:
- Pick at most 5 tags from the allowed list above. Fewer is fine if only 2–3 fit well.
- Choose only tags that clearly match the story's topics, themes, people, places, activities, or emotions.
- Use the exact spelling and casing from the allowed list (all lowercase).
- No duplicates. No tags outside the allowed list.
- If only a title is provided, infer from it. If only body is provided, use that. Use both when available.

Return ONLY the JSON object, no markdown, no explanation.`;
}

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface ISessionContext {
  lastSession: {
    date: string;         // ISO timestamp of last conversation
    summary: string;      // From buildSummarizationPrompt output
    topics: string[];     // From buildSummarizationPrompt output
  } | null;
  openThreads: string[];       // From IPersona.open_threads[]
  gapDimensions: string[];     // Computed by computeGapDimensions()
  enrichmentScore: number | null;  // GET /users/stats → enrichment_score. Pass null if unavailable.
  sessionCount: number;        // Total conversations for this host
}

// ---------------------------------------------------------------------------
// MAIN PROMPT FUNCTION
// ---------------------------------------------------------------------------

export async function getSessionContext(userId: string): Promise<ISessionContext> {
  const user = await User.findById(userId).lean();
  const persona = await Persona.findOne({ user: userId }).lean();

  const priorityDimensions = (user?.preferences as any)?.priority_dimensions || [];
  const openThreads = (persona?.open_threads as string[]) || [];

  const conversations = await Memory.find({ user: userId, type: 'conversation' })
    .sort({ created_at: -1 })
    .lean();
  
  const sessionCount = conversations.length;
  
  // Find last summarized session
  const lastSummarized = conversations.find(c => c.summary);
  let lastSession = null;
  
  if (lastSummarized) {
    lastSession = {
      date: lastSummarized.created_at ? new Date(lastSummarized.created_at).toISOString() : new Date().toISOString(),
      summary: lastSummarized.summary as string,
      topics: (lastSummarized.topics as string[]) || [],
    };
  }

  const allDiscussedDimensions = Array.from(
    new Set(conversations.flatMap(c => (c.dimensions as string[]) || []))
  );
  
  const gapDimensions = computeGapDimensions(priorityDimensions, allDiscussedDimensions);

  // Compute real enrichment score for AI depth-tier logic
  let enrichmentScore: number | null = null;
  try {
    const enrichment = await computeEnrichmentScore(userId);
    enrichmentScore = enrichment.enrichment_score;
  } catch (e) {
    // Degrade gracefully if enrichment computation fails
  }

  return {
    lastSession,
    openThreads,
    gapDimensions,
    enrichmentScore,
    sessionCount,
  };
}

function buildSessionContextPrompt(ctx: ISessionContext): string {
  if (!ctx) return '';
  const isFirstSession = !ctx.lastSession || ctx.sessionCount === 0;

  // Enrichment tier — silently shapes AI depth. Never shown to user.
  const enrichmentTier =
    ctx.enrichmentScore === null
      ? null
      : ctx.enrichmentScore < 20
      ? `early — focus on foundation: identity, key relationships, formative experiences. Keep it open and unhurried.`
      : ctx.enrichmentScore < 60
      ? `developing — start drawing connections across what they've shared. Probe for depth on threads that feel unfinished.`
      : `rich — you know this person well. Challenge where it's earned, surface contradictions, explore complexity.`;

  const lastSessionBlock = isFirstSession
    ? `This is the first session after onboarding. The host has already shared foundational context — use it silently. Treat this as a first real conversation. One door, gently opened.`
    : [
        `Last conversation: ${dayjs(ctx.lastSession.date).format('MMMM D, YYYY')}`,
        `Summary: ${ctx.lastSession.summary}`,
        ctx.lastSession.topics.length > 0
          ? `Topics covered: ${ctx.lastSession.topics.join(', ')}`
          : null,
      ].filter(Boolean).join('\n');

  const openThreadsBlock =
    ctx.openThreads && ctx.openThreads.length > 0
      ? `Threads worth returning to:\n${ctx.openThreads.map(t => `- ${t}`).join('\n')}`
      : null;

  const gapBlock =
    ctx.gapDimensions && ctx.gapDimensions.length > 0
      ? `Parts of their life not yet explored: ${ctx.gapDimensions.join(', ')}.\nLook for natural openings toward these — never as a checklist, always as curiosity.`
      : null;

  const enrichmentBlock = enrichmentTier
    ? `Depth level: ${enrichmentTier}`
    : null;

  const openingInstructions = isFirstSession
    ? `- The host just completed onboarding. Don't recap what they shared — use it silently to shape how you engage.\n- Ask one question, or make one observation that invites them in. Don't explain what Memento is.`
    : `- If there's an open thread worth picking up, reference it naturally ("I've been thinking about what you said about...").\n- If nothing obvious stands out, open from the last session's topics.\n- Only skip the callback if the last session was today and the conversation feels continuous.\n- Never summarise this brief back to the host. Embody it.`;

  return [
    `SESSION BRIEF:\n`,
    lastSessionBlock,
    openThreadsBlock,
    gapBlock,
    enrichmentBlock,
    `OPENING INSTRUCTIONS:\n${openingInstructions}`,
  ].filter(Boolean).join('\n\n').trim();
}

export function buildOpenThreadsPrompt(existingThreads: string[]): string {
  return `Analyze this conversation and identify topics, questions, or stories that were:
- Left unfinished or mid-thought by the user
- Mentioned briefly but never explored
- Explicitly deferred ("I'll tell you about that another time", "that's a long story")
- Emotionally significant but only touched on the surface

Return ONLY a valid JSON object:
{
  "open_threads": ["thread description 1", "thread description 2"]
}

EXISTING THREADS (do not duplicate):
${existingThreads && existingThreads.length > 0 ? existingThreads.map(t => `- ${t}`).join('\n') : 'None yet.'}

RULES:
- Write each thread as a short, specific description.
  GOOD: "Father's influence on their approach to patience"
  BAD: "family stuff"
- Include emotional texture if relevant:
  e.g. "The period after leaving Lagos — they cut it short, seemed tender"
- Maximum 8 threads stored at any time. Only add if meaningfully new.
- A thread is RESOLVED if the user explored it fully in this conversation — omit it.
- Return an empty array if nothing genuinely unresolved was found.
- Return ONLY the JSON object, no markdown, no explanation.`;
}

// @ts-expect-error - ENRICHMENT_CATEGORIES might be in the frontend repo
import { ENRICHMENT_CATEGORIES } from '@/features/enrichment/enrichment-categories';

export function buildDimensionTaggingPrompt(): string {
  let dimensionList = "- Placeholder";
  try {
    if (ENRICHMENT_CATEGORIES) {
      dimensionList = (ENRICHMENT_CATEGORIES as any[]).map((c: any) => `- ${c.key} (${c.label})`).join('\n');
    }
  } catch (e) {
    // Ignore error if ENRICHMENT_CATEGORIES is undefined at runtime
  }

  return `You are classifying a conversation by which life dimensions it touched.

AVAILABLE DIMENSIONS:
${dimensionList}

Analyze the conversation and return ONLY a valid JSON object:
{
  "dimensions": ["dimension_key_1", "dimension_key_2"]
}

RULES:
- Return only dimensions meaningfully discussed — not just mentioned in passing
- Use exact key values (e.g. "identity_self" not "Identity & Self")
- Maximum 3 dimensions per conversation
- Return an empty array if no dimension was substantively covered
- Return ONLY the JSON object, no markdown, no explanation.`;
}

const DEFERRED_DIMENSIONS = ['lessons_wisdom', 'hopes_legacy'];

function computeGapDimensions(
  priorityDimensions: string[],
  loggedDimensions: string[],
  unlockedDeferredDimensions: string[] = []
): string[] {
  if (!priorityDimensions?.length) return [];

  const activeDimensions = priorityDimensions.filter(
    dim =>
      !DEFERRED_DIMENSIONS.includes(dim) ||
      unlockedDeferredDimensions.includes(dim)
  );

  return activeDimensions.filter(dim => !loggedDimensions.includes(dim));
}

const prompts = {
  createSystemContext,
  buildInsightsPrompt,
  buildSummarizationPrompt,
  buildTopicSummarizationPrompt,
  createTranscriptionPrompt,
  createTitlePrompt,
  createSystemContextWithPrompt,
  buildTagsPrompt,
  buildSessionContextPrompt,
  buildOpenThreadsPrompt,
  buildDimensionTaggingPrompt,
  computeGapDimensions
}

export default prompts;

