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