import {createHash} from 'crypto';
import activitiesDocs from '../docs/activities.docs';
import aiDocs from '../docs/ai.docs';
import authDocs from '../docs/auth.docs';
import beneficiariesDocs from '../docs/beneficiaries.docs';
import billingDocs from '../docs/billing.docs';
import archiveDocs from '../docs/archive.docs';
import capsulesDocs from '../docs/capsules.docs';
import feedbackDocs from '../docs/feedback.docs';
import filesDocs from '../docs/files.docs';
import groupsDocs from '../docs/groups.docs';
import memoriesDocs from '../docs/memories.docs';
import personaDocs from '../docs/persona.docs';
import promptsDocs from '../docs/prompts.docs';
import usersDocs from '../docs/users.docs';
import {CONTRACT_VERSION} from './response';

export type OpenApiSchema = {
  type?: string;
  format?: string;
  enum?: Array<string | number | boolean>;
  nullable?: boolean;
  description?: string;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  additionalProperties?: boolean | OpenApiSchema;
  $ref?: string;
};

export type OpenApiDocument = {
  openapi: string;
  info: {title: string; version: string; description: string};
  servers: Array<{url: string; description: string}>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, OpenApiSchema>;
  };
  tags: Array<{name: string; description: string}>;
  paths: Record<string, unknown>;
};

const dateTime: OpenApiSchema = {type: 'string', format: 'date-time'};
const nullableString: OpenApiSchema = {type: 'string', nullable: true};

const schemas: Record<string, OpenApiSchema> = {
  ResponseMeta: {
    type: 'object',
    required: ['contract_version', 'request_id'],
    properties: {
      contract_version: {type: 'string', enum: [CONTRACT_VERSION]},
      request_id: {type: 'string', format: 'uuid'},
      deprecations: {type: 'array', items: {type: 'string'}},
    },
  },
  ApiResponse: {
    type: 'object',
    required: ['status', 'success', 'message', 'data', 'meta'],
    properties: {
      status: {type: 'integer'},
      success: {type: 'boolean', enum: [true]},
      message: {type: 'string'},
      data: {},
      meta: {$ref: '#/components/schemas/ResponseMeta'},
    },
  },
  ApiError: {
    type: 'object',
    required: ['status', 'success', 'message', 'code', 'request_id'],
    properties: {
      status: {type: 'integer'},
      success: {type: 'boolean', enum: [false]},
      message: {type: 'string'},
      code: {
        type: 'string',
        enum: [
          'bad_request',
          'unauthorized',
          'payment_required',
          'forbidden',
          'not_found',
          'conflict',
          'payload_too_large',
          'validation_failed',
          'rate_limited',
          'session_expired',
          'bad_gateway',
          'service_unavailable',
          'internal_error',
          'request_failed',
        ],
      },
      details: {type: 'object', additionalProperties: true},
      request_id: {type: 'string', format: 'uuid'},
    },
  },
  Readiness: {
    type: 'object',
    required: ['ready', 'checked_at', 'dependencies'],
    properties: {
      ready: {type: 'boolean'},
      checked_at: dateTime,
      dependencies: {
        type: 'object',
        required: ['mongo', 'redis', 'storage', 'worker'],
        properties: {
          mongo: {type: 'string', enum: ['ok', 'unavailable']},
          redis: {type: 'string', enum: ['ok', 'unavailable']},
          storage: {type: 'string', enum: ['ok', 'unavailable']},
          worker: {type: 'string', enum: ['ok', 'unavailable']},
        },
      },
    },
  },
  OperationalSignals: {
    type: 'object',
    required: [
      'collected_at',
      'queue_depth',
      'queue_failed_jobs',
      'delivery_failures',
      'purge_oldest_age_seconds',
      'usage_stale_records',
      'usage_drift_records',
      'compatibility_events_24h',
    ],
    properties: {
      collected_at: dateTime,
      queue_depth: {type: 'integer', nullable: true},
      queue_failed_jobs: {type: 'integer', nullable: true},
      delivery_failures: {type: 'integer', nullable: true},
      purge_oldest_age_seconds: {type: 'integer', nullable: true},
      usage_stale_records: {type: 'integer', nullable: true},
      usage_drift_records: {type: 'integer', nullable: true},
      compatibility_events_24h: {type: 'integer', nullable: true},
    },
  },
  PublicPasskey: {
    type: 'object',
    required: ['credential_id', 'device_name'],
    properties: {
      credential_id: {type: 'string'},
      device_name: {type: 'string'},
      created_at: dateTime,
    },
  },
  PublicUser: {
    type: 'object',
    required: [
      'id',
      '_id',
      'fullname',
      'onboarding_status',
      'onboarded',
      'providers',
      'preferences',
      'verified',
      'two_factor',
      'passkeys',
      'newsletter_subscriber',
    ],
    properties: {
      id: {type: 'string'},
      _id: {type: 'string'},
      email: {type: 'string', format: 'email'},
      first_name: {type: 'string'},
      last_name: {type: 'string'},
      fullname: nullableString,
      nickname: {type: 'string'},
      gender: {type: 'string'},
      phone_number: {type: 'string'},
      dob: dateTime,
      country: {type: 'string'},
      onboarding_status: {type: 'string'},
      onboarding_step_reached: {type: 'integer', nullable: true},
      skipped_deep_personalization: {type: 'boolean'},
      onboarded: {type: 'boolean'},
      providers: {type: 'array', items: {type: 'string'}},
      preferences: {type: 'object', additionalProperties: true},
      verified: {type: 'boolean'},
      two_factor: {
        type: 'object',
        required: ['enabled'],
        properties: {enabled: {type: 'boolean'}},
      },
      passkeys: {
        type: 'array',
        items: {$ref: '#/components/schemas/PublicPasskey'},
      },
      picture: {type: 'string'},
      picture_url: {type: 'string'},
      location: {type: 'string'},
      age_range: {type: 'string'},
      last_seen: {type: 'string'},
      last_task_date: {type: 'string'},
      streak: {type: 'integer'},
      bg_music: nullableString,
      chat_voice: nullableString,
      chat_voice_provider: {type: 'string'},
      newsletter_subscriber: {type: 'boolean'},
      storage_limit: {type: 'number'},
      primary_conversation_id: nullableString,
      created_at: dateTime,
      updated_at: dateTime,
    },
  },
  SessionPayload: {
    type: 'object',
    required: [
      'access_token',
      'refresh_token',
      'access_expires_at',
      'expires_at',
      'refresh_expires_at',
      'user',
      'onboarding_status',
    ],
    properties: {
      access_token: {type: 'string'},
      refresh_token: {type: 'string'},
      access_expires_at: dateTime,
      expires_at: {
        ...dateTime,
        description: 'Compatibility alias for access_expires_at',
      },
      refresh_expires_at: dateTime,
      user: {$ref: '#/components/schemas/PublicUser'},
      onboarding_status: {type: 'string'},
    },
  },
  PushDevice: {
    type: 'object',
    required: ['installation_id', 'platform', 'enabled', 'last_seen_at'],
    properties: {
      installation_id: {type: 'string'},
      platform: {type: 'string', enum: ['ios', 'android', 'web']},
      enabled: {type: 'boolean'},
      last_seen_at: dateTime,
    },
  },
  Error: {
    $ref: '#/components/schemas/ApiError',
    description: 'Compatibility name retained for existing endpoint docs.',
  },
};

