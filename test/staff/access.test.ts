import express from 'express';
import request from 'supertest';
import speakeasy from 'speakeasy';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import staffRoutes from '../../src/module/api/staff/routes';
import featureRoutes from '../../src/module/api/feature-flag/routes';
import guard from '../../src/middleware/gaurd';
import errorHandler from '../../src/middleware/error-handler';
import {provisionStaff} from '../../src/module/api/staff/provision';
import StaffAccount from '../../src/module/database/model/staff-account';
import StaffSession from '../../src/module/database/model/staff-session';
import {
  FeatureDefinition,
  FeatureOverride,
} from '../../src/module/database/model/feature-flag';
import {FeatureFlagAudit} from '../../src/module/database/model/feature-flag-audit';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

process.env.STAFF_ORIGIN = 'http://localhost:5174';
process.env.STAFF_TOTP_KEY = 'a'.repeat(64);
const origin = process.env.STAFF_ORIGIN;
const email = 'operator@example.com';
const password = 'a long test-only staff password';
const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const code = () => speakeasy.totp({secret, encoding: 'base32'});
function app() {
  const server = express();
  server.use(express.json());
  server.use('/staff', staffRoutes);
  server.use('/feature-flags', featureRoutes);
  server.get('/customer', guard, (_req, res) => res.sendStatus(204));
  server.use(errorHandler);
  return server;
}
async function account(permissions = ['flags:read', 'flags:write']) {
  await provisionStaff({
    operation: 'create',
    email,
    password,
    totpSecret: secret,
    code: code(),
    permissions,
  });
  // Enrollment consumes a code; simulate the next authenticator window for login.
  await StaffAccount.updateOne({email}, {$set: {last_totp_step: -1}});
}
async function login(server = app()) {
  return request(server)
    .post('/staff/login')
    .set('Origin', origin)
    .send({email, password, code: code()});
}
function cookie(response: {headers: Record<string, string | string[]>}) {
  const cookies = response.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies[0] : cookies).split(';')[0];
}

