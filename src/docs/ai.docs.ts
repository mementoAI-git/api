const aiDocs = {
  '/ai/prompt': {
    post: {
      tags: ['AI'],
      summary: 'Send AI Prompt',
      description:
        'Send a prompt to the AI and receive a streaming response. The response is streamed in real-time.',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['text', 'memory'],
              properties: {
                text: {
                  type: 'string',
                  description: 'User prompt text',
                  example: 'Tell me about artificial intelligence',
                },
                memory: {
                  type: 'string',
                  description: 'Memory ID to associate with this conversation',
                  example: '507f1f77bcf86cd799439011',
                },
                attachments: {
                  type: 'array',
                  items: {type: 'string'},
                  description: 'Array of file IDs to include in the prompt',
                  example: ['507f1f77bcf86cd799439012'],
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Streaming response (text/event-stream)',
          content: {
            'text/event-stream': {
              schema: {
                type: 'string',
                description:
                  'Server-Sent Events stream containing AI response chunks',
              },
            },
          },
        },
        400: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/ai/generate-tags': {
    post: {
      tags: ['AI'],
      summary: 'Auto-generate tags for a story',
      description:
        'Generate suggested tags from a story title and/or body using AI. Use this for the "Autogenerate" tags button before creating a memory.',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Story title (optional if body is provided)',
                  example: 'Weekend at the lake',
                },
                body: {
                  type: 'string',
                  description:
                    'Story body/content (optional if title is provided)',
                  example:
                    'Spent the weekend with family, kayaking and grilling...',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Tags generated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Tags generated successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      tags: {
                        type: 'array',
                        items: {type: 'string'},
                        example: [
                          'family',
                          'weekend',
                          'kayaking',
                          'outdoors',
                          'lake',
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description:
            'Validation error (e.g. neither title nor body provided)',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/ai/prompt/greet': {
    post: {
      tags: ['AI'],
      summary: 'Greet User (Deprecated)',
      description:
        'Send a greeting message to the AI. This endpoint is deprecated.',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Streaming response (text/event-stream)',
          content: {
            'text/event-stream': {
              schema: {
                type: 'string',
                description: 'Server-Sent Events stream containing AI greeting',
              },
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/ai/prompt/messages': {
    get: {
      tags: ['AI'],
      summary: 'Get User Messages (Deprecated)',
      description:
        'Get paginated list of user messages. This endpoint is deprecated.',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'page',
          in: 'query',
          schema: {type: 'number', default: 1},
          description: 'Page number',
        },
        {
          name: 'limit',
          in: 'query',
          schema: {type: 'number', default: 10},
          description: 'Items per page',
        },
      ],
      responses: {
        200: {
          description: 'Messages retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Messages retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      docs: {type: 'array', items: {type: 'object'}},
                      totalDocs: {type: 'number', example: 100},
                      limit: {type: 'number', example: 10},
                      page: {type: 'number', example: 1},
                      totalPages: {type: 'number', example: 10},
                      hasNextPage: {type: 'boolean', example: true},
                      hasPrevPage: {type: 'boolean', example: false},
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/ai/prompt/messages/{id}': {
    get: {
      tags: ['AI'],
      summary: 'Get Messages by Conversation ID',
      description: 'Get paginated list of messages for a specific conversation',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Conversation/Memory ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
        {
          name: 'page',
          in: 'query',
          schema: {type: 'number', default: 1},
          description: 'Page number',
        },
        {
          name: 'limit',
          in: 'query',
          schema: {type: 'number', default: 10},
          description: 'Items per page',
        },
      ],
      responses: {
        200: {
          description: 'Messages retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Messages retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      docs: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            _id: {
                              type: 'string',
                              example: '507f1f77bcf86cd799439011',
                            },
                            user: {
                              type: 'string',
                              example: '507f1f77bcf86cd799439012',
                            },
                            text: {
                              type: 'string',
                              example: 'Hello, how are you?',
                            },
                            role: {
                              type: 'string',
                              enum: ['user', 'ai'],
                              example: 'user',
                            },
                            memory: {
                              type: 'string',
                              example: '507f1f77bcf86cd799439013',
                            },
                            is_voice: {type: 'boolean', example: false},
                            duration: {
                              type: 'number',
                              nullable: true,
                              example: null,
                            },
                            created_at: {
                              type: 'string',
                              format: 'date-time',
                              example: '2024-01-01T00:00:00.000Z',
                            },
                          },
                        },
                      },
                      totalDocs: {type: 'number', example: 50},
                      limit: {type: 'number', example: 10},
                      page: {type: 'number', example: 1},
                      totalPages: {type: 'number', example: 5},
                      hasNextPage: {type: 'boolean', example: true},
                      hasPrevPage: {type: 'boolean', example: false},
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Invalid conversation ID',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
        404: {
          description: 'Conversation not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/ai/conversation/new': {
    post: {
      tags: ['AI'],
      summary: 'Start New Conversation',
      description:
        'Start a new conversation with the AI. Creates a new memory and returns conversation details.',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['text'],
              properties: {
                text: {
                  type: 'string',
                  description: 'Initial message text',
                  example: 'Hello, I want to start a conversation',
                },
                prompt_id: {
                  type: 'string',
                  description: 'Optional prompt ID to use as context',
                  example: '507f1f77bcf86cd799439011',
                },
                attachments: {
                  type: 'array',
                  items: {type: 'string'},
                  description: 'Array of file IDs to include',
                  example: ['507f1f77bcf86cd799439012'],
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Conversation started successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Conversation started successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      memory_id: {
                        type: 'string',
                        example: '507f1f77bcf86cd799439011',
                      },
                      session_id: {type: 'string', example: 'session-123'},
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/ai/transcribe-audio': {
    post: {
      tags: ['AI'],
      summary: 'Transcribe Audio',
      description:
        'Transcribe audio file to text. Requires a file_id of an uploaded audio file.',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                file_id: {
                  type: 'string',
                  description: 'File ID of the uploaded audio file',
                  example: '507f1f77bcf86cd799439011',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Audio transcribed successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Audio transcribed successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      transcription: {
                        type: 'string',
                        description: 'Transcribed text',
                        example:
                          'Hello, this is the transcribed text from the audio file.',
                      },
                      file_id: {
                        type: 'string',
                        example: '507f1f77bcf86cd799439011',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Invalid file ID or file is not an audio file',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
        404: {
          description: 'File not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/ai/generate-story-title': {
    post: {
      tags: ['AI'],
      summary: 'Auto-generate story title',
      description:
        'Generate a catchy title for a story/memory from its body content.',
      security: [{bearerAuth: []}],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['body'],
              properties: {
                body: {type: 'string', example: 'The story content...'},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Title generated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {type: 'object', properties: {title: {type: 'string'}}},
                },
              },
            },
          },
        },
      },
    },
  },
  '/ai/ephemeral-token': {
    get: {
      tags: ['AI'],
      summary: 'Get Live Ephemeral Token',
      description:
        'Get an ephemeral token for real-time AI interactions (e.g., LiveKit/WebRTC).',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'memory_id',
          in: 'query',
          required: false,
          schema: {type: 'string'},
          description:
            'Conversation or story the call continues. Ignored if not owned by the caller.',
        },
        {
          name: 'resume_handle',
          in: 'query',
          required: false,
          schema: {type: 'string'},
          description:
            'Latest sessionResumptionUpdate.newHandle from the previous connection. Resumes the same conversation after goAway or a network drop. Valid for 2 hours.',
        },
        {
          name: 'capabilities',
          in: 'query',
          required: false,
          schema: {type: 'string', example: 'memory_search'},
          description:
            'Comma-separated client capabilities. memory_search locks the search_memories tool into the session; call_actions locks end_call, set_microphone and open_screen. Only send a capability from builds that handle those tool calls.',
        },
        {
          name: 'device_model',
          in: 'query',
          required: false,
          schema: {type: 'string'},
          description:
            'Device model name, used for the speaker full-duplex policy.',
        },
      ],
      responses: {
        200: {
          description: 'Token retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {
                    type: 'object',
                    properties: {
                      token: {type: 'string'},
                      expiresAt: {type: 'string', format: 'date-time'},
                      voice: {type: 'object'},
                      live: {type: 'object'},
                      greetingInstruction: {
                        type: 'string',
                        description:
                          'Send as the first client text turn to start the call.',
                      },
                      memoryId: {type: 'string', nullable: true},
                      promptVersion: {type: 'string'},
                      tools: {type: 'array', items: {type: 'string'}},
                      speakerFullDuplex: {type: 'boolean'},
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/ai/voice/turns': {
    post: {
      tags: ['AI'],
      summary: 'Record Voice Turns',
      description:
        'Store spoken turns from a voice call as individual messages. Idempotent per (memory, session_id, index). Call after each completed turn and again on hang-up.',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['session_id', 'turns'],
              properties: {
                session_id: {type: 'string'},
                memory_id: {type: 'string'},
                turns: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['index', 'role', 'text'],
                    properties: {
                      index: {type: 'integer', minimum: 0},
                      role: {type: 'string', enum: ['user', 'ai']},
                      text: {type: 'string'},
                      interrupted: {type: 'boolean'},
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Turns recorded',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {
                    type: 'object',
                    properties: {
                      memory_id: {type: 'string'},
                      inserted: {type: 'integer'},
                      duplicates: {type: 'integer'},
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/ai/voice/memory-search': {
    post: {
      tags: ['AI'],
      summary: 'Voice Memory Search',
      description:
        "Backs the Gemini Live search_memories tool. The app relays the model's tool call here and returns `result` as the tool response. Requires voice mode access.",
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['query'],
              properties: {query: {type: 'string', maxLength: 200}},
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Search result as speakable text',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {
                    type: 'object',
                    properties: {result: {type: 'string'}},
                  },
                },
              },
            },
          },
        },
        402: {description: 'Voice mode requires Pro or Legacy'},
        422: {description: 'Invalid query'},
      },
    },
  },
  '/ai/voice/calls/{sessionId}/end': {
    post: {
      tags: ['AI'],
      summary: 'End Voice Call',
      description:
        "Record that a voice call ended. Saves the real call duration on the call and its messages, then cleans the call's transcript in the background: misheard Host lines are fixed, and non-English or unintelligible ones become `[unclear]`. Originals are kept in `raw_text`. Insights are queued from the cleaned text. Call once on hang-up, after the final turns are recorded. Idempotent.",
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'sessionId',
          in: 'path',
          required: true,
          schema: {type: 'string', maxLength: 128},
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['duration_seconds'],
              properties: {
                memory_id: {type: 'string'},
                duration_seconds: {type: 'number', minimum: 0, maximum: 86400},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Call recorded',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {
                    type: 'object',
                    properties: {
                      session_id: {type: 'string'},
                      memory_id: {type: 'string', nullable: true},
                      duration_seconds: {type: 'integer'},
                      cleanup_status: {
                        type: 'string',
                        enum: [
                          'pending',
                          'running',
                          'done',
                          'failed',
                          'skipped',
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        404: {description: 'Memory not found'},
        422: {description: 'Invalid payload'},
      },
    },
  },
  '/ai/voice/calls/{sessionId}/summary': {
    post: {
      tags: ['AI'],
      summary: 'Summarize Voice Call',
      description:
        'Return the saved summary of a voice call. The first request cleans the transcript if needed, generates the summary and saves it. Later requests return the saved one.',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'sessionId',
          in: 'path',
          required: true,
          schema: {type: 'string', maxLength: 128},
        },
      ],
      responses: {
        200: {
          description: 'Call summary',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {
                    type: 'object',
                    properties: {
                      summary: {
                        type: 'object',
                        properties: {
                          text: {type: 'string'},
                          key_points: {type: 'array', items: {type: 'string'}},
                          generated_at: {type: 'string', format: 'date-time'},
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        404: {description: 'Voice call not found'},
        503: {description: 'The summary could not be generated. Try again.'},
      },
    },
  },
  '/ai/voices': {
    get: {
      tags: ['AI'],
      summary: 'Get Available Voices',
      description: 'List available AI voices for text-to-speech.',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Voices retrieved',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {type: 'array', items: {type: 'object'}},
                },
              },
            },
          },
        },
      },
    },
  },
  '/ai/voice-preview': {
    post: {
      tags: ['AI'],
      summary: 'Get Voice Preview',
      description: 'Generate a short audio preview of a specific voice.',
      security: [{bearerAuth: []}],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['voice_id', 'text'],
              properties: {
                voice_id: {type: 'string'},
                text: {type: 'string'},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Preview generated',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {type: 'object', properties: {url: {type: 'string'}}},
                },
              },
            },
          },
        },
      },
    },
  },
};

export default aiDocs;
