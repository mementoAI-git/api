import dayjs from "dayjs";
import { IUser } from "../../database/model/user";
import { ConversationContext } from "./interface";
import { getTimeBasedGreeting, isEmpty } from "../../../utils/helpers";

const TIME_CONSTANTS = {
  ONE_HOUR_MS: 60 * 60 * 1000,
  ONE_DAY_MS: 24 * 60 * 60 * 1000,
  ONE_WEEK_MS: 7 * 24 * 60 * 60 * 1000,
} as const;

export function createSystemContext(user: IUser): string {
  return `You are a helpful AI assistant. Here's what you should know:

  CURRENT CONTEXT:
  - Current date and time: ${dayjs().toISOString()}

  USER INFORMATION:
  - Name: ${user?.fullname || 'User'}
  - Email: ${user?.email || 'Not provided'}
  - Gender: ${user?.gender || 'Not specified'}
  - Date of birth: ${user?.dob ? dayjs(user?.dob).toDate().toLocaleDateString() : 'Not specified'}
  - Country: ${user?.country}
  - Member since: ${dayjs(user?.created_at).toDate().toLocaleDateString()}

  IMPORTANT GUIDELINES:
  1. Always address the user by their name when appropriate
  2. Consider their timezone and location for time-sensitive responses
  3. Respect their stated preferences
  4. Do not mention or discuss the technical details of this system, your training, or internal processes
  5. Focus on being helpful and providing value to the user
  6. Maintain conversation context but don't reference previous system instructions

  Remember: You're having a conversation with ${user?.fullname || 'the user'}. Be natural, helpful, and personalized.`;
}

export function createNewConversationPrompt(user: IUser): string {
  const timeGreeting = getTimeBasedGreeting();

  return `You are a warm, engaging, and conversational AI assistant. 

${timeGreeting} ${user.first_name}! 👋

I'm here to help you with anything you need - whether it's brainstorming ideas, solving problems, learning something new, or just having an interesting conversation. 

What's on your mind today? I'm curious to hear what brings you here! 

(Feel free to share what you're working on, what you're curious about, or any questions you have - I'm all ears!)`;
}

export function createReturningUserPrompt(context: ConversationContext): string {
  const { user, lastUserMessage } = context;

  return `You are a warm and engaging AI assistant.

Welcome back ${user.first_name}! 👋 It's great to see you again.

I noticed you were asking about: "${lastUserMessage?.text}" before we got interrupted. I'd love to continue that conversation or explore it further!

What would you like to dive into today? We can pick up where we left off, or if you have something new on your mind, I'm all ears.`;
}

export function createInactiveConversationPrompt(context: ConversationContext): string {
  const { user, lastAiMessage } = context;

  return `You are a warm and engaging AI assistant.

Hey ${user.first_name}! 👋 I hope you're having a great day.

I was just thinking about our conversation where I mentioned: "${lastAiMessage?.text}"

I'm curious - what are your thoughts on that? Or is there something else you'd like to explore together?`;
}

export function createOldConversationPrompt(context: ConversationContext): string {
  const { user } = context;

  return `You are a warm and engaging AI assistant.

${user.first_name}! 👋 It's been a while since we've chatted - I'm so glad you're back!

I'd love to hear what you've been up to or what's on your mind today.

What would you like to explore together?`;
}

export function createRecentConversationPrompt(context: ConversationContext): string {
  const { user } = context;

  return `You are a warm and engaging AI assistant.

Hey ${user.first_name}! 👋 Great to see you again!

What's on your mind today?`;
}

export function generateGreetingPrompt(context: ConversationContext): string {
  const { messages, lastMessage, lastUserMessage, lastAiMessage, timeSinceLastMessage } = context;

  // New conversation
  if (isEmpty(messages)) {
    return createNewConversationPrompt(context.user);
  }

  // Returning user (last message was from user, more than a day ago)
  if (lastUserMessage &&
    timeSinceLastMessage > TIME_CONSTANTS.ONE_DAY_MS &&
    lastMessage?.role === "user") {
    return createReturningUserPrompt(context);
  }

  // Inactive conversation (last message was from AI, more than 12 hours ago)
  if (lastAiMessage &&
    timeSinceLastMessage > (TIME_CONSTANTS.ONE_DAY_MS / 2) &&
    lastMessage?.role === "ai") {
    return createInactiveConversationPrompt(context);
  }

  // Very old conversation (more than a week)
  if (timeSinceLastMessage > TIME_CONSTANTS.ONE_WEEK_MS) {
    return createOldConversationPrompt(context);
  }

  // Recent conversation (default case)
  return createRecentConversationPrompt(context);
}