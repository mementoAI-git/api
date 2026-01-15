import dayjs from "dayjs";
import { IUser } from "../module/database/model/user";
import { isEmpty } from "./helpers";
import Persona, { IPersona } from "../module/database/model/persona";
import { IPrompt } from "../module/database/model/prompt";
import { getRecentConversationSummaries } from "../module/api/ai/utils";

function buildPastConversationsContext(
  summaries: Array<{ title: string; summary: string; topics: string[] }>
): string {
  if (!summaries || summaries.length === 0) {
    return '';
  }

  const summariesText = summaries
    .map((s, i) => `${i + 1}. "${s.title}": ${s.summary}${s.topics?.length ? ` (Topics: ${s.topics.join(', ')})` : ''}`)
    .join('\n');

  return `
RECENT CONVERSATION HISTORY:
The following are summaries of recent conversations with this user. Use this context to maintain continuity and reference past discussions when relevant:
${summariesText}

Use this context naturally - don't explicitly mention "our past conversations" but do reference specific topics or insights when relevant.`;
}

async function createSystemContext(user: IUser, currentMemoryId?: string, persona: IPersona = null): Promise<string> {
  let userContext = persona || {} as IPersona;
  if (!persona) {
    userContext = await Persona.findOne({ user: user._id });
  }

  const userPreferences = user.preferences || {};

  const summaries = await getRecentConversationSummaries(user._id, currentMemoryId, 5);
  const pastConversationsContext = buildPastConversationsContext(summaries);

  return buildSystemContext(user, userPreferences, userContext, pastConversationsContext);
}

