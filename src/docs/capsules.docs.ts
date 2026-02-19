const capsulesDocs = {
  '/capsule': {
    post: {
      tags: ['Capsules'],
      summary: 'Create Time Capsule',
      description: 'Create a new time capsule that will be delivered to recipients on the specified date',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['recipients', 'title', 'body'],
              properties: {
                recipients: {
                  type: 'array',
                  items: {
                    type: 'string',
                    format: 'email',
                  },
                  description: 'Array of recipient email addresses',
                  example: ['recipient1@example.com', 'recipient2@example.com'],
                },
                title: {
                  type: 'string',
                  description: 'Capsule title',
                  example: 'Future Message to Myself',
                },
                body: {
                  type: 'string',
                  description: 'Capsule content/body',
                  example: 'This is a message I want to send to my future self...',
                },
                schedule_date: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Optional date and time when the capsule should be scheduled for delivery (ISO 8601 format). If provided, status will be set to "scheduled", otherwise "draft"',
                  example: '2025-12-31T23:59:59.000Z',
                },
                attachments: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Optional array of file IDs to attach to the capsule',
                  example: ['507f1f77bcf86cd799439011'],
                },
                memories: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Optional array of memory IDs to attach to the capsule',
                  example: ['507f1f77bcf86cd799439012'],
                },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Capsule created successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Capsule created successfully' },
                  data: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
                      user: { type: 'string', example: '507f1f77bcf86cd799439012' },
                      recipients: {
                        type: 'array',
                        items: { type: 'string' },
                        example: ['recipient1@example.com'],
                      },
                      title: { type: 'string', example: 'Future Message to Myself' },
                      body: { type: 'string', example: 'This is a message...' },
                      schedule_date: { type: 'string', format: 'date-time', example: '2025-12-31T23:59:59.000Z' },
                      status: { type: 'string', example: 'scheduled' },
                      attachments: { type: 'array', items: { type: 'string' } },
                      memories: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            _id: { type: 'string', example: '507f1f77bcf86cd799439012' },
                            title: { type: 'string', example: 'My Memory' },
                            body: { type: 'string', example: 'Memory content...' },
                            tags: { type: 'array', items: { type: 'string' }, example: ['tag1', 'tag2'] },
                            created_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
                          },
                        },
                      },
                      created_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
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
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
    get: {
      tags: ['Capsules'],
      summary: 'Get All Capsules',
      description: 'Get paginated list of time capsules. Returns sent capsules by default. Use status=received to list capsules received as a beneficiary.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'page',
          in: 'query',
          schema: { type: 'number', default: 1 },
          description: 'Page number',
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'number', default: 10 },
          description: 'Items per page',
        },
        {
          name: 'status',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['scheduled', 'draft', 'delivered', 'failed', 'pause', 'received'],
          },
          description: 'Filter capsules by status. Use status=received for capsules received as a beneficiary.',
          example: 'scheduled',
        },
        {
          name: 'search',
          in: 'query',
          schema: { type: 'string' },
          description: 'Search capsules by title or body content',
          example: 'birthday',
        },
      ],
      responses: {
        200: {
          description: 'Capsules retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Capsules retrieved successfully' },
                  data: {
                    type: 'object',
                    properties: {
                      docs: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
                            user: { type: 'string', example: '507f1f77bcf86cd799439012' },
                            recipients: { type: 'array', items: { type: 'string' } },
                            title: { type: 'string', example: 'Future Message to Myself' },
                            body: { type: 'string', example: 'This is a message...' },
                            schedule_date: { type: 'string', format: 'date-time', example: '2025-12-31T23:59:59.000Z' },
                            status: { type: 'string', enum: ['scheduled', 'draft', 'delivered', 'failed', 'pause', 'received'], example: 'scheduled' },
                            attachments: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
                                  name: { type: 'string', example: 'file-1234567890.jpg' },
                                  url: { type: 'string', example: 'https://example.com/files/file-1234567890.jpg' },
                                },
                              },
                            },
                            memories: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  _id: { type: 'string', example: '507f1f77bcf86cd799439012' },
                                  title: { type: 'string', example: 'My Memory' },
                                  body: { type: 'string', example: 'Memory content...' },
                                  tags: { type: 'array', items: { type: 'string' }, example: ['tag1', 'tag2'] },
                                  created_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
                                  attachments: {
                                    type: 'array',
                                    items: {
                                      type: 'object',
                                      properties: {
                                        _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
                                        name: { type: 'string', example: 'file-1234567890.jpg' },
                                        url: { type: 'string', example: 'https://example.com/files/file-1234567890.jpg' },
                                      },
                                    },
                                  },
                                  status: { type: 'string', example: 'published' },
                                },
                              },
                            },
                            created_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
                            updated_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
                          },
                        },
                      },
                      totalDocs: { type: 'number', example: 10 },
                      limit: { type: 'number', example: 10 },
                      page: { type: 'number', example: 1 },
                      totalPages: { type: 'number', example: 1 },
                      hasNextPage: { type: 'boolean', example: false },
                      hasPrevPage: { type: 'boolean', example: false },
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
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
  },
  '/capsule/stats': {
    get: {
      tags: ['Capsules'],
      summary: 'Get Capsule Statistics',
      description: 'Get statistics about capsules including counts of delivered, scheduled, and draft capsules for the authenticated user',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Capsule statistics retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Capsule statistics retrieved successfully' },
                  data: {
                    type: 'object',
                    properties: {
                      delivered_count: {
                        type: 'number',
                        description: 'Number of delivered capsules',
                        example: 5,
                      },
                      scheduled_count: {
                        type: 'number',
                        description: 'Number of scheduled capsules',
                        example: 10,
                      },
                      draft_count: {
                        type: 'number',
                        description: 'Number of draft capsules',
                        example: 3,
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
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
  },
  '/capsule/{id}': {
    get: {
      tags: ['Capsules'],
      summary: 'Get Capsule by ID',
      description: 'Get a capsule by ID. Works for both sent and received capsules. For received capsules (e.g. from email link), sets viewed_at on first view.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Capsule ID',
          schema: { type: 'string', example: '507f1f77bcf86cd799439011' },
        },
      ],
      responses: {
        200: {
          description: 'Capsule retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Capsule retrieved successfully' },
                  data: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
                      user: { type: 'string', example: '507f1f77bcf86cd799439012' },
                      recipients: { type: 'array', items: { type: 'string' } },
                      title: { type: 'string', example: 'Future Message to Myself' },
                      body: { type: 'string', example: 'This is a message...' },
                      schedule_date: { type: 'string', format: 'date-time', example: '2025-12-31T23:59:59.000Z' },
                      status: { type: 'string', enum: ['scheduled', 'draft', 'delivered', 'failed', 'pause', 'received'], example: 'scheduled' },
                      attachments: {
                        type: 'array',
                        items: {
                          type: 'object',
                          description: 'File attachment (populated with file details, excluding base64)',
                        },
                      },
                      memories: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            _id: { type: 'string', example: '507f1f77bcf86cd799439012' },
                            title: { type: 'string', example: 'My Memory' },
                            body: { type: 'string', example: 'Memory content...' },
                            tags: { type: 'array', items: { type: 'string' }, example: ['tag1', 'tag2'] },
                            created_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
                          },
                        },
                      },
                      created_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
                      updated_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
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
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        404: {
          description: 'Capsule not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
    put: {
      tags: ['Capsules'],
      summary: 'Update Capsule',
      description: 'Update an existing time capsule',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Capsule ID',
          schema: { type: 'string', example: '507f1f77bcf86cd799439011' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                recipients: {
                  type: 'array',
                  items: {
                    type: 'string',
                    format: 'email',
                  },
                  description: 'Array of recipient email addresses',
                },
                title: {
                  type: 'string',
                  description: 'Capsule title',
                },
                body: {
                  type: 'string',
                  description: 'Capsule content/body',
                },
                schedule_date: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Optional date and time when the capsule should be scheduled for delivery (ISO 8601 format). If provided, status will be set to "scheduled"',
                },
                attachments: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of file IDs',
                },
                memories: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Optional array of memory IDs to append to the capsule',
                },
                status: {
                  type: 'string',
                  enum: ['scheduled', 'draft', 'pause'],
                  description: 'Capsule status',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Capsule updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Capsule updated successfully' },
                  data: { type: 'object' },
                },
              },
            },
          },
        },
        400: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        404: {
          description: 'Capsule not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
    delete: {
      tags: ['Capsules'],
      summary: 'Delete Capsule',
      description: 'Delete a time capsule',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Capsule ID',
          schema: { type: 'string', example: '507f1f77bcf86cd799439011' },
        },
      ],
      responses: {
        200: {
          description: 'Capsule deleted successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Capsule deleted successfully' },
                  data: { type: 'object' },
                },
              },
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        404: {
          description: 'Capsule not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
  },
};

export default capsulesDocs;

