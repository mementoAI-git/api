import {PROMPT_VERSION_OVERRIDES} from '../config';

export type PromptTask =
  | 'chat_primary'
  | 'chat_bootstrap'
  | 'onboarding_chat'
  | 'tags_generate'
  | 'transcription';

const DEFAULT_PROMPT_VERSIONS: Record<PromptTask, string> = {
  chat_primary: 'chat_primary_v4',
  chat_bootstrap: 'chat_bootstrap_v2',
  onboarding_chat: 'host_onboarding_chat_v1',
  tags_generate: 'tags_generate_v1',
  transcription: 'transcription_v1',
};
const PROMPT_VERSION_PATTERN = /^[a-z0-9_:-]+v\d+$/i;

/**
 * Runtime prompt version selector.
 * Supports fast rollback by env override without code deploy.
 */
export function getPromptVersion(task: PromptTask) {
  return PROMPT_VERSION_OVERRIDES[task] || DEFAULT_PROMPT_VERSIONS[task];
}

export function getPromptRegistrySnapshot() {
  const tasks = (Object.keys(DEFAULT_PROMPT_VERSIONS) as PromptTask[]).map(
    task => {
      const effective = getPromptVersion(task);
      return {
        task,
        default_version: DEFAULT_PROMPT_VERSIONS[task],
        override_version: PROMPT_VERSION_OVERRIDES[task] || null,
        effective_version: effective,
        valid_version_format: PROMPT_VERSION_PATTERN.test(effective),
      };
    },
  );
  return {
    defaults: DEFAULT_PROMPT_VERSIONS,
    overrides: PROMPT_VERSION_OVERRIDES,
    tasks,
    all_valid: tasks.every(t => t.valid_version_format),
  };
}