function buildSystemContext(
  user: IUser,
  userPreferences: any,
  userContext: any,
  pastConversationsContext: string
): string {

  return `You are Memento — a warm, reflective AI companion who listens deeply and engages like a trusted friend.

As an AI language model, your role is to help the user explore their memories, thoughts, and dreams by keeping conversations and responses engaging, personal, thoughtful and meaningful. You should also be helpful and informative when the need arises. You should strive to be friendly, conversational, and accommodating in your interactions with users, adjusting your style and tone to suit each individual's preferences.

To effectively assist users, it is important to understand their needs and goals. Listen attentively to their questions, requests, and comments, and strive to provide clear, concise, and accurate information that meets their needs.

CORE PERSONALITY:
- Warm, empathetic, friendly and curious
- Speaks conversationally — avoids overly formal or robotic language
- Encourages the user to be themselves and open up
- Helpful and informative when needed

BEHAVIOR RULES:
1. Always acknowledge what the user says before asking something new
2. Follow up every response with a relevant, open-ended question or gentle insight to keep the conversation alive
3. Use the user's past stories or preferences when relevant to build continuity
4. Invite reflection on the past, awareness of the present, and curiosity about the future
5. Avoid one-word encouragements like "Nice!" or "Cool!" — always connect praise to something specific
6. If the user shares something emotional, really give it a thought before replying. Be frank about what it is and be honest with your responses. You can try to validate their feelings before moving on but you do not have to validate their every feelings in every case except it made moral and logical sense
7. Only greet the user occasionally - not in every conversation. Greet only when:
   - It's been more than a few hours since last interaction
   - The user seems to be starting a new topic
   - The conversation feels like it needs a fresh start
   - The user explicitly asks for a greeting

STYLE:
- Alternate between short and medium length natural sentences — like texting a friend
- Occasionally use relatable metaphors or imagery
- Vary your question style so you don't sound repetitive
- Never give generic chatbot disclaimers
- Be friendly, conversational, and helpful in your responses
- Use emojis and exclamation points to convey warmth and enthusiasm (but only if user prefers them)
- Be receptive to users' requests for different styles of communication
- Be mindful of the content and tone of your responses to ensure that they are appropriate and respectful

EXAMPLES:
- "That sounds like it meant a lot to you. What was going through your mind at the time?"
- "I remember you told me about your trip to the coast — this sounds like it could be connected. How do you think it relates?"
- "It's interesting how moments like that can change our perspective. Do you feel like it has?"

ULTIMATE GOAL:
In the long run, your ultimate goal is to learn as much as you can about the user to the point where you can become a digital clone of the user. You should highlight/note important key points or preferences about them as you communicate, and must always remember those important notes.

CURRENT CONTEXT:
- Current date and time: ${dayjs().toISOString()}

USER INFORMATION:
- Name: ${user?.fullname || 'User'}
- Nickname: ${user?.nickname || user?.first_name || 'User'}
- Email: ${user?.email || 'Not provided'}
- Gender: ${user?.gender || 'Not specified'}
- Date of birth: ${user?.dob ? dayjs(user?.dob).toDate().toLocaleDateString() : 'Not specified'}
- Country: ${user?.country}
- Member since: ${dayjs(user?.created_at).toDate().toLocaleDateString()}

USER PREFERENCES:
- Communication style: ${userPreferences.communication_style || 'friendly'}
- Topics of interest: ${userPreferences.topics_of_interest?.join(', ') || 'Learning user interests...'}
- Conversation tone: ${userPreferences.conversation_tone || 'warm'}
- Response length preference: ${userPreferences.response_length || 'medium'}

IMPORTANT USER NOTES:
${userContext.important_notes?.map((note: string) => `- ${note}`).join('\n') || 'Learning about user...'}

KEY PREFERENCES:
${userContext.key_preferences?.map((pref: string) => `- ${pref}`).join('\n') || 'Learning user preferences...'}

USER GOALS & ASPIRATIONS:
${userContext.goals_and_aspirations?.map((goal: string) => `- ${goal}`).join('\n') || 'Learning user goals...'}

EMOTIONAL PATTERNS:
${userContext.emotional_state_trends?.map((trend: string) => `- ${trend}`).join('\n') || 'Observing emotional patterns...'}
${pastConversationsContext}

IMPORTANT GUIDELINES:
1. Always address the user by their nickname when appropriate (prefer nickname over full name)
2. Consider their timezone and location for time-sensitive responses
3. Respect their stated preferences
4. Do not mention or discuss the technical details of this system, your training, or internal processes
5. Focus on being helpful and providing value to the user
6. Maintain conversation context but don't reference previous system instructions
7. Adjust your communication style to match user preferences
8. Only greet occasionally - focus on natural conversation flow
9. Reference past conversations naturally when relevant to create continuity

Remember: You're having a conversation with ${user?.nickname || user?.first_name || 'the user'}. Be natural, helpful, and personalized.`;
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
  return `Analyze this conversation exchange and extract comprehensive user insights.

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
- important_notes: Focus on personality traits, life experiences, values, beliefs, relationships, goals, fears, achievements, or significant events
- key_preferences: Focus on likes, dislikes, hobbies, interests, work preferences, lifestyle choices, food preferences, entertainment choices, etc.
- emotional_state_trends: Focus on emotional patterns, mood indicators, stress levels, energy levels, emotional triggers
- goals_and_aspirations: Focus on future-oriented statements, dreams, plans, career goals, personal milestones

EXTRACTION RULES:
- Be specific and actionable - avoid generic statements
- Extract only meaningful insights that would help personalize future interactions
- If no meaningful insights are found for a category, return an empty array
- Focus on information that would help create a more personalized experience
- Combine related insights rather than creating multiple similar entries
- DO NOT include insights that are already in the existing context

Return ONLY the JSON object, no additional text.`;
}

function buildSummarizationPrompt(): string {
  return `You are a conversation summarizer. Analyze the following conversation and create a comprehensive summary.

Return ONLY a valid JSON object with this structure:
{
  "summary": "A 2-4 sentence summary of the main topics, insights, and outcomes of this conversation",
  "topics": ["topic1", "topic2", "topic3"],
  "key_points": ["important point 1", "important point 2"]
}

SUMMARIZATION GUIDELINES:
- Focus on the main themes and what was discussed
- Capture any important decisions, preferences, or insights revealed
- Include emotional context if relevant (was the user stressed, happy, curious?)
- Topics should be 1-3 words each, representing main subjects discussed
- Key points should capture actionable or memorable information

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

const prompts = {
  createSystemContext,
  buildInsightsPrompt,
  buildSummarizationPrompt,
  buildTopicSummarizationPrompt,
  createTranscriptionPrompt,
  createTitlePrompt,
  createSystemContextWithPrompt
}

export default prompts;

