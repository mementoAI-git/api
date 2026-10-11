import express, {NextFunction, Request, Response} from 'express';
import {Server} from 'http';
import {afterAll, afterEach, beforeAll, expect, it, vi} from 'vitest';
import routes from '../../src/module/api/people/routes';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import Beneficiary from '../../src/module/database/model/beneficiary';
import Memory from '../../src/module/database/model/memory';
import * as activation from '../../src/module/api/people/activation';
import {generateConnectionReply} from '../../src/module/api/people/talk-generator';
vi.mock('../../src/module/api/people/talk-generator', () => ({
  generateConnectionReply: vi.fn(),
}));
let server: Server;
let base: string;
beforeAll(async () => {
  await connectTestDatabase();
  const app = express();
  app.use(express.json());
  app.use('/api/people', routes);
  app.use(
    (
      error: {statusCode?: number; message: string},
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      void _next;
      return res
        .status(error.statusCode || 500)
        .json({success: false, message: error.message});
    },
  );
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/people`;
});
afterEach(async () => {
  vi.clearAllMocks();
  await clearTestDatabase();
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve())),
  );
  await closeTestDatabase();
});
async function pair() {
  const owner = await createUserFixture({first_name: 'Tunde'});
  const viewer = await createUserFixture();
  await Beneficiary.create({
    benefactor: owner.id,
    user: viewer.id,
    email: viewer.email,
    status: 'accepted',
    access_scope: 'shared_only',
  });
  const token = issueLegacyAccessToken(viewer);
  const request = (
    path: string,
    method = 'GET',
    body?: unknown,
    auth = token,
  ) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? {Authorization: `Bearer ${auth}`} : {}),
      },
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
  return {owner, viewer, request};
}
it('enforces the authenticated HTTP boundary and validates source ownership', async () => {
  const {owner, viewer, request} = await pair();
  expect((await request('', 'GET', undefined, '')).status).toBe(401);
  expect((await request('/invalid/space')).status).toBe(422);
  const foreign = await Memory.create({
    user: owner.id,
    title: 'Private',
    status: 'save',
  });
  expect(
    (await request(`/${owner.id}/share`, 'POST', {source_id: foreign.id}))
      .status,
  ).toBe(404);
  const source = await Memory.create({
    user: viewer.id,
    title: 'Our trip',
    body: 'My perspective',
    status: 'save',
  });
  const shared = await request(`/${owner.id}/share`, 'POST', {
    source_id: source.id,
  });
  expect(shared.status).toBe(200);
  expect(((await shared.json()) as {data: unknown}).data).toMatchObject({
    source_id: source.id,
    contributor: {user_id: viewer.id},
    shared_via: 'share_from_memento',
  });
  const archive = await request(
    `/${owner.id}/space?page=1&limit=20&filter=all`,
  );
  expect(
    ((await archive.json()) as {data: {items: unknown[]}}).data.items,
  ).toHaveLength(1);
  const outsider = await createUserFixture();
  expect(
    (
      await request(
        `/${owner.id}/items/${source.id}`,
        'GET',
        undefined,
        issueLegacyAccessToken(outsider),
      )
    ).status,
  ).toBe(404);
});
it('keeps Talk viewer-owned through HTTP and responds to blocking without stale access', async () => {
  const {owner, viewer, request} = await pair();
  const payload = {text: 'Hello', request_id: crypto.randomUUID()};
  expect((await request(`/${owner.id}/talk`, 'POST', payload)).status).toBe(
    403,
  );
  await activation.update(owner.id, {
    approved_context: 'Approved perspective',
    active: true,
  });
  vi.mocked(generateConnectionReply).mockResolvedValue({
    text: 'Hello from the approved context.',
    source_ids: [],
  });
  const reply = await request(`/${owner.id}/talk`, 'POST', payload);
  expect(reply.status).toBe(200);
  expect(
    ((await reply.json()) as {data: {available: boolean}}).data.available,
  ).toBe(true);
  const history = await request(`/${owner.id}/talk`);
  expect(
    ((await history.json()) as {data: {turns: unknown[]}}).data.turns,
  ).toHaveLength(2);
  await activation.update(viewer.id, {
    approved_context: 'Viewer context',
    active: true,
  });
  const reverse = await request(
    `/${viewer.id}/talk`,
    'GET',
    undefined,
    issueLegacyAccessToken(owner),
  );
  expect(
    ((await reverse.json()) as {data: {turns: unknown[]}}).data.turns,
  ).toHaveLength(0);
  expect(
    (await request(`/${owner.id}/disconnect`, 'POST', {block: true})).status,
  ).toBe(200);
  expect((await request(`/${owner.id}/talk`)).status).toBe(404);
  expect(
    (
      await request(`/${owner.id}/talk`, 'POST', {
        ...payload,
        request_id: crypto.randomUUID(),
      })
    ).status,
  ).toBe(404);
});