export function buildOpenApiDocument(
  serverUrl = 'http://localhost:5000',
): OpenApiDocument {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Memento API',
      version: CONTRACT_VERSION,
      description:
        'Canonical API contract for the Memento web and mobile applications.',
    },
    servers: [{url: serverUrl, description: 'Memento API server'}],
    components: {
      securitySchemes: {
        bearerAuth: {type: 'http', scheme: 'bearer', bearerFormat: 'JWT'},
      },
      schemas,
    },
    tags: [
      {name: 'Auth', description: 'Authentication and session management'},
      {name: 'Users', description: 'User profile and account management'},
      {name: 'Push Devices', description: 'Installation-scoped push delivery'},
      {name: 'Memories', description: 'Memory management'},
      {name: 'Files', description: 'Attachment management'},
      {name: 'Health', description: 'Service health'},
    ],
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Cheap process liveness check',
          responses: {'200': {description: 'API process is alive'}},
        },
      },
      '/ready': {
        get: {
          tags: ['Health'],
          summary: 'Dependency and worker readiness check',
          responses: {
            '200': {
              description: 'All required dependencies are ready',
              content: {
                'application/json': {
                  schema: {$ref: '#/components/schemas/ApiResponse'},
                },
              },
            },
            '503': {
              description: 'One or more required dependencies are unavailable',
              content: {
                'application/json': {
                  schema: {$ref: '#/components/schemas/ApiError'},
                },
              },
            },
          },
        },
      },
      '/metrics': {
        get: {
          tags: ['Health'],
          summary: 'Aggregate operational signals',
          security: [{bearerAuth: []}],
          responses: {
            '200': {
              description:
                'Queue, delivery, purge, usage, and compatibility signals',
            },
          },
        },
      },
      ...authDocs,
      ...usersDocs,
      ...beneficiariesDocs,
      ...groupsDocs,
      ...capsulesDocs,
      ...memoriesDocs,
      ...aiDocs,
      ...promptsDocs,
      ...filesDocs,
      ...activitiesDocs,
      ...feedbackDocs,
      ...billingDocs,
      ...archiveDocs,
      ...personaDocs,
      '/push-devices/{installationId}': {
        put: {
          tags: ['Push Devices'],
          security: [{bearerAuth: []}],
          summary: 'Register or refresh a push installation',
          parameters: [
            {
              in: 'path',
              name: 'installationId',
              required: true,
              schema: {type: 'string'},
            },
          ],
          responses: {
            '200': {
              description: 'Push device registered',
              content: {
                'application/json': {
                  schema: {$ref: '#/components/schemas/ApiResponse'},
                },
              },
            },
          },
        },
        delete: {
          tags: ['Push Devices'],
          security: [{bearerAuth: []}],
          summary: 'Disable a push installation',
          parameters: [
            {
              in: 'path',
              name: 'installationId',
              required: true,
              schema: {type: 'string'},
            },
          ],
          responses: {'200': {description: 'Push device disabled'}},
        },
      },
    },
  };
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

export function serializeOpenApi(document: OpenApiDocument): string {
  return `${JSON.stringify(sortJson(document), null, 2)}\n`;
}

export function stableChecksum(document: OpenApiDocument): string {
  return createHash('sha256').update(serializeOpenApi(document)).digest('hex');
}
