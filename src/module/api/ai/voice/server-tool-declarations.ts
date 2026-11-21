import {Behavior, FunctionDeclaration, Type} from '@google/genai';
import {CHAT_TOOL_DECLARATIONS} from '../chat-tools/declarations';

/**
 * Declarations of the tools Memento runs on the server during a voice call
 * (see server-tools.ts for what they do). Kept free of database and service
 * imports so the session config can include them cheaply.
 */

export const UPDATE_PROFILE_TOOL_NAME = 'update_profile';
export const OPEN_STORY_TOOL_NAME = 'open_story';
export const UNDO_LAST_ACTION_TOOL_NAME = 'undo_last_action';

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
  {
    name: 'save_story',
    behavior: Behavior.BLOCKING,
    description:
      'Save something the host told you as a new story in Memento, when they ask ("save that as a story"). Use their own words for the body; keep them, do not summarise. In chat, photos or files sent with the message are saved with it, so the body may be left out for "save this photo". The app opens the saved story.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'A short title, theirs if they gave one.',
        },
        body: {type: Type.STRING, description: 'The story in their words.'},
      },
    },
  },
  {
    name: 'quick_note',
    behavior: Behavior.BLOCKING,
    description:
      'Jot down a quick note for the host when they ask ("make a note that…", "remind me I…"), as a quick capture in Memento.',
    parameters: {
      type: Type.OBJECT,
      properties: {text: {type: Type.STRING}},
      required: ['text'],
    },
  },
  {
    name: 'remember_fact',
    behavior: Behavior.BLOCKING,
    description:
      'Save a fact about the host when they ask you to remember it ("remember that…", "add this as a fact", "save this to your memory"). It goes straight into what you know about them and appears in their Observations. For a story or a note they asked to save, use save_story or quick_note instead.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fact: {
          type: Type.STRING,
          description: 'What to remember, in their own words.',
        },
      },
      required: ['fact'],
    },
  },
  {
    name: 'forget_observation',
    behavior: Behavior.BLOCKING,
    description:
      'Remove something you keep about the host, shown in their Observations or Preferences, when they ask you to forget it ("forget that…", "delete that observation", "take that off my preferences"). Needs confirmation: the first call only reads it back with a code.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description:
            'The heading of the observation, or words from what it says.',
        },
        confirmation: {
          type: Type.STRING,
          description:
            'Leave out the first time. After the host confirms the read-back, the code from the first result.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'explain_observation',
    behavior: Behavior.BLOCKING,
    description:
      'Tell the host where something you keep about them came from, when they ask why you think it or how you know ("why do you think I…", "where did you get that?"). Returns the observation and the stories and conversations it was drawn from. Changes nothing.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description:
            'The heading of the observation, or words from what it says.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'open_insight',
    behavior: Behavior.BLOCKING,
    description:
      'Show one of the things you keep about the host (an observation in their Insights) on screen, when they ask to see it ("show me what you noticed about my work").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description:
            'The heading of the observation, or words from what it says.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'correct_observation',
    behavior: Behavior.BLOCKING,
    description:
      'Correct something you keep about the host, shown in their Observations or Preferences, when they say it is wrong or has changed ("that\'s not right, I…", "I changed my mind about that"). Write what it should say now, in their words. To remove it entirely, use forget_observation instead.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description:
            'The heading of the observation, or words from what it says now.',
        },
        note: {
          type: Type.STRING,
          description: 'What it should say instead, in their words.',
        },
        heading: {
          type: Type.STRING,
          description:
            'A new short heading, only if the old one no longer fits.',
        },
      },
      required: ['query', 'note'],
    },
  },
  {
    name: 'edit_story',
    behavior: Behavior.BLOCKING,
    description:
      'Change the words of one of the host\'s saved stories when they ask. append (the normal case) adds their words to the end ("add to my Lagos story that…"). replace swaps the whole text, only when they ask to rewrite or correct the whole story; pass the complete new text, keeping every part they did not ask to change. replace needs confirmation: the first call only reads it back with a code. The app opens the story.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Words from the story title or what it is about.',
        },
        text: {
          type: Type.STRING,
          description:
            'For append, the words to add. For replace, the whole new text.',
        },
        mode: {type: Type.STRING, enum: ['append', 'replace']},
        confirmation: {
          type: Type.STRING,
          description:
            'Only for replace. Leave out the first time. After the host confirms the read-back, the code from the first result.',
        },
      },
      required: ['query', 'text'],
    },
  },
  {
    name: 'share_story',
    behavior: Behavior.BLOCKING,
    description:
      'Share one of the host\'s stories with particular connections or groups, by name, when they ask ("share my Lagos story with my sister"). Only the people and groups it is shared with can see it; it never makes a story public. Needs confirmation: the first call only reads it back with a code.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Words from the story title or what it is about.',
        },
        with: {
          type: Type.ARRAY,
          items: {type: Type.STRING},
          description: 'Names of their connections or groups.',
        },
        confirmation: {
          type: Type.STRING,
          description:
            'Leave out the first time. After the host confirms the read-back, the code from the first result.',
        },
      },
      required: ['query', 'with'],
    },
  },
  {
    name: 'set_story_visibility',
    behavior: Behavior.BLOCKING,
    description:
      'Change who can see one of the host\'s stories, when they ask. only_me makes it private to them and stops sharing it with anyone ("make it private"). everyone lets all their connections see it; use it only when they explicitly ask for everyone. everyone needs confirmation: the first call only reads it back with a code.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Words from the story title or what it is about.',
        },
        visibility: {type: Type.STRING, enum: ['only_me', 'everyone']},
        confirmation: {
          type: Type.STRING,
          description:
            'Only for everyone. Leave out the first time. After the host confirms the read-back, the code from the first result.',
        },
      },
      required: ['query', 'visibility'],
    },
  },
  {
    name: 'bookmark_story',
    behavior: Behavior.BLOCKING,
    description:
      "Bookmark one of the host's stories, or remove its bookmark, when they ask.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Words from the story title or what it is about.',
        },
        bookmarked: {
          type: Type.BOOLEAN,
          description: 'False to remove the bookmark.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'tag_story',
    behavior: Behavior.BLOCKING,
    description:
      "Add or remove tags on one of the host's stories, when they ask.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Words from the story title or what it is about.',
        },
        add: {type: Type.ARRAY, items: {type: Type.STRING}},
        remove: {type: Type.ARRAY, items: {type: Type.STRING}},
      },
      required: ['query'],
    },
  },
  {
    name: 'rename_story',
    behavior: Behavior.BLOCKING,
    description:
      "Change the title of one of the host's stories, when they ask.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Words from the current title or what it is about.',
        },
        title: {type: Type.STRING, description: 'The new title.'},
      },
      required: ['query', 'title'],
    },
  },
  {
    name: 'draft_capsule',
    behavior: Behavior.BLOCKING,
    description:
      'Start a time capsule as a draft, when the host asks: a title, the message in their words, and optionally which of their connections it is for. It is only a draft; nothing is sent or scheduled.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {type: Type.STRING},
        message: {
          type: Type.STRING,
          description: 'The message in their words.',
        },
        recipient: {
          type: Type.STRING,
          description: "A connection's name, if they said who it is for.",
        },
      },
      required: ['title', 'message'],
    },
  },
  {
    name: 'schedule_capsule',
    behavior: Behavior.BLOCKING,
    description:
      "Schedule one of the host's draft time capsules for delivery on a date. Needs confirmation: the first call only reads it back with a code.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        capsule: {
          type: Type.STRING,
          description: 'Words from the capsule title.',
        },
        date: {
          type: Type.STRING,
          description: 'Delivery date as YYYY-MM-DD, in the future.',
        },
        confirmation: {
          type: Type.STRING,
          description:
            'Leave out the first time. After the host confirms the read-back, the code from the first result.',
        },
      },
      required: ['capsule', 'date'],
    },
  },
  {
    name: 'add_connection',
    behavior: Behavior.BLOCKING,
    description:
      "Add someone as one of the host's connections, which emails them an invitation. Needs their name and email. Needs confirmation: the first call only reads it back with a code.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {type: Type.STRING},
        email: {
          type: Type.STRING,
          description: 'Spell it back to the host before calling.',
        },
        relationship: {
          type: Type.STRING,
          description: 'For example sister, son, friend.',
        },
        confirmation: {
          type: Type.STRING,
          description:
            'Leave out the first time. After the host confirms the read-back, the code from the first result.',
        },
      },
      required: ['name', 'email'],
    },
  },
  {
    name: 'delete_story',
    behavior: Behavior.BLOCKING,
    description:
      "Delete one of the host's stories, only when they clearly ask. Needs confirmation: the first call only reads it back with a code.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Words from the story title or what it is about.',
        },
        confirmation: {
          type: Type.STRING,
          description:
            'Leave out the first time. After the host confirms the read-back, the code from the first result.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'send_feedback',
    behavior: Behavior.BLOCKING,
    description:
      'Send feedback from the host to the Memento team, when they ask. Needs confirmation: the first call only reads it back with a code.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        message: {
          type: Type.STRING,
          description: 'Their feedback in their words.',
        },
        confirmation: {
          type: Type.STRING,
          description:
            'Leave out the first time. After the host confirms the read-back, the code from the first result.',
        },
      },
      required: ['message'],
    },
  },
  {
    name: UNDO_LAST_ACTION_TOOL_NAME,
    behavior: Behavior.BLOCKING,
    description:
      'Reverse the last thing you did for the host (a profile change, a save, a rename, an edit to a story, tags, a bookmark, a share or visibility change, a corrected observation, a capsule, a deleted story, a new connection) when they say "undo that", "change it back" or "put it back". Each call undoes one action, newest first, from the last half hour. Feedback that was sent cannot be unsent.',
  },
];

