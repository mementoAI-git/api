const feedbackDocs = {
  '/feedback': {
    post: {
      tags: ['Feedback'],
      summary: 'Submit Feedback',
      description: 'Submit user feedback, bug reports, or feature requests',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['type', 'email', 'message'],
              properties: {
                type: {
                  type: 'string',
                  enum: [
                    'Bug',
                    'Feature Request',
                    'UI/UX Issue',
                    'General Feedback',
                    'Other',
                  ],
                  description: 'Type of feedback',
                  example: 'Bug',
                },
                message: {
                  type: 'string',
                  description: 'Feedback message content',
                  maxLength: 5000,
                  example: 'I found a bug in the memory creation flow...',
                },
                email: {
                  type: 'string',
                  format: 'email',
                  description: 'User email for follow-up',
                  example: 'user@example.com',
                },
                screenshot: {
                  type: 'string',
                  description: 'Optional file ID of a screenshot attachment',
                  example: '507f1f77bcf86cd799439011',
                },
                screenshots: {
                  type: 'array',
                  maxItems: 5,
                  uniqueItems: true,
                  items: {
                    type: 'string',
                    pattern: '^[a-fA-F0-9]{24}$',
                  },
                  description:
                    'Up to five image file IDs owned by the authenticated user',
                },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Feedback submitted successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Feedback Sent Successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      _id: {
                        type: 'string',
                        example: '507f1f77bcf86cd799439011',
                      },
                      type: {type: 'string', example: 'Bug'},
                      message: {type: 'string', example: 'Bug description...'},
                      email: {type: 'string', example: 'user@example.com'},
                      screenshot: {
                        type: 'string',
                        example: '507f1f77bcf86cd799439012',
                      },
                      user: {
                        type: 'string',
                        example: '507f1f77bcf86cd799439013',
                      },
                      createdAt: {
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
  },
};

export default feedbackDocs;