describe('staff access boundary', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);
  it('separates support and operational permissions', async () => {
    await account(['accounts:read']);
    const server = app();
    const session = cookie(await login(server));
    expect(
      (await request(server).get('/staff/operations').set('Cookie', session))
        .status,
    ).toBe(403);
    expect(
      (await request(server).get('/staff/accounts').set('Cookie', session))
        .status,
    ).toBe(200);
    expect(
      (
        await request(server)
          .get('/staff/accounts/invalid')
          .set('Cookie', session)
      ).status,
    ).toBe(400);
    expect((await request(server).get('/staff/accounts')).status).toBe(401);
  });
  it('requires MFA and issues an isolated HttpOnly session without exposing credentials', async () => {
    await account();
    const server = app();
    expect(
      (
        await request(server)
          .post('/staff/login')
          .set('Origin', origin)
          .send({email, password})
      ).status,
    ).toBe(400);
    const result = await login(server);
    expect(result.status).toBe(200);
    expect(result.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(result.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect(result.headers['set-cookie'][0]).toContain('Path=/staff');
    expect(result.headers['set-cookie'][0]).not.toContain('Domain=');
    expect(JSON.stringify(result.body)).not.toMatch(/password|totp|token/);
    expect(
      (
        await request(server)
          .get('/staff/session')
          .set('Cookie', cookie(result))
      ).status,
    ).toBe(200);
    expect(
      (await request(server).get('/customer').set('Cookie', cookie(result)))
        .status,
    ).toBe(401);
    const session = await StaffSession.findOne().lean();
    expect(cookie(result)).not.toContain(session!.token_hash);
  });
  it('rejects customer JWTs including the former admin email and closes old management routes', async () => {
    const customer = await createUserFixture({email: 'admin@example.com'});
    const server = app();
    const authorization = `Bearer ${issueLegacyAccessToken(customer)}`;
    expect(
      (
        await request(server)
          .get('/staff/feature-flags')
          .set('Authorization', authorization)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(server)
          .get('/feature-flags')
          .set('Authorization', authorization)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(server)
          .get('/feature-flags/evaluate/test.flag')
          .set('Authorization', authorization)
      ).status,
    ).toBe(200);
  });
  it('returns only evaluated values for customers, including user overrides', async () => {
    const customer = await createUserFixture();
    await FeatureDefinition.create({
      key: 'memory.create',
      domain: 'memory',
      default_value: false,
      description: 'internal description',
    });
    const response = await request(app())
      .get('/feature-flags/evaluated')
      .set('Authorization', `Bearer ${issueLegacyAccessToken(customer)}`);
    expect(response.status).toBe(200);
    expect(response.body.data['memory.create'].enabled).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain('internal description');
  });
  it('treats search as literal text instead of a regular expression', async () => {
    await account();
    const server = app();
    const session = cookie(await login(server));
    expect(
      (
        await request(server)
          .get('/staff/feature-flags?search=%5B')
          .set('Cookie', session)
      ).status,
    ).toBe(200);
  });
  it('rejects replayed authenticator codes', async () => {
    await account();
    expect((await login()).status).toBe(200);
    expect((await login()).status).toBe(401);
  });
  it('rejects untrusted or missing origins', async () => {
    await account();
    const server = app();
    for (const candidate of ['', 'https://evil.example']) {
      const attempt = request(server).post('/staff/login');
      if (candidate) void attempt.set('Origin', candidate);
      expect((await attempt.send({email, password, code: code()})).status).toBe(
        403,
      );
    }
    const session = cookie(await login(server));
    expect(
      (await request(server).post('/staff/logout').set('Cookie', session))
        .status,
    ).toBe(403);
    expect(
      (
        await request(server)
          .post('/staff/logout')
          .set('Cookie', session)
          .set('Origin', 'https://evil.example')
      ).status,
    ).toBe(403);
  });
  it('checks current permissions and disablement on every request', async () => {
    await account(['flags:read']);
    const server = app();
    const session = cookie(await login(server));
    expect(
      (await request(server).get('/staff/feature-flags').set('Cookie', session))
        .status,
    ).toBe(200);
    expect(
      (
        await request(server)
          .post('/staff/feature-flags/bulk')
          .set('Cookie', session)
          .set('Origin', origin)
          .send({prefix: 'chat.', value: false})
      ).status,
    ).toBe(403);
    await StaffAccount.updateOne({email}, {$set: {permissions: []}});
    expect(
      (await request(server).get('/staff/feature-flags').set('Cookie', session))
        .status,
    ).toBe(403);
    await StaffAccount.updateOne({email}, {$set: {enabled: false}});
    expect(
      (await request(server).get('/staff/session').set('Cookie', session))
        .status,
    ).toBe(401);
  });
  it('expires sessions and revokes them on logout', async () => {
    await account();
    const server = app();
    const session = cookie(await login(server));
    expect(
      (
        await request(server)
          .post('/staff/logout')
          .set('Cookie', session)
          .set('Origin', origin)
      ).status,
    ).toBe(200);
    expect(
      (await request(server).get('/staff/session').set('Cookie', session))
        .status,
    ).toBe(401);
    await StaffAccount.updateOne({email}, {$set: {last_totp_step: -1}});
    const expired = cookie(await login(server));
    await StaffSession.updateMany({}, {$set: {expires_at: new Date(0)}});
    expect(
      (await request(server).get('/staff/session').set('Cookie', expired))
        .status,
    ).toBe(401);
  });
  it('validates flag mutations and records staff attribution', async () => {
    await account();
    await FeatureDefinition.create({
      key: 'test.flag',
      domain: 'test',
      default_value: false,
    });
    const server = app();
    const session = cookie(await login(server));
    const update = (body: object) =>
      request(server)
        .put('/staff/feature-flags/test.flag/default')
        .set('Cookie', session)
        .set('Origin', origin)
        .send(body);
    expect((await update({value: 'false'})).status).toBe(400);
    expect(
      (await update({value: true, reason: 'Release verified'})).status,
    ).toBe(200);
    const audit = await FeatureFlagAudit.findOne({key: 'test.flag'}).lean();
    expect(audit!.actor).toMatch(/^staff:/);
    expect(audit!.reason).toBe('Release verified');
    expect(
      (
        await request(server)
          .put('/staff/feature-flags/test.flag/overrides/user/x')
          .set('Cookie', session)
          .set('Origin', origin)
          .send({value: true, rolloutPercentage: 101})
      ).status,
    ).toBe(400);
  });
  it('clears rollout restrictions when an override uses null', async () => {
    await account();
    await FeatureDefinition.create({
      key: 'test.rollout',
      domain: 'test',
      default_value: false,
    });
    const server = app();
    const session = cookie(await login(server));
    const result = await request(server)
      .put('/staff/feature-flags/test.rollout/overrides/global/global')
      .set('Cookie', session)
      .set('Origin', origin)
      .send({value: true, rolloutPercentage: null, reason: 'Enable everyone'});
    expect(result.status).toBe(200);
    expect(
      (await FeatureOverride.findOne({key: 'test.rollout'}).lean())!
        .rollout_percentage,
    ).toBeNull();
  });
  it('locks an account after five failed attempts across requests', async () => {
    await account();
    const server = app();
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await request(server)
            .post('/staff/login')
            .set('Origin', origin)
            .send({email, password: 'wrong password', code: code()})
        ).status,
      ).toBe(401);
    }
    expect((await login(server)).status).toBe(401);
  });
  it('revokes sessions on credential replacement', async () => {
    await account();
    const server = app();
    const session = cookie(await login(server));
    await provisionStaff({
      operation: 'reset',
      email,
      password,
      totpSecret: secret,
      code: code(),
      permissions: ['flags:read'],
    });
    expect(
      (await request(server).get('/staff/session').set('Cookie', session))
        .status,
    ).toBe(401);
  });
});
