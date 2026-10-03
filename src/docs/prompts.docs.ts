const promptsDocs = {
  '/prompts': {
    get: {
      tags: ['Prompts'],
      summary: 'Get All Prompts',
      description:
        'Get list of available prompts. Results are cached for performance.',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Prompts retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Prompts retrieved successfully',
                  },
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        _id: {
                          type: 'string',
                          example: '507f1f77bcf86cd799439011',
                        },
                        title: {type: 'string', example: 'Daily Reflection'},
                        description: {
                          type: 'string',
                          example: 'Reflect on your day',
                        },
                        category: {type: 'string', example: 'reflection'},
                        active: {type: 'boolean', example: true},
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
  '/prompts/{id}': {
    get: {
      tags: ['Prompts'],
      summary: 'Get Prompt Details',
      description: 'Get detailed information about a specific prompt',
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
          description: 'Prompt details retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Prompt details retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      _id: {
                        type: 'string',
                        example: '507f1f77bcf86cd799439011',
                      },
                      title: {type: 'string', example: 'Daily Reflection'},
                      description: {
                        type: 'string',
                        example: 'Reflect on your day',
                      },
                      body: {
                        type: 'string',
                        example: 'Tell me about your day...',
                      },
                      category: {type: 'string', example: 'reflection'},
                      active: {type: 'boolean', example: true},
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
          description: 'Invalid prompt ID',
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
          description: 'Prompt not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/prompts/reply': {
    post: {
      tags: ['Prompts'],
      summary: 'Reply to Prompt',
      description:
        'Reply to a prompt and create a memory. Supports file uploads.',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['prompt_id'],
              properties: {
                prompt_id: {
                  type: 'string',
                  description: 'Prompt ID to reply to',
                  example: '507f1f77bcf86cd799439011',
                },
                body: {
                  type: 'string',
                  description: 'Response body/text',
                  example: 'This is my response to the prompt...',
                },
                tags: {
                  type: 'array',
                  items: {type: 'string'},
                  description:
                    'Array of tags (comma-separated string or array)',
                  example: ['reflection', 'daily'],
                },
                level: {
                  type: 'integer',
                  minimum: 1,
                  description: 'Memory importance level',
                  example: 1,
                },
                attachments: {
                  type: 'array',
                  items: {type: 'string'},
                  description:
                    'Array of file IDs (comma-separated string or array)',
                  example: ['507f1f77bcf86cd799439012'],
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Prompt replied successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Prompt replied successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      _id: {
                        type: 'string',
                        example: '507f1f77bcf86cd799439011',
                      },
                      prompt: {
                        type: 'string',
                        example: '507f1f77bcf86cd799439013',
                      },
                      user: {
                        type: 'string',
                        example: '507f1f77bcf86cd799439012',
                      },
                      body: {type: 'string', example: 'This is my response...'},
                      tags: {type: 'array', items: {type: 'string'}},
                      level: {type: 'number', example: 1},
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
        404: {
          description: 'Prompt not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/prompts/reply/{id}': {
    get: {
      tags: ['Prompts'],
      summary: 'Get User Prompt Response',
      description: 'Get a specific user response to a prompt',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Prompt response ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      responses: {
        200: {
          description: 'Prompt response retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Prompt response retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      _id: {
                        type: 'string',
                        example: '507f1f77bcf86cd799439011',
                      },
                      prompt: {
                        type: 'object',
                        properties: {
                          _id: {
                            type: 'string',
                            example: '507f1f77bcf86cd799439013',
                          },
                          title: {type: 'string', example: 'Daily Reflection'},
                        },
                      },
                      user: {
                        type: 'string',
                        example: '507f1f77bcf86cd799439012',
                      },
                      body: {type: 'string', example: 'This is my response...'},
                      tags: {type: 'array', items: {type: 'string'}},
                      level: {type: 'number', example: 1},
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
          description: 'Invalid response ID',
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
          description: 'Prompt response not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/prompts/suggestions': {
    get: {
      tags: ['Prompts'],
      summary: 'Get Prompt Suggestions',
      description: 'Get personalized prompt suggestions for the user',
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
          description: 'Suggestions retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Suggestions retrieved successfully',
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
  '/prompts/suggestions/overview': {
    get: {
      tags: ['Prompts'],
      summary: 'Get Suggestions Overview',
      description:
        'Get an overview of prompt suggestions grouped by category or theme',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Overview retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {type: 'object'},
                },
              },
            },
          },
        },
      },
    },
  },
  '/prompts/categories': {
    get: {
      tags: ['Prompts'],
      summary: 'List Explore categories',
      description:
        'Returns the ordered canonical Explore taxonomy. Legacy aliases are accepted by category detail routes but are not returned here.',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Explore categories retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        slug: {type: 'string', example: 'growing-up'},
                        title: {type: 'string', example: 'Growing Up'},
                        description: {type: 'string'},
                        order: {type: 'number'},
                        starterTotal: {type: 'number', example: 10},
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
  },
  '/prompts/categories/{id}': {
    get: {
      tags: ['Prompts'],
      summary: 'Get Prompts by Category',
      description: 'Get paginated list of prompts in a specific category',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Category ID',
          schema: {type: 'string', example: 'growing-up'},
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
          description: 'Prompts retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Prompts retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      docs: {type: 'array', items: {type: 'object'}},
                      totalDocs: {type: 'number', example: 15},
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
        400: {
          description: 'Invalid category ID',
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
          description: 'Category not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/prompts/{id}/feedback': {
    post: {
      tags: ['Prompts'],
      summary: 'Save Explore question feedback',
      description:
        'Stores skipped as weak feedback or not-relevant as strong negative feedback for the authenticated user.',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: {type: 'string'},
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['status'],
              properties: {
                status: {
                  type: 'string',
                  enum: ['skipped', 'not-relevant'],
                },
              },
            },
          },
        },
      },
      responses: {
        200: {description: 'Explore question feedback saved'},
        403: {description: 'Generated prompt belongs to another user'},
      },
    },
  },
};

export default promptsDocs;
