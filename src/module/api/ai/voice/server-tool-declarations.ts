import {Behavior, FunctionDeclaration, Type} from '@google/genai';

/**
 * Declarations of the tools Memento runs on the server during a voice call
 * (see server-tools.ts for what they do). Kept free of database and service
 * imports so the session config can include them cheaply.
 */

export const UPDATE_PROFILE_TOOL_NAME = 'update_profile';
export const OPEN_STORY_TOOL_NAME = 'open_story';

export const SERVER_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: UPDATE_PROFILE_TOOL_NAME,
    behavior: Behavior.BLOCKING,
    description:
      "Change the host's own profile when they ask: their first name, last name, nickname (what Memento calls them), country, location or birthday. Only include the fields they asked to change. The app then shows their updated profile.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        first_name: {type: Type.STRING},
        last_name: {type: Type.STRING},
        nickname: {type: Type.STRING},
        country: {type: Type.STRING},
        location: {type: Type.STRING, description: 'City or area.'},
        birthday: {type: Type.STRING, description: 'As YYYY-MM-DD.'},
      },
    },
  },
  {
    name: OPEN_STORY_TOOL_NAME,
    behavior: Behavior.BLOCKING,
    description:
      'Open one of the host\'s saved stories on screen when they ask to see it, for example "open my story about Lagos".',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Words from the story title or what it is about.',
        },
      },
      required: ['query'],
    },
  },
];

export const SERVER_TOOL_NAMES = SERVER_TOOL_DECLARATIONS.map(
  declaration => declaration.name as string,
);
