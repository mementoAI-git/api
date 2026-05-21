const beneficiariesDocs = {
  '/beneficiaries': {
    post: {
      tags: ['Beneficiaries'],
      summary: 'Create Beneficiary',
      description: 'Create a new beneficiary and send invitation email',
      security: [{bearerAuth: []}],
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
                name: {
                  type: 'string',
                  description: 'Optional name',
                  example: 'Jane Doe',
                },
                relationship: {
                  type: 'string',
                  description: 'Relationship to the user',
                  example: 'spouse',
                  default: 'friend',
                },
                groups: {
                  type: 'array',
                  items: {type: 'string'},
                  description: 'Array of group IDs to add the beneficiary to',
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
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Beneficiary created successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      _id: {type: 'string'},
                      email: {type: 'string'},
                      name: {type: 'string'},
                      relationship: {type: 'string'},
                      user: {type: 'string'},
                      created_at: {type: 'string', format: 'date-time'},
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    get: {
      tags: ['Beneficiaries'],
      summary: 'List Beneficiaries',
      description: 'Get paginated list of beneficiaries for the authenticated user',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'page',
          in: 'query',
          schema: {type: 'number', default: 1},
        },
        {
          name: 'limit',
          in: 'query',
          schema: {type: 'number', default: 10},
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
                  status: {type: 'string', example: 'success'},
                  data: {
                    type: 'object',
                    properties: {
                      docs: {type: 'array', items: {type: 'object'}},
                      totalDocs: {type: 'number'},
                      limit: {type: 'number'},
                      page: {type: 'number'},
                      totalPages: {type: 'number'},
                      hasNextPage: {type: 'boolean'},
                      hasPrevPage: {type: 'boolean'},
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
  '/beneficiaries/{id}': {
    put: {
      tags: ['Beneficiaries'],
      summary: 'Update Beneficiary',
      description: 'Update beneficiary information',
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
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                email: {type: 'string', format: 'email'},
                level: {type: 'integer'},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Beneficiary updated successfully',
        },
      },
    },
    delete: {
      tags: ['Beneficiaries'],
      summary: 'Delete Beneficiary',
      description: 'Delete a beneficiary',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: {type: 'string'},
        },
      ],
      responses: {
        200: {
          description: 'Beneficiary deleted successfully',
        },
      },
    },
  },
  '/beneficiaries/invite/resend': {
    post: {
      tags: ['Beneficiaries'],
      summary: 'Resend Invitation',
      description: 'Resend invitation email to beneficiary',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {
                email: {type: 'string', format: 'email'},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Invitation resent successfully',
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
              required: ['invite_id'],
              properties: {
                invite_id: {type: 'string', description: 'Invitation ID (MongoId)'},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Invitation accepted successfully',
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
          schema: {type: 'string'},
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
};

export default beneficiariesDocs;
