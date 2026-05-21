const personaDocs = {
  '/persona/pending-insights': {
    get: {
      tags: ['Persona'],
      summary: 'List Pending Insights',
      description:
        'Retrieve a list of pending insights extracted from user memories that need approval or rejection',
      security: [{bearerAuth: []}],
      responses: {
        200: {
          description: 'Pending insights retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Pending insights retrieved successfully',
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
                        memory: {
                          type: 'string',
                          example: '507f1f77bcf86cd799439012',
                          description: 'ID of the memory the insight was extracted from',
                        },
                        field: {
                          type: 'string',
                          example: 'key_preferences',
                          description: 'The persona field this insight belongs to',
                        },
                        content: {
                          type: 'string',
                          example: 'User prefers dark chocolate over milk chocolate',
                        },
                        source: {
                          type: 'string',
                          example: 'memory',
                        },
                        created_at: {
                          type: 'string',
                          format: 'date-time',
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
  '/persona/pending-insights/{pendingId}/approve': {
    post: {
      tags: ['Persona'],
      summary: 'Approve Pending Insight',
      description:
        'Approve a pending insight and add it to the user\'s persona profile',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'pendingId',
          in: 'path',
          required: true,
          description: 'Pending Insight ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      responses: {
        200: {
          description: 'Insight approved and applied',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {type: 'string', example: 'Insight approved and applied'},
                  data: {type: 'object', nullable: true},
                },
              },
            },
          },
        },
        404: {
          description: 'Pending insight not found',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
      },
    },
  },
  '/persona/pending-insights/{pendingId}/reject': {
    post: {
      tags: ['Persona'],
      summary: 'Reject Pending Insight',
      description: 'Discard a pending insight',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'pendingId',
          in: 'path',
          required: true,
          description: 'Pending Insight ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      responses: {
        200: {
          description: 'Pending insight rejected',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {type: 'string', example: 'Pending insight rejected'},
                  data: {type: 'object', nullable: true},
                },
              },
            },
          },
        },
        404: {
          description: 'Pending insight not found',
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

export default personaDocs;
