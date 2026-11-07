import {SERVER_TOOL_DECLARATIONS} from '../voice/server-tool-declarations';

/**
 * The voice tools chat may use to act for the host: the same handlers,
 * confirmations and undo as voice (see ../voice/content-actions). A
 * confirmed action's first call only reads it back; chat shows that as a
 * Confirm / Cancel card, and the Confirm button runs it with the code.
 *
 * Left out: open_story and explain_observation (chat has its own read
 * lookups) and the capsule tools (capsules are hidden on web). The wording
 * match in remember.ts stays as the fallback for remembering and forgetting.
 */
export const CHAT_ACTION_NAMES = [
  'update_profile',
  'save_story',
  'remember_fact',
  'forget_observation',
  'quick_note',
  'correct_observation',
  'edit_story',
  'share_story',
  'set_story_visibility',
  'bookmark_story',
  'tag_story',
  'rename_story',
  'add_beneficiary',
  'delete_story',
  'send_feedback',
  'undo_last_action',
] as const;

export type ChatActionName = (typeof CHAT_ACTION_NAMES)[number];

export function isChatAction(name: string): name is ChatActionName {
  return (CHAT_ACTION_NAMES as readonly string[]).includes(name);
}

/** Gemini's schema (Type.OBJECT and so on) as the JSON Schema Groq takes. */
function jsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonSchema);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'type' && typeof inner === 'string')
      out.type = inner.toLowerCase();
    else if (key === 'properties' && inner && typeof inner === 'object') {
      // Chat confirms with a button, never by passing the code itself.
      out.properties = Object.fromEntries(
        Object.entries(inner)
          .filter(([name]) => name !== 'confirmation')
          .map(([name, schema]) => [name, jsonSchema(schema)]),
      );
    } else out[key] = jsonSchema(inner);
  }
  return out;
}

export const CHAT_ACTION_DECLARATIONS = SERVER_TOOL_DECLARATIONS.filter(
  declaration => isChatAction(String(declaration.name)),
).map(declaration => ({
  name: String(declaration.name),
  description: String(declaration.description)
    .replace(
      / ?Needs confirmation: the first call only reads it back with a code\.?/,
      ' Needs the host to confirm with a button.',
    )
    .replace(
      / replace needs confirmation: the first call only reads it back with a code\./,
      ' replace needs the host to confirm with a button.',
    )
    .replace(
      / everyone needs confirmation: the first call only reads it back with a code\./,
      ' everyone needs the host to confirm with a button.',
    ),
  parameters: (declaration.parameters
    ? jsonSchema(declaration.parameters)
    : {type: 'object', properties: {}}) as Record<string, unknown>,
}));

/** A confirmed action waiting for the host's Confirm button. */
export type PendingConfirmation = {
  tool: ChatActionName;
  /** The conversation the card is in. */
  memory: string;
  /** Exactly what was read back, with the code that runs it. */
  args: Record<string, unknown>;
  text: string;
};

export const CONFIRM_FENCE = 'memento-confirm';
/** A card the host has confirmed: shown as done, without buttons. */
export const CONFIRMED_FENCE = 'memento-confirmed';

/** Something chat did straight away, shown under the reply with Undo. */
export type DoneAction = {
  tool: ChatActionName;
  memory: string;
  text: string;
  /** The logged action Undo reverses; absent when it cannot be undone. */
  action?: string;
};

export const DONE_FENCE = 'memento-done';
/** A done card the host has undone. */
export const UNDONE_FENCE = 'memento-undone';

export function doneBlock(done: DoneAction): string {
  return `\n\n\`\`\`${DONE_FENCE}\n${JSON.stringify(done)}\n\`\`\``;
}

/** The card's block, appended to the reply for the apps to show as buttons. */
export function confirmationBlock(pending: PendingConfirmation): string {
  return `\n\n\`\`\`${CONFIRM_FENCE}\n${JSON.stringify(pending)}\n\`\`\``;
}
