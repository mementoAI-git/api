const filesDocs = {
  '/files': {
    get: {
      tags: ['Files'],
      summary: 'Get All Files',
      description: 'Get paginated list of files uploaded by the authenticated user',
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
          schema: { type: 'number', default: 25 },
          description: 'Items per page',
        },
        {
          name: 'type',
          in: 'query',
          schema: { type: 'string' },
          description: 'Filter files by MIME type',
          example: 'image/jpeg',
        },
        {
          name: 'search',
          in: 'query',
          schema: { type: 'string' },
          description: 'Search files by name',
          example: 'photo',
        },
      ],
      responses: {
        200: {
          description: 'Files retrieved successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'Files retrieved successfully' },
                  data: {
                    type: 'object',
                    properties: {
                      docs: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
                            name: { type: 'string', example: 'file-1234567890.jpg' },
                            type: { type: 'string', example: 'image/jpeg' },
                            size: { type: 'number', example: 1048576 },
                            user: { type: 'string', example: '507f1f77bcf86cd799439012' },
                            url: { type: 'string', example: 'https://example.com/files/file-1234567890.jpg' },
                            duration: { type: 'number', example: 120, description: 'Duration in seconds for audio/video files' },
                            transcription: {
                              type: 'object',
                              properties: {
                                full_text: { type: 'string', example: 'Full transcription text...' },
                                segments: {
                                  type: 'array',
                                  items: {
                                    type: 'object',
                                    properties: {
                                      start: { type: 'number', example: 0 },
                                      end: { type: 'number', example: 5 },
                                      text: { type: 'string', example: 'Transcription segment...' },
                                    },
                                  },
                                },
                              },
                            },
                            created_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
                            updated_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
                          },
                        },
                      },
                      totalDocs: { type: 'number', example: 50 },
                      limit: { type: 'number', example: 25 },
                      page: { type: 'number', example: 1 },
                      totalPages: { type: 'number', example: 2 },
                      hasNextPage: { type: 'boolean', example: true },
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
  '/files/upload': {
    post: {
      tags: ['Files'],
      summary: 'Upload File',
      description: 'Upload a file (image, video, audio, document). Returns file metadata and URL.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: {
                  type: 'string',
                  format: 'binary',
                  description: 'File to upload (supports images, videos, audio, documents)',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'File uploaded successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'File uploaded successfully' },
                  data: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
                      name: { type: 'string', example: 'file-1234567890.jpg' },
                      original_name: { type: 'string', example: 'my-photo.jpg' },
                      type: { type: 'string', example: 'image/jpeg' },
                      size: { type: 'string', example: '1048576' },
                      user: { type: 'string', example: '507f1f77bcf86cd799439012' },
                      url: { type: 'string', example: 'https://example.com/files/file-1234567890.jpg' },
                      created_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Invalid file or validation error',
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
  '/files/{name}': {
    get: {
      tags: ['Files'],
      summary: 'Get File',
      description: 'Retrieve a file by name. Supports range requests for video streaming.',
      parameters: [
        {
          name: 'name',
          in: 'path',
          required: true,
          description: 'File name',
          schema: { type: 'string', example: 'file-1234567890.jpg' },
        },
        {
          name: 'Range',
          in: 'header',
          required: false,
          description: 'Byte range for partial content requests (for video streaming)',
          schema: { type: 'string', example: 'bytes=0-1023' },
        },
      ],
      responses: {
        200: {
          description: 'File retrieved successfully',
          content: {
            'image/jpeg': {
              schema: {
                type: 'string',
                format: 'binary',
              },
            },
            'image/png': {
              schema: {
                type: 'string',
                format: 'binary',
              },
            },
            'video/mp4': {
              schema: {
                type: 'string',
                format: 'binary',
              },
            },
            'audio/mpeg': {
              schema: {
                type: 'string',
                format: 'binary',
              },
            },
            'application/pdf': {
              schema: {
                type: 'string',
                format: 'binary',
              },
            },
          },
          headers: {
            'Content-Type': {
              schema: { type: 'string', example: 'image/jpeg' },
              description: 'File MIME type',
            },
            'Content-Length': {
              schema: { type: 'string', example: '1048576' },
              description: 'File size in bytes',
            },
            'Content-Disposition': {
              schema: { type: 'string', example: 'inline; filename="my-photo.jpg"' },
              description: 'Content disposition header',
            },
            'Cache-Control': {
              schema: { type: 'string', example: 'public, max-age=3600' },
              description: 'Cache control header',
            },
            'Accept-Ranges': {
              schema: { type: 'string', example: 'bytes' },
              description: 'Indicates support for range requests',
            },
          },
        },
        206: {
          description: 'Partial content (for range requests)',
          content: {
            'video/mp4': {
              schema: {
                type: 'string',
                format: 'binary',
              },
            },
          },
          headers: {
            'Content-Range': {
              schema: { type: 'string', example: 'bytes 0-1023/1048576' },
              description: 'Content range header',
            },
            'Content-Length': {
              schema: { type: 'string', example: '1024' },
              description: 'Length of the partial content',
            },
          },
        },
        404: {
          description: 'File not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
    delete: {
      tags: ['Files'],
      summary: 'Delete File',
      description: 'Delete a file by name. Only the file owner can delete their files.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'name',
          in: 'path',
          required: true,
          description: 'File name',
          schema: { type: 'string', example: 'file-1234567890.jpg' },
        },
      ],
      responses: {
        200: {
          description: 'File deleted successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'success' },
                  message: { type: 'string', example: 'File deleted successfully' },
                  data: {
                    type: 'object',
                    properties: {
                      deleted: { type: 'boolean', example: true },
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
        403: {
          description: 'Forbidden - Not the file owner',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        404: {
          description: 'File not found',
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

export default filesDocs;

