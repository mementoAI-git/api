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
      },
      required: ['label'],
    },
  },
];

export const SCREEN_CONTROL_TOOL_NAMES = SCREEN_CONTROL_DECLARATIONS.map(
  declaration => declaration.name as string,
);
