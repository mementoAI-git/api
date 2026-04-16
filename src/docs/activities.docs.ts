const activitiesDocs = {
  '/activities': {
    get: {
      tags: ['Activities'],
      summary: 'Get User Activities',
      description:
        'Get paginated list of user activities (login, memory creation, etc.)',
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
          description: 'Activities retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Activities retrieved successfully',
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
                            action: {
                              type: 'string',
                              enum: [
                                'login',
                                'memory_created',
                                'memory_updated',
                                'capsule_created',
                                'profile_updated',
                              ],
                              example: 'login',
                            },
                            description: {
                              type: 'string',
                              example: 'User logged in',
                            },
                            metadata: {
                              type: 'object',
                              nullable: true,
                              description: 'Additional activity metadata',
                            },
                            created_at: {
                              type: 'string',
                              format: 'date-time',
                              example: '2024-01-01T00:00:00.000Z',
                            },
                          },
                        },
                      },
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
    delete: {
      tags: ['Activities'],
      summary: 'Clear User Activities',
      description: 'Clear all activities for the authenticated user',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Activities cleared successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Activities cleared successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      cleared: {type: 'boolean', example: true},
                      count: {type: 'number', example: 100},
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
};

export default activitiesDocs;
