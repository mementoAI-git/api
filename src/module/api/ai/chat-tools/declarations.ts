/**
 * The read-only lookups chat can make (handlers in ./tools). Kept free of
 * database imports so the chooser can load them cheaply.
 */

/** OpenAI-style declarations, as Groq takes them. */
export const CHAT_TOOL_DECLARATIONS = [
  {
    name: 'search_memories',
    description:
      "Search the host's stories, notes and past conversations for something they ask about: a person, place, event, feeling or time.",
    parameters: {
      type: 'object',
      properties: {
        query: {type: 'string', description: 'A short search phrase.'},
        also: {
          type: 'array',
          items: {type: 'string'},
          description: 'Up to 3 other words they might have used.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_story',
    description:
      'Read the full text of one of their saved stories, to quote, summarise or discuss it. Use latest for their most recent story ("my last post").',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Words from the story title or what it is about.',
        },
        latest: {type: 'boolean'},
      },
    },
  },
  {
    name: 'list_stories',
    description:
      'List their saved stories: the most recent, bookmarked ones, ones shared with someone, or ones visible to everyone, optionally between two dates. Use order "oldest" for their first or earliest stories.',
    parameters: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['recent', 'bookmarked', 'shared', 'public'],
        },
        order: {type: 'string', enum: ['newest', 'oldest']},
        from: {type: 'string', description: 'YYYY-MM-DD'},
        to: {type: 'string', description: 'YYYY-MM-DD'},
      },
    },
  },
  {
    name: 'list_observations',
    description:
      'What Memento has noticed and keeps about them (their Observations and Preferences).',
    parameters: {type: 'object', properties: {}},
  },
  {
    name: 'explain_observation',
    description:
      'Why Memento thinks something about them ("why do you think I…", "how do you know that?"): the observation and the stories and conversations behind it.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The observation heading, or words from it.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_people',
    description:
      'Their beneficiaries (with relationship and invitation status) and groups.',
    parameters: {type: 'object', properties: {}},
  },
  {
    name: 'who_can_see_story',
    description: 'Who can currently see one of their stories.',
    parameters: {
      type: 'object',
      properties: {
        query: {type: 'string'},
        latest: {type: 'boolean'},
      },
    },
  },
  {
    name: 'suggest_topics',
    description:
      'Suggest what the host could write or talk about next, from the parts of their life Memento knows least about. Use when they ask what to write about, want a prompt, or seem stuck.',
    parameters: {type: 'object', properties: {}},
  },
  {
    name: 'read_link',
    description:
      'Read a web page the host shared earlier in the conversation, when they ask about it. Links in their latest message are read already. Pages behind a login (LinkedIn, X, Instagram) cannot be read.',
    parameters: {
      type: 'object',
      properties: {url: {type: 'string', description: 'The full link.'}},
      required: ['url'],
    },
  },
  {
    name: 'get_share_link',
    description:
      'The link to share one of their stories, when they ask to share it or for its link. Use latest for their most recent story.',
    parameters: {
      type: 'object',
      properties: {
        query: {type: 'string'},
        latest: {type: 'boolean'},
      },
    },
  },
] as const;

export type ChatToolName = (typeof CHAT_TOOL_DECLARATIONS)[number]['name'];
