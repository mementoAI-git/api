const memoriesDocs = {
  '/memories': {
    post: {
      tags: ['Memories'],
      summary: 'Create Memory',
      description:
        'Create a new memory (story or conversation) with optional attachments',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Memory title',
                  example: 'My First Memory',
                },
                body: {
                  type: 'string',
                  description: 'Memory content/body',
                  example: 'This is a memory I want to save...',
                },
                level: {
                  type: 'integer',
                  minimum: 1,
                  description: 'Memory importance level (1-5)',
                  example: 1,
                },
                tags: {
                  type: 'array',
                  items: {type: 'string'},
                  description:
                    'Array of tags (comma-separated string or array)',
                  example: ['family', 'vacation'],
                },
                attachments: {
                  type: 'array',
                  items: {type: 'string'},
                  description:
                    'Array of file IDs (comma-separated string or array)',
                  example: ['507f1f77bcf86cd799439011'],
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Memory created successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Memory created successfully',
                  },
                  data: {
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
                      title: {type: 'string', example: 'My First Memory'},
                      body: {type: 'string', example: 'This is a memory...'},
                      type: {
                        type: 'string',
                        enum: ['story', 'conversation'],
                        example: 'story',
                      },
                      level: {type: 'number', example: 1},
                      tags: {type: 'array', items: {type: 'string'}},
                      attachments: {type: 'array', items: {type: 'string'}},
                      status: {type: 'string', example: 'save'},
                      created_at: {
                        type: 'string',
                        format: 'date-time',
                        example: '2024-01-01T00:00:00.000Z',
                      },
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
    get: {
      tags: ['Memories'],
      summary: 'Get All Memories',
      description:
        'Get paginated list of memories with optional search and tag filtering',
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
        {
          name: 'search',
          in: 'query',
          schema: {type: 'string'},
          description: 'Search term for title or body',
        },
        {
          name: 'tags',
          in: 'query',
          schema: {type: 'string'},
          description: 'Comma-separated tags to filter by',
        },
      ],
      responses: {
        200: {
          description: 'Memories retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Memories retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      docs: {
                        type: 'array',
                        items: {type: 'object'},
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
  '/memories/quick-capture': {
    post: {
      tags: ['Memories'],
      summary: 'Quick Capture Memory',
      description:
        'Quickly capture a memory with minimal details, often used for voice notes or quick text snips.',
      security: [{bearerAuth: []}],
      requestBody: {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                body: {type: 'string', description: 'Memory content'},
                file: {
                  type: 'string',
                  format: 'binary',
                  description: 'Optional voice/image file',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Memory captured successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Memory created successfully',
                  },
                  data: {type: 'object'},
                },
              },
            },
          },
        },
      },
    },
  },
  '/memories/stats': {
    get: {
      tags: ['Memories'],
      summary: 'Get Memory Statistics',
      description: 'Get statistics about user memories',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Statistics retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Statistics retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      total: {type: 'number', example: 50},
                      stories: {type: 'number', example: 30},
                      conversations: {type: 'number', example: 20},
                      bookmarked: {type: 'number', example: 5},
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
  '/memories/conversations': {
    get: {
      tags: ['Memories'],
      summary: 'Get Conversation Memories',
      description: 'Get paginated list of conversation-type memories',
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
          description: 'Conversation memories retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Conversation memories retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      docs: {type: 'array', items: {type: 'object'}},
                      totalDocs: {type: 'number', example: 20},
                      limit: {type: 'number', example: 10},
                      page: {type: 'number', example: 1},
                      totalPages: {type: 'number', example: 2},
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
  '/memories/stories': {
    get: {
      tags: ['Memories'],
      summary: 'Get Story Memories',
      description: 'Get paginated list of story-type memories',
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
          description: 'Story memories retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Story memories retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      docs: {type: 'array', items: {type: 'object'}},
                      totalDocs: {type: 'number', example: 30},
                      limit: {type: 'number', example: 10},
                      page: {type: 'number', example: 1},
                      totalPages: {type: 'number', example: 3},
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
  '/memories/prompt/{id}': {
    get: {
      tags: ['Memories'],
      summary: 'Get Memory by Prompt ID',
      description: 'Get memory associated with a specific prompt',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Prompt ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      responses: {
        200: {
          description: 'Memory retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Memory retrieved successfully',
                  },
                  data: {type: 'object'},
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
        404: {
          description: 'Memory not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/memories/{id}/enrichment': {
    get: {
      tags: ['Memories'],
      summary: 'Get Conversation Enrichment',
      description:
        'Get AI-generated enrichment data for a conversation, such as summaries, key points, and suggested follow-ups.',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Memory ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      responses: {
        200: {
          description: 'Enrichment retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Conversation enrichment retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      summary: {type: 'string'},
                      key_points: {type: 'array', items: {type: 'string'}},
                      sentiment: {type: 'string'},
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
  '/memories/{id}': {
    get: {
      tags: ['Memories'],
      summary: 'Get Memory by ID',
      description: 'Get a specific memory by ID',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Memory ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      responses: {
        200: {
          description: 'Memory retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Memory retrieved successfully',
                  },
                  data: {
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
                      title: {type: 'string', example: 'My First Memory'},
                      body: {type: 'string', example: 'This is a memory...'},
                      type: {
                        type: 'string',
                        enum: ['story', 'conversation'],
                        example: 'story',
                      },
                      level: {type: 'number', example: 1},
                      tags: {type: 'array', items: {type: 'string'}},
                      attachments: {type: 'array', items: {type: 'string'}},
                      status: {type: 'string', example: 'save'},
                      prompt: {type: 'string', nullable: true},
                      session_id: {type: 'string', nullable: true},
                      created_at: {
                        type: 'string',
                        format: 'date-time',
                        example: '2024-01-01T00:00:00.000Z',
                      },
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
        404: {
          description: 'Memory not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
    put: {
      tags: ['Memories'],
      summary: 'Update Memory',
      description: 'Update an existing memory',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Memory ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                title: {type: 'string', example: 'Updated Memory Title'},
                body: {type: 'string', example: 'Updated memory content...'},
                level: {type: 'integer', minimum: 1, example: 2},
                tags: {
                  type: 'array',
                  items: {type: 'string'},
                  description:
                    'Array of tags (comma-separated string or array)',
                },
                attachments: {
                  type: 'array',
                  items: {type: 'string'},
                  description:
                    'Array of file IDs (comma-separated string or array)',
                },
                status: {
                  type: 'string',
                  enum: ['save'],
                  description: 'Memory status',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Memory updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Memory updated successfully',
                  },
                  data: {type: 'object'},
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
        404: {
          description: 'Memory not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
    delete: {
      tags: ['Memories'],
      summary: 'Delete Memory',
      description:
        'Delete a memory (soft delete by default, permanent if delete_permanently is true)',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Memory ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                delete_permanently: {
                  type: 'boolean',
                  default: false,
                  description: 'If true, permanently delete the memory',
                  example: false,
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Memory deleted successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Memory deleted successfully',
                  },
                  data: {type: 'object'},
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
        404: {
          description: 'Memory not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/memories/{id}/restore': {
    post: {
      tags: ['Memories'],
      summary: 'Restore Memory',
      description: 'Restore a soft-deleted memory',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Memory ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      responses: {
        200: {
          description: 'Memory restored successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Memory restored successfully',
                  },
                  data: {type: 'object'},
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
        404: {
          description: 'Memory not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/memories/{id}/bookmark': {
    post: {
      tags: ['Memories'],
      summary: 'Bookmark Memory',
      description: 'Bookmark a memory',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Memory ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      responses: {
        200: {
          description: 'Memory bookmarked successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Memory bookmarked successfully',
                  },
                  data: {type: 'object'},
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
        404: {
          description: 'Memory not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
    delete: {
      tags: ['Memories'],
      summary: 'Unbookmark Memory',
      description: 'Remove bookmark from a memory',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Memory ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      responses: {
        200: {
          description: 'Memory unbookmarked successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Memory unbookmarked successfully',
                  },
                  data: {type: 'object'},
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
        404: {
          description: 'Memory not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/memories/remove-file/{id}': {
    delete: {
      tags: ['Memories'],
      summary: 'Remove File from Memory',
      description: 'Remove a file attachment from a memory',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'File ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      responses: {
        200: {
          description: 'File removed successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'File removed successfully',
                  },
                  data: {type: 'object'},
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
  '/memories/add-message': {
    post: {
      tags: ['Memories'],
      summary: 'Add Message to Memory',
      description: 'Add messages to a memory (for conversation-type memories)',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['messages'],
              properties: {
                messages: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['text', 'role'],
                    properties: {
                      text: {
                        type: 'string',
                        description: 'Message text',
                        example: 'Hello, how are you?',
                      },
                      role: {
                        type: 'string',
                        enum: ['user', 'ai'],
                        description: 'Message role',
                        example: 'user',
                      },
                      is_voice: {
                        type: 'boolean',
                        description: 'Whether the message is a voice message',
                        default: false,
                        example: false,
                      },
                      duration: {
                        type: 'integer',
                        minimum: 0,
                        description: 'Duration in seconds (for voice messages)',
                        example: 30,
                      },
                    },
                  },
                },
                memory_id: {
                  type: 'string',
                  description:
                    'Memory ID (required if session_id is not provided)',
                  example: '507f1f77bcf86cd799439011',
                },
                session_id: {
                  type: 'string',
                  description:
                    'Session ID (required if memory_id is not provided)',
                  example: 'session-123',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Messages added successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Messages added successfully',
                  },
                  data: {type: 'object'},
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
};

export default memoriesDocs;
