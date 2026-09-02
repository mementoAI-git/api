import {describe, expect, it} from 'vitest';
import {
  buildOpenApiDocument,
  serializeOpenApi,
  stableChecksum,
} from '../../src/contracts/openapi';

type Schema = {
  required?: string[];
  properties?: Record<string, unknown>;
};

function expectFixtureToMeetRequiredSchema(
  schema: Schema,
  fixture: Record<string, unknown>,
) {
  for (const key of schema.required || []) {
    expect(fixture, `missing required property ${key}`).toHaveProperty(key);
  }
}

describe('canonical OpenAPI artifact', () => {
  it('publishes the canonical response, user, session, and device schemas', () => {
    const spec = buildOpenApiDocument();

    expect(spec.components.schemas).toMatchObject({
      ApiResponse: expect.any(Object),
      ApiError: expect.any(Object),
      PublicUser: expect.any(Object),
      SessionPayload: expect.any(Object),
      PushDevice: expect.any(Object),
    });
    expect(spec.components.schemas.PublicUser.properties).not.toHaveProperty(
      'password',
    );
    expect(spec.components.schemas.PublicUser.properties).not.toHaveProperty(
      'refresh_token',
    );
    expect(spec.components.schemas.PushDevice.properties).not.toHaveProperty(
      'push_token',
    );
  });

  it('describes representative canonical success, error, and session fixtures', () => {
    const schemas = buildOpenApiDocument().components.schemas;
    const user = {
      id: 'user-1',
      _id: 'user-1',
      fullname: 'Ada Lovelace',
      onboarding_status: 'completed',
      onboarded: true,
      providers: ['password'],
      preferences: {},
      verified: true,
      two_factor: {enabled: false},
      passkeys: [],
      newsletter_subscriber: false,
    };
    const session = {
      access_token: 'access',
      refresh_token: 'refresh',
      access_expires_at: '2026-08-28T12:00:00.000Z',
      expires_at: '2026-08-28T12:00:00.000Z',
      refresh_expires_at: '2026-09-27T12:00:00.000Z',
      user,
      onboarding_status: 'completed',
    };

    expectFixtureToMeetRequiredSchema(schemas.PublicUser, user);
    expectFixtureToMeetRequiredSchema(schemas.SessionPayload, session);
    expectFixtureToMeetRequiredSchema(schemas.ApiResponse, {
      status: 200,
      success: true,
      message: 'OK',
      data: session,
      meta: {contract_version: '2026-08', request_id: 'request-1'},
    });
    expectFixtureToMeetRequiredSchema(schemas.ApiError, {
      status: 422,
      success: false,
      message: 'Invalid input',
      code: 'validation_failed',
      request_id: 'request-1',
    });
  });

  it('serializes byte-for-byte deterministically with a stable checksum', () => {
    const first = buildOpenApiDocument();
    const second = buildOpenApiDocument();

    expect(serializeOpenApi(first)).toBe(serializeOpenApi(second));
    expect(stableChecksum(first)).toBe(stableChecksum(second));
    expect(stableChecksum(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not publish dangling local schema references', () => {
    const spec = buildOpenApiDocument();
    const serialized = JSON.stringify(spec);
    const references = serialized.matchAll(
      /#\/components\/schemas\/([A-Za-z0-9_-]+)/g,
    );

    for (const reference of references) {
      expect(spec.components.schemas).toHaveProperty(reference[1]);
    }
  });

  it('documents liveness, readiness, and aggregate operational signals', () => {
    const spec = buildOpenApiDocument();

    expect(spec.paths).toHaveProperty('/health');
    expect(spec.paths).toHaveProperty('/ready');
    expect(spec.paths).toHaveProperty('/metrics');
    expect(spec.components.schemas).toHaveProperty('Readiness');
    expect(spec.components.schemas).toHaveProperty('OperationalSignals');
    const metrics = spec.paths['/metrics'] as {
      get: {security: Array<{bearerAuth: never[]}>};
    };
    expect(metrics.get.security).toEqual([{bearerAuth: []}]);
  });
});
