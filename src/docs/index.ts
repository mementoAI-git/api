import { Application } from 'express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { BACKEND_URL } from '../utils/config';
import authDocs from './auth.docs';
import usersDocs from './users.docs';
import beneficiariesDocs from './beneficiaries.docs';
import capsulesDocs from './capsules.docs';
import memoriesDocs from './memories.docs';
import aiDocs from './ai.docs';
import promptsDocs from './prompts.docs';
import filesDocs from './files.docs';
import activitiesDocs from './activities.docs';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Memento API',
      version: '1.0.0',
      description: 'API documentation for Memento - A memory and conversation management platform',
      contact: {
        name: 'Memento API Support',
        email: 'support@mymemento.io',
      },
    },
    servers: [
      {
        url: BACKEND_URL || 'http://localhost:5000',
        description: 'Backend Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token obtained from login endpoint',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'error',
            },
            message: {
              type: 'string',
              example: 'Error message description',
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: {
                    type: 'string',
                    example: 'email',
                  },
                  message: {
                    type: 'string',
                    example: 'Email is required',
                  },
                },
              },
            },
          },
        },
        Success: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'success',
            },
            message: {
              type: 'string',
              example: 'Operation completed successfully',
            },
            data: {
              type: 'object',
            },
          },
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Authentication and authorization endpoints' },
      { name: 'Users', description: 'User management endpoints' },
      { name: 'Beneficiaries', description: 'Beneficiary management endpoints' },
      { name: 'Capsules', description: 'Time capsule management endpoints' },
      { name: 'Memories', description: 'Memory management endpoints' },
      { name: 'AI', description: 'AI conversation and interaction endpoints' },
      { name: 'Prompts', description: 'Prompt management endpoints' },
      { name: 'Files', description: 'File upload and management endpoints' },
      { name: 'Activities', description: 'User activity tracking endpoints' },
      { name: 'Health', description: 'Health check endpoints' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Health Check',
          description: 'Check API health status and uptime',
          responses: {
            200: {
              description: 'API is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'success' },
                      message: { type: 'string', example: 'OK' },
                      data: {
                        type: 'object',
                        properties: {
                          uptime: { type: 'number', example: 3600.5, description: 'Uptime in seconds' },
                          responsetime: {
                            type: 'array',
                            items: { type: 'number' },
                            description: 'High resolution time tuple',
                            example: [1234, 567890000],
                          },
                          message: { type: 'string', example: 'OK' },
                          status: { type: 'number', example: 200 },
                          timestamp: { type: 'number', example: 1704067200000 },
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
      ...authDocs,
      ...usersDocs,
      ...beneficiariesDocs,
      ...capsulesDocs,
      ...memoriesDocs,
      ...aiDocs,
      ...promptsDocs,
      ...filesDocs,
      ...activitiesDocs,
    },
  },
  apis: [],
};

const swaggerSpec = swaggerJsdoc(options);

const setupSwagger = (app: Application): void => {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Memento API Documentation',
  }));
};

export default setupSwagger;

