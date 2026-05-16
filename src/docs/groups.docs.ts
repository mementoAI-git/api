const groupsDocs = {
  '/groups': {
    post: {
      tags: ['Groups'],
      summary: 'Create Group',
      description: 'Create a new group for organizing beneficiaries',
      security: [{bearerAuth: []}],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: {
                  type: 'string',
                  maxLength: 120,
                  example: 'Family',
                },
                description: {
                  type: 'string',
                  maxLength: 500,
                  example: 'Close family members',
                },
                color: {
                  type: 'integer',
                  minimum: 0,
                  maximum: 6,
                  description: 'Color index for UI',
                  example: 1,
                },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Group created successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  data: {
                    type: 'object',
                    properties: {
                      _id: {type: 'string'},
                      name: {type: 'string'},
                      description: {type: 'string'},
                      color: {type: 'number'},
                      user: {type: 'string'},
                      members: {type: 'array', items: {type: 'string'}},
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
      tags: ['Groups'],
      summary: 'List Groups',
      description: 'Get paginated list of groups for the authenticated user.',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'page',
          in: 'query',
          schema: {type: 'integer', default: 1},
        },
        {
          name: 'limit',
          in: 'query',
          schema: {type: 'integer', default: 25},
        },
      ],
      responses: {
        200: {
          description: 'Groups retrieved successfully',
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
  '/groups/search': {
    get: {
      tags: ['Groups'],
      summary: 'Search Groups & Beneficiaries',
      description: 'Unified search for groups and beneficiaries',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'q',
          in: 'query',
          required: true,
          schema: {type: 'string'},
          description: 'Search query',
        },
        {
          name: 'resource',
          in: 'query',
          schema: {type: 'string', enum: ['group', 'beneficiary', 'all'], default: 'all'},
          description: 'Type of resource to search',
        },
      ],
      responses: {
        200: {
          description: 'Search results retrieved',
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
  '/groups/{id}': {
    get: {
      tags: ['Groups'],
      summary: 'Get Group Details',
      description: 'Retrieve details of a specific group and its members',
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
          description: 'Group details retrieved',
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
    put: {
      tags: ['Groups'],
      summary: 'Update Group',
      description: 'Update group metadata, name or color',
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
                name: {type: 'string', maxLength: 120},
                description: {type: 'string', maxLength: 500},
                color: {type: 'integer', minimum: 0, maximum: 6},
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Group updated successfully',
        },
      },
    },
    delete: {
      tags: ['Groups'],
      summary: 'Delete Group',
      description: 'Permanently delete a group',
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
          description: 'Group deleted successfully',
        },
      },
    },
  },
  '/groups/{id}/members': {
    post: {
      tags: ['Groups'],
      summary: 'Add Members to Group',
      description: 'Add one or more beneficiaries to a group',
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
              required: ['beneficiaryIds'],
              properties: {
                beneficiaryIds: {
                  type: 'array',
                  items: {type: 'string'},
                  description: 'Array of beneficiary IDs to add',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Members added successfully',
        },
      },
    },
  },
  '/groups/{id}/members/{beneficiaryId}': {
    delete: {
      tags: ['Groups'],
      summary: 'Remove Member from Group',
      description: 'Remove a specific beneficiary from a group',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: {type: 'string'},
        },
        {
          name: 'beneficiaryId',
          in: 'path',
          required: true,
          schema: {type: 'string'},
        },
      ],
      responses: {
        200: {
          description: 'Member removed successfully',
        },
      },
    },
  },
};

export default groupsDocs;
