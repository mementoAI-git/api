import { IMessage } from "../../database/model/message";
import { IUser } from "../../database/model/user";

export interface IPrompt {
  text: string
  attachments?: string[]
}

export interface ITranscribeAudio {
  file_id?: string
}

export interface ConversationContext {
  user: IUser;
  messages: IMessage[];
  lastMessage: IMessage | null;
  lastUserMessage: IMessage | null;
  lastAiMessage: IMessage | null;
  timeSinceLastMessage: number;
}

export interface IUserInsights {
  communication_style?: 'formal' | 'casual' | 'friendly' | 'professional';
  topics_of_interest?: string[];
  conversation_tone?: 'upbeat' | 'calm' | 'analytical' | 'creative';
  emoji_preference?: boolean;
  response_length?: 'short' | 'medium' | 'long';
  important_notes?: string[];
  key_preferences?: string[];
  emotional_state_trends?: string[];
  goals_and_aspirations?: string[];
}

export interface IConversationAnalysis {
  user_insights: IUserInsights;
  conversation_summary: string;
  learning_notes: string[];
}

export interface IStartMemory {
  text: string
  prompt_id?: string
  attachments?: string[]
}