import {vi} from 'vitest';
vi.mock('../../src/utils/config', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/utils/config')>()),
  FRONTEND_URL: 'https://web.test',
}));
import assert from 'node:assert/strict';
import {test, mock} from '../helpers/legacy-test';
import {createHash} from 'node:crypto';
import User from '../../src/module/database/model/user';
import Persona from '../../src/module/database/model/persona';
import PublicProfile from '../../src/module/database/model/public-profile';
import {
  getPublicProfile,
  publishProfile,
  revokeProfile,
} from '../../src/module/api/public-profile/service';
import {
  PROFILE_CSP,
  renderPublicProfile,
} from '../../src/module/api/public-profile/view';

const token = 'f880209e-7c70-4e99-9ddf-ff180f220f21';
function query(value: unknown) {
  return {
    select() {
      return this;
    },
    lean: async () => value,
  };
}

void test('publishing selects only public fields and scopes updates to the authenticated owner', async () => {
  let update: Record<string, unknown> = {};
  const user = mock.method(User, 'findOne', (filter: unknown) => {
    assert.deepEqual(filter, {_id: 'owner', deleted: {$ne: true}});
    return query({
      first_name: 'Alex',
      last_name: 'Smith',
      picture: '',
      email: 'private@example.com',
    });
  });
  const persona = mock.method(Persona, 'findOne', (filter: unknown) => {
    assert.deepEqual(filter, {user: 'owner'});
    return query({
      self_description: 'My written bio',
      memory_insights_summary: 'Private AI summary',
    });
  });
  const save = mock.method(
    PublicProfile,
    'findOneAndUpdate',
    (filter: unknown, payload: Record<string, unknown>) => {
      assert.deepEqual(filter, {user: 'owner'});
      update = payload;
      return query({token});
    },
  );
  try {
    assert.deepEqual(await publishProfile('owner'), {token});
    assert.deepEqual(update.$set, {
      display_name: 'Alex Smith',
      bio: 'My written bio',
      picture_url: null,
    });
    assert.equal(JSON.stringify(update).includes('private@example.com'), false);
    assert.equal(JSON.stringify(update).includes('Private AI summary'), false);
  } finally {
    user.mock.restore();
    persona.mock.restore();
    save.mock.restore();
  }
});
void test('public reads return a whitelist and reject deleted accounts', async () => {
  const read = mock.method(PublicProfile, 'findOne', () =>
    query({
      token,
      user: 'owner',
      display_name: 'Alex',
      bio: 'Bio',
      picture_url: null,
      email: 'secret',
    }),
  );
  const exists = mock.method(User, 'exists', async () => ({_id: 'owner'}));
  try {
    assert.deepEqual(await getPublicProfile(token), {
      token,
      display_name: 'Alex',
      bio: 'Bio',
      picture_url: null,
    });
    exists.mock.mockImplementation(async () => null);
    await assert.rejects(getPublicProfile(token), /Profile not found/);
    await assert.rejects(
      getPublicProfile('../../users'),
      /Invalid profile link/,
    );
  } finally {
    read.mock.restore();
    exists.mock.restore();
  }
});
void test('HTML includes complete crawler-readable preview metadata and escapes user content', () => {
  const html = renderPublicProfile(
    {
      token,
      display_name: 'Alex "<script>alert(1)</script>',
      bio: '<img src=x onerror=alert(1)>',
      picture_url: null,
    },
    'https://memento.example/',
  );
  assert.ok(
    html.includes(
      `property="og:url" content="https://memento.example/profile/${token}"`,
    ),
  );
  assert.ok(
    html.includes(
      'property="og:image" content="https://memento.example/og/profile.png"',
    ),
  );
  assert.ok(html.includes('property="og:image:width" content="1200"'));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img src=x'), false);
  const style = html.match(/<style>([\s\S]*?)<\/style>/)![1];
  assert.ok(
    PROFILE_CSP.includes(createHash('sha256').update(style).digest('base64')),
  );
});
void test('revocation is owner-scoped', async () => {
  const remove = mock.method(
    PublicProfile,
    'deleteOne',
    async (filter: unknown) => {
      assert.deepEqual(filter, {user: 'owner'});
      return {deletedCount: 1};
    },
  );
  try {
    await revokeProfile('owner');
    assert.equal(remove.mock.callCount(), 1);
  } finally {
    remove.mock.restore();
  }
});

void test('public HTTP route serves OG HTML without a login and disables caching', async () => {
  const express = (await import('express')).default;
  const {default: router} = await import(
    '../../src/module/api/public-profile/routes'
  );
  const read = mock.method(PublicProfile, 'findOne', () =>
    query({
      token,
      user: 'owner',
      display_name: 'Alex Smith',
      bio: 'My public introduction',
      picture_url: null,
    }),
  );
  const exists = mock.method(User, 'exists', async () => ({_id: 'owner'}));
  const app = express();
  app.use('/public/profiles', router);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as {port: number};
    const response = await fetch(
      `http://127.0.0.1:${address.port}/public/profiles/${token}`,
    );
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.includes('text/html'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-security-policy'), PROFILE_CSP);
    const html = await response.text();
    assert.ok(html.includes('property="og:image"'));
    assert.ok(html.includes('<h1>Alex Smith</h1>'));
    assert.equal(html.includes('owner'), false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
    read.mock.restore();
    exists.mock.restore();
  }
});
