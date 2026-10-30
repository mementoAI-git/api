// Staff APIs are same-origin browser endpoints and never accept customer JWTs.
const security = [{staffCookie: []}];
const responses = {
  '200': {description: 'Standard API response envelope'},
  '400': {description: 'Invalid input'},
  '401': {description: 'Staff login required or session expired'},
  '403': {description: 'Permission or request origin rejected'},
};
const origin = {
  name: 'Origin',
  in: 'header',
  required: true,
  schema: {type: 'string'},
  description:
    'Must exactly match STAFF_ORIGIN for every mutation, including login/logout.',
};
const key = {
  name: 'key',
  in: 'path',
  required: true,
  schema: {type: 'string', maxLength: 128},
};
const scope = [
  key,
  {
    name: 'scopeType',
    in: 'path',
    required: true,
    schema: {type: 'string', enum: ['global', 'environment', 'user']},
  },
  {
    name: 'scopeId',
    in: 'path',
    required: true,
    schema: {type: 'string', maxLength: 128},
  },
];
const reason = {type: 'string', maxLength: 500};
const value = {value: {type: 'boolean'}, reason};
const body = (properties: object, required: string[]) => ({
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        additionalProperties: false,
        required,
        properties,
      },
    },
  },
});
const read = (summary: string, parameters: unknown[] = []) => ({
  tags: ['Staff'],
  summary,
  security,
  parameters,
  responses,
});
const write = (
  summary: string,
  properties: object,
  required: string[],
  parameters: unknown[] = [],
) => ({
  ...read(summary, [...parameters, origin]),
  requestBody: body(properties, required),
});
export default {
  '/staff/operations': {
    get: read(
      'Current operational counts; operations:read. Each count is a non-negative integer or null when unavailable; collected_at is ISO 8601.',
    ),
  },
  '/staff/accounts': {
    get: read(
      'Safe account directory; accounts:read. Returns items, total, page, limit (25). Exact email or ObjectId lookup.',
      [
        {name: 'search', in: 'query', schema: {type: 'string', maxLength: 254}},
        {
          name: 'page',
          in: 'query',
          schema: {type: 'integer', minimum: 1, maximum: 1000},
        },
      ],
    ),
  },
  '/staff/accounts/{id}': {
    get: {
      ...read(
        'Account metadata, effective subscription access, recorded usage and processing failure counts; accounts:read. No credentials or private content.',
        [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: {type: 'string', pattern: '^[a-fA-F0-9]{24}$'},
          },
        ],
      ),
      responses: {...responses, '404': {description: 'Account not found'}},
    },
  },
  '/staff/login': {
    post: {
      ...write(
        'Staff password and TOTP sign-in; 30-minute HttpOnly cookie',
        {
          email: {type: 'string', format: 'email'},
          password: {type: 'string', maxLength: 72},
          code: {type: 'string', pattern: '^[0-9]{6}$'},
        },
        ['email', 'password', 'code'],
      ),
      security: [],
      responses: {
        ...responses,
        '429': {description: 'Too many sign-in attempts'},
      },
    },
  },
  '/staff/session': {
    get: read('Current staff identity, permissions and absolute expiresAt'),
  },
  '/staff/logout': {post: {...read('Revoke current staff session', [origin])}},
  '/staff/feature-flags': {
    get: read('List definitions and operational metadata (flags:read)', [
      {name: 'page', in: 'query', schema: {type: 'integer', minimum: 1}},
      {
        name: 'limit',
        in: 'query',
        schema: {type: 'integer', minimum: 1, maximum: 200},
      },
      {name: 'search', in: 'query', schema: {type: 'string', maxLength: 128}},
      {name: 'domain', in: 'query', schema: {type: 'string', maxLength: 128}},
    ]),
  },
  '/staff/feature-flags/{key}': {
    get: read('Flag definition, overrides and effective value (flags:read)', [
      key,
    ]),
  },
  '/staff/feature-flags/{key}/audit': {
    get: read('Recent flag changes with staff:ID attribution (flags:read)', [
      key,
    ]),
  },
  '/staff/feature-flags/{key}/default': {
    put: write('Update default (flags:write)', value, ['value'], [key]),
  },
  '/staff/feature-flags/{key}/overrides/{scopeType}/{scopeId}': {
    put: write(
      'Set scoped override (flags:write)',
      {
        ...value,
        rolloutPercentage: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          nullable: true,
        },
      },
      ['value'],
      scope,
    ),
    delete: write('Remove scoped override (flags:write)', {reason}, [], scope),
  },
  '/staff/feature-flags/{key}/rollout/{scopeType}/{scopeId}': {
    put: write(
      'Update rollout (flags:write)',
      {
        rolloutPercentage: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          nullable: true,
        },
        reason,
      },
      ['rolloutPercentage'],
      scope,
    ),
  },
  '/staff/feature-flags/bulk': {
    post: write(
      'Set global overrides for a literal key prefix (flags:write)',
      {...value, prefix: {type: 'string', minLength: 1, maxLength: 128}},
      ['prefix', 'value'],
    ),
  },
  '/feature-flags/evaluated': {
    get: {
      tags: ['Features'],
      summary:
        'Customer-specific evaluated booleans and sources, without management metadata',
      security: [{bearerAuth: []}],
      responses: {
        '200': {
          description:
            'data is a map from flag key to {enabled:boolean, source:string}',
        },
        '401': {description: 'Customer authentication required'},
      },
    },
  },
  '/feature-flags/evaluate/{key}': {
    get: {
      tags: ['Features'],
      summary: 'Evaluate one flag for the current customer',
      security: [{bearerAuth: []}],
      parameters: [key],
      responses: {
        '200': {description: 'data contains enabled and source'},
        '401': {description: 'Customer authentication required'},
      },
    },
  },
};
