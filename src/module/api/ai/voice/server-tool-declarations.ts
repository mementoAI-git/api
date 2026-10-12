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
  {
    name: 'save_story',
    behavior: Behavior.BLOCKING,
    description:
      'Save something the host told you as a new story in Memento, when they ask ("save that as a story"). Use their own words for the body; keep them, do not summarise. The app opens the saved story.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'A short title, theirs if they gave one.',
        },
        body: {type: Type.STRING, description: 'The story in their words.'},
      },
      required: ['body'],
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
      'Start a time capsule as a draft, when the host asks: a title, the message in their words, and optionally which of their beneficiaries it is for. It is only a draft; nothing is sent or scheduled.',
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
          description: "A beneficiary's name, if they said who it is for.",
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
    name: 'add_beneficiary',
    behavior: Behavior.BLOCKING,
    description:
      "Add someone as one of the host's beneficiaries, which emails them an invitation. Needs their name and email. Needs confirmation: the first call only reads it back with a code.",
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
];

export const SERVER_TOOL_NAMES = SERVER_TOOL_DECLARATIONS.map(
  declaration => declaration.name as string,
);