/**
 * Read-only lookups shared with chat (handlers in ../chat-tools/tools), so
 * voice and chat can look up the same things. Voice keeps its own
 * search_memories (forwarded by the app) and explain_observation.
 */
export const SHARED_READ_TOOL_NAMES = [
  'read_story',
  'list_stories',
  'list_observations',
  'list_people',
  'who_can_see_story',
  'get_share_link',
  'read_link',
  'suggest_topics',
] as const;

/** JSON Schema as Gemini's schema (Type.OBJECT and so on). */
function geminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(geminiSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      key === 'type' && typeof inner === 'string'
        ? (inner.toUpperCase() as Type)
        : geminiSchema(inner),
    ]),
  );
}

const VOICE_NOTES: Partial<Record<string, string>> = {
  get_share_link:
    " By voice, never read a link aloud: say whether it has a public link and that they can copy it from the story's Share option.",
  read_link: ' Use it when they ask about a page they shared in the chat.',
};

export const SHARED_READ_DECLARATIONS: FunctionDeclaration[] =
  CHAT_TOOL_DECLARATIONS.filter(tool =>
    (SHARED_READ_TOOL_NAMES as readonly string[]).includes(tool.name),
  ).map(tool => {
    const parameters = geminiSchema(tool.parameters) as {
      properties?: Record<string, unknown>;
    };
    return {
      name: tool.name,
      behavior: Behavior.BLOCKING,
      description: tool.description + (VOICE_NOTES[tool.name] ?? ''),
      // An empty object schema is not accepted for a tool with no arguments.
      ...(parameters.properties && Object.keys(parameters.properties).length
        ? {parameters: parameters as FunctionDeclaration['parameters']}
        : {}),
    };
  });

SERVER_TOOL_DECLARATIONS.push(...SHARED_READ_DECLARATIONS);

export const SERVER_TOOL_NAMES = SERVER_TOOL_DECLARATIONS.map(
  declaration => declaration.name as string,
);
