import {
  OR_MODEL_CHAT_FALLBACK,
  OR_MODEL_CHAT_PRIMARY,
  OR_MODEL_TAGS_FALLBACK,
  OR_MODEL_TAGS_PRIMARY
} from "../../utils/config";

export type AiTask = "chat_primary" | "chat_bootstrap" | "onboarding_chat" | "tags_generate" | "title_generate";

export interface TaskRouting {
  primaryModel: string;
  fallbackModel: string;
  timeoutMs: number;
}

const TASK_ROUTING: Record<AiTask, TaskRouting> = {
  chat_primary: {
    primaryModel: OR_MODEL_CHAT_PRIMARY,
    fallbackModel: OR_MODEL_CHAT_FALLBACK,
    timeoutMs: 15_000
  },
  chat_bootstrap: {
    primaryModel: OR_MODEL_CHAT_PRIMARY,
    fallbackModel: OR_MODEL_CHAT_FALLBACK,
    timeoutMs: 15_000
  },
  onboarding_chat: {
    primaryModel: OR_MODEL_CHAT_PRIMARY,
    fallbackModel: OR_MODEL_CHAT_FALLBACK,
    timeoutMs: 15_000
  },
  tags_generate: {
    primaryModel: OR_MODEL_TAGS_PRIMARY,
    fallbackModel: OR_MODEL_TAGS_FALLBACK,
    timeoutMs: 20_000
  },
  title_generate: {
    primaryModel: OR_MODEL_TAGS_PRIMARY,
    fallbackModel: OR_MODEL_TAGS_FALLBACK,
    timeoutMs: 15_000
  }
};

export function getTaskRouting(task: AiTask): TaskRouting {
  return TASK_ROUTING[task];
}
