import {Behavior, FunctionDeclaration, Type} from '@google/genai';

/**
 * Tools the app runs itself on the screen in front of the host: scroll, go
 * back, and press a button by its label. Locked into the session only for
 * builds that send the screen_control capability. Blocking, so Gemini waits
 * for the result before saying what happened.
 */

export const SCREEN_CONTROL_CAPABILITY = 'screen_control';

export const SCREEN_CONTROL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'scroll',
    behavior: Behavior.BLOCKING,
    description:
      'Scroll the screen the host is looking at, when they ask: up, down, to the top or to the bottom.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        direction: {type: Type.STRING, enum: ['up', 'down', 'top', 'bottom']},
      },
      required: ['direction'],
    },
  },
  {
    name: 'go_back',
    behavior: Behavior.BLOCKING,
    description:
      'Go back to the previous screen in the app, when the host asks to go back.',
  },
  {
    name: 'press_button',
    behavior: Behavior.BLOCKING,
    description:
      'Press a button on the screen the host is looking at, by the words on it, when they ask (for example "tap Save"). If the result lists the buttons on screen, ask the host which one they meant.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        label: {
          type: Type.STRING,
          description: 'The words on the button, as the host said them.',
        },
        turn_on: {
          type: Type.BOOLEAN,
          description:
            'Only for switches and options: true when the host wants it on or selected, false when they want it off. Leave out for ordinary buttons.',
        },
        which: {
          type: Type.INTEGER,
          description:
            'Only when the result said several buttons have these words and the host said which: 1 for the first on screen, 2 for the second, and so on.',
        },
      },
      required: ['label'],
    },
  },
];

export const SCREEN_CONTROL_TOOL_NAMES = SCREEN_CONTROL_DECLARATIONS.map(
  declaration => declaration.name as string,
);

/**
 * Builds that can read the screen and type into its fields. A separate
 * capability, so builds with only screen_control are never offered tools
 * they cannot run.
 */
export const SCREEN_FIELDS_CAPABILITY = 'screen_fields';

export const SCREEN_FIELDS_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'look_at_screen',
    behavior: Behavior.BLOCKING,
    description:
      'See the screen the host is looking at: its name, what it says (a prompt, a story, the latest messages, a list), its fields and what is in them, and its buttons. Use it when they ask what is on screen or to read something, and before typing or pressing when you are not sure what is there.',
  },
  {
    name: 'type_text',
    behavior: Behavior.BLOCKING,
    description:
      'Type into a field on the screen in front of the host, so they see the words appear: a chat message, a reply to a prompt, a story, a title, a note, a profile field. Use their own words exactly. Adds to what is there unless mode is replace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: {
          type: Type.STRING,
          description: 'The words to type, exactly as the host said them.',
        },
        field: {
          type: Type.STRING,
          description:
            'Which field, by its name from look_at_screen ("message", "title", "story", "note", "Nickname"). Leave out when the screen has one field.',
        },
        mode: {
          type: Type.STRING,
          enum: ['append', 'replace'],
          description:
            'append (default) adds after what is there, for dictation; replace swaps the whole field, for "change the title to …".',
        },
        send: {
          type: Type.BOOLEAN,
          description:
            'True only when the host asked to send it ("send it", "send that"). Sends the message after typing.',
        },
      },
      required: ['text'],
    },
  },
];

export const SCREEN_FIELDS_TOOL_NAMES = SCREEN_FIELDS_DECLARATIONS.map(
  declaration => declaration.name as string,
);
