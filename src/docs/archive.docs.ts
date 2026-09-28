const archiveDocs = {
  '/exports/archive': {
    post: {
      tags: ['Exports'],
      summary: 'Create a complete vault archive',
      security: [{bearerAuth: []}],
      responses: {
        202: {description: 'Archive export queued'},
        401: {description: 'Unauthorized'},
      },
    },
  },
  '/exports/archive/{id}': {
    get: {
      tags: ['Exports'],
      summary: 'Get archive export status',
      security: [{bearerAuth: []}],
      parameters: [
        {
          in: 'path',
          name: 'id',
          required: true,
          schema: {type: 'string'},
        },
      ],
      responses: {
        200: {description: 'Archive status and progress'},
        404: {description: 'Archive export not found for this account'},
      },
    },
  },
  '/exports/archive/{id}/download': {
    post: {
      tags: ['Exports'],
      summary: 'Create a short-lived archive download URL',
      security: [{bearerAuth: []}],
      parameters: [
        {
          in: 'path',
          name: 'id',
          required: true,
          schema: {type: 'string'},
        },
      ],
      responses: {
        200: {description: 'Short-lived signed ZIP download URL'},
        404: {description: 'Archive is unavailable, expired, or not owned'},
      },
    },
  },
};

export default archiveDocs;
