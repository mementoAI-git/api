const groupsDocs = {
  '/groups': {
    post: {
      tags: ['Groups'],
      summary: 'Create Group',
      description:
        'Create a new group. The authenticated user (group creator) can add their beneficiaries as members later.',
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
                  description: 'Group name',
                  example: 'Family',
                  maxLength: 120,
                },
                description: {
                  type: 'string',
                  description: 'Optional group description',
                  example: 'Close family members',
                  maxLength: 500,
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
                  message: {
                    type: 'string',
                    example: 'Group created successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      _id: {
                        type: 'string',
                        example: '507f1f77bcf86cd799439011',
                      },
                      name: {type: 'string', example: 'Family'},
                      description: {
                        type: 'string',
                        example: 'Close family members',
                      },
                      user: {
                        type: 'string',
                        description: 'User ID of the group creator',
                        example: '507f1f77bcf86cd799439012',
                      },
                      members: {type: 'array', items: {type: 'string'}},
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
      tags: ['Groups'],
      summary: 'List Groups',
      description: 'Get paginated list of groups for the authenticated user.',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'page',
          in: 'query',
          schema: {type: 'integer', default: 1},
          description: 'Page number',
        },
        {
          name: 'limit',
          in: 'query',
          schema: {type: 'integer', default: 25},
          description: 'Items per page',
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
                  message: {
                    type: 'string',
                    example: 'Groups retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      docs: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            _id: {type: 'string'},
                            name: {type: 'string'},
                            description: {type: 'string'},
                            user: {
                              type: 'string',
                              description: 'User ID of the group creator',
                            },
                            members: {
                              type: 'array',
                              items: {type: 'object'},
                            },
                            created_at: {type: 'string', format: 'date-time'},
                          },
                        },
                      },
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
  '/groups/{id}': {
    get: {
      tags: ['Groups'],
      summary: 'Get Group',
      description: 'Get a single group by ID. Only the group creator can view.',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Group ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      responses: {
        200: {
          description: 'Group retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Group retrieved successfully',
                  },
                  data: {
                    type: 'object',
                    properties: {
                      _id: {type: 'string'},
                      name: {type: 'string'},
                      description: {type: 'string'},
                      user: {
                        type: 'string',
                        description: 'User ID of the group creator',
                      },
                      members: {
                        type: 'array',
                        items: {type: 'object'},
                      },
                      created_at: {type: 'string', format: 'date-time'},
                    },
                  },
                },
              },
            },
          },
        },
        404: {
          description: 'Group not found',
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
    put: {
      tags: ['Groups'],
      summary: 'Update Group',
      description:
        'Update group name and/or description. Only the group creator can update.',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Group ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Group name',
                  maxLength: 120,
                },
                description: {
                  type: 'string',
                  description: 'Group description',
                  maxLength: 500,
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Group updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Group updated successfully',
                  },
                  data: {type: 'object'},
                },
              },
            },
          },
        },
        404: {
          description: 'Group not found',
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
    delete: {
      tags: ['Groups'],
      summary: 'Delete Group',
      description: 'Delete a group. Only the group creator can delete.',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Group ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
      ],
      responses: {
        200: {
          description: 'Group deleted successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Group deleted successfully',
                  },
                  data: {type: 'object'},
                },
              },
            },
          },
        },
        404: {
          description: 'Group not found',
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
  '/groups/{id}/members': {
    post: {
      tags: ['Groups'],
      summary: 'Add Members to Group',
      description:
        'Add beneficiaries to a group. Only beneficiaries that belong to the authenticated user can be added.',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Group ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
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
                  items: {type: 'string', format: 'objectId'},
                  description: 'Array of beneficiary IDs to add',
                  example: [
                    '507f1f77bcf86cd799439012',
                    '507f1f77bcf86cd799439013',
                  ],
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Members added successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Members added successfully',
                  },
                  data: {type: 'object'},
                },
              },
            },
          },
        },
        400: {
          description:
            'One or more beneficiaries not found or do not belong to you',
          content: {
            'application/json': {
              schema: {$ref: '#/components/schemas/Error'},
            },
          },
        },
        404: {
          description: 'Group not found',
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
  '/groups/{id}/members/{beneficiaryId}': {
    delete: {
      tags: ['Groups'],
      summary: 'Remove Member from Group',
      description:
        'Remove a beneficiary from a group. Only the group creator can remove.',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Group ID',
          schema: {type: 'string', example: '507f1f77bcf86cd799439011'},
        },
        {
          name: 'beneficiaryId',
          in: 'path',
          required: true,
          description: 'Beneficiary ID to remove',
          schema: {type: 'string', example: '507f1f77bcf86cd799439012'},
        },
      ],
      responses: {
        200: {
          description: 'Member removed successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: {type: 'string', example: 'success'},
                  message: {
                    type: 'string',
                    example: 'Member removed successfully',
                  },
                  data: {type: 'object'},
                },
              },
            },
          },
        },
        404: {
          description: 'Group or beneficiary not found',
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
  '/groups/search': {
    get: {
      tags: ['Groups'],
      summary: 'Search Groups',
      description: 'Search for groups by name or metadata',
      security: [{bearerAuth: []}],
      parameters: [
        {
          name: 'query',
          in: 'query',
          schema: {type: 'string'},
        },
      ],
      responses: {
        200: {
          description: 'Search results',
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
      description: 'Update group metadata or name',
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
              properties: {name: {type: 'string'}},
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Group updated',
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
          description: 'Group deleted',
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
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['beneficiary_ids'],
              properties: {beneficiary_ids: {type: 'array', items: {type: 'string'}}},
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Members added',
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
          description: 'Member removed',
        },
      },
    },
  },
};

export default groupsDocs;
