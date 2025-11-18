const beneficiariesDocs = {
  '/beneficiaries': {
    post: {
      tags: ['Beneficiaries'],
      summary: 'Create Beneficiary',
      description: 'Create a new beneficiary and send invitation email',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {
                email: {
                  type: 'string',
                  format: 'email',
                  description: 'Beneficiary email address',
                  example: 'beneficiary@example.com',
                },
                level: {
                  type: 'integer',
                  description: 'Access level (1-5)',
                  example: 1,
                },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Beneficiary created and invitation sent successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Beneficiary created successfully' },
                  data: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
                      email: { type: 'string', example: 'beneficiary@example.com' },
                      level: { type: 'number', example: 1 },
                      user: { type: 'string', example: '507f1f77bcf86cd799439012' },
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
      tags: ['Beneficiaries'],
      summary: 'List Beneficiaries',
      description: 'Get paginated list of beneficiaries for the authenticated user',
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
      ],
      responses: {
        200: {
          description: 'Beneficiaries retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Beneficiaries retrieved successfully' },
                  data: {
                    type: 'object',
                    properties: {
                      docs: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
                            email: { type: 'string', example: 'beneficiary@example.com' },
                            level: { type: 'number', example: 1 },
                            user: { type: 'string', example: '507f1f77bcf86cd799439012' },
                            created_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
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
  '/beneficiaries/{id}': {
    put: {
      tags: ['Beneficiaries'],
      summary: 'Update Beneficiary',
      description: 'Update beneficiary information',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Beneficiary ID',
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
                email: {
                  type: 'string',
                  format: 'email',
                  description: 'New email address',
                  example: 'newemail@example.com',
                },
                level: {
                  type: 'integer',
                  description: 'New access level',
                  example: 2,
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Beneficiary updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Beneficiary updated successfully' },
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
          description: 'Beneficiary not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
    delete: {
      tags: ['Beneficiaries'],
      summary: 'Delete Beneficiary',
      description: 'Delete a beneficiary',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Beneficiary ID',
          schema: { type: 'string', example: '507f1f77bcf86cd799439011' },
        },
      ],
      responses: {
        200: {
          description: 'Beneficiary deleted successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Beneficiary deleted successfully' },
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
          description: 'Beneficiary not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
  },
  '/beneficiaries/invite/resend': {
    post: {
      tags: ['Beneficiaries'],
      summary: 'Resend Invitation',
      description: 'Resend invitation email to beneficiary',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {
                email: {
                  type: 'string',
                  format: 'email',
                  description: 'Beneficiary email address',
                  example: 'beneficiary@example.com',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Invitation resent successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Invitation resent successfully' },
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
      },
    },
  },
  '/beneficiaries/invite/accept': {
    post: {
      tags: ['Beneficiaries'],
      summary: 'Accept Invitation',
      description: 'Accept beneficiary invitation and create account',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['invite_id', 'first_name', 'last_name', 'dob'],
              properties: {
                invite_id: {
                  type: 'string',
                  description: 'Invitation ID',
                  example: '507f1f77bcf86cd799439011',
                },
                first_name: {
                  type: 'string',
                  description: 'First name',
                  example: 'Jane',
                },
                last_name: {
                  type: 'string',
                  description: 'Last name',
                  example: 'Doe',
                },
                dob: {
                  type: 'string',
                  format: 'date',
                  description: 'Date of birth',
                  example: '1990-01-01',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Invitation accepted successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Invitation accepted successfully' },
                  data: {
                    type: 'object',
                    properties: {
                      access_token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                      refresh_token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Validation error or invalid invitation',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
  },
  '/beneficiaries/invite/{id}': {
    get: {
      tags: ['Beneficiaries'],
      summary: 'Get Invitation Details',
      description: 'Get invitation details by invitation ID',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Invitation ID',
          schema: { type: 'string', example: '507f1f77bcf86cd799439011' },
        },
      ],
      responses: {
        200: {
          description: 'Invitation details retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Invitation details retrieved successfully' },
                  data: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
                      email: { type: 'string', example: 'beneficiary@example.com' },
                      level: { type: 'number', example: 1 },
                      user: { type: 'string', example: '507f1f77bcf86cd799439012' },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Invalid invitation ID',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        404: {
          description: 'Invitation not found',
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

export default beneficiariesDocs;

