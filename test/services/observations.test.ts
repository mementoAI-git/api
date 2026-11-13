import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import request from 'supertest';
import {createTestApp} from '../helpers/app';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';

const {generateText, provider} = vi.hoisted(() => ({
  generateText: vi.fn(),
  provider: {down: false},
}));
vi.mock('../../src/services/ai', () => ({
  default: {
    // A plain function, because Vitest fails a test when a vi.fn rejects
    // inside work the test does not await.
    generateText: async (messages: unknown) => {
      if (provider.down) throw new Error('provider down');
      return generateText(messages);
    },
  },
}));

import Memory from '../../src/module/database/model/memory';
import ObservationView from '../../src/module/database/model/observation-view';
import PendingInsight from '../../src/module/database/model/pending-insight';
import Persona from '../../src/module/database/model/persona';
import {applyCuration} from '../../src/module/api/persona/observations';
import {speaksToMember} from '../../src/utils/member-voice';
import {filterForgottenInsights} from '../../src/workers/insight/forgotten';

type Auth = Record<string, string>;

async function member() {
  const user = await createUserFixture({nickname: 'Pat'});
  return {
    userId: user.id as string,
    auth: {Authorization: `Bearer ${issueLegacyAccessToken(user)}`} as Auth,
  };
}

async function memory(userId: string, title: string, status = 'save') {
  return Memory.create({
    user: userId,
    type: 'story',
    status,
    title,
    body: `${title} body`,
  });
}

function pending(
  userId: string,
  memoryId: unknown,
  content: string,
  field = 'important_notes',
) {
  return PendingInsight.create({
    user: userId,
    memory: String(memoryId),
    source: 'story',
    field,
    content,
  });
}

function card(sources: string[], heading: string, extra = {}) {
  return {
    sources,
    heading,
    note: 'You often mention this when talking about home.',
    field: 'important_notes',
    category: 'relationships_people',
    ...extra,
  };
}

async function get(auth: Auth) {
  const response = await request(createTestApp())
    .get('/persona/observations')
    .set(auth)
    .expect(200);
  return response.body.data as {
    generating: boolean;
    observations: {
      id: string;
      field: string;
      heading: string;
      note: string;
      category_key: string;
      source_count: number;
    }[];
  };
}

/** Lets curation finish, including later batches, then returns the result. */
async function curated(auth: Auth, ...replies: object[][]) {
  for (const cards of replies) {
    generateText.mockResolvedValueOnce(JSON.stringify({cards}));
  }
  generateText.mockResolvedValue(JSON.stringify({cards: []}));
  await vi.waitFor(async () => {
    expect((await get(auth)).generating).toBe(false);
  });
  return (await get(auth)).observations;
}

describe('curated observations', () => {
  beforeAll(async () => {
    await connectTestDatabase();
    await ObservationView.init();
  });
  beforeEach(() => {
    generateText.mockReset();
    provider.down = false;
  });
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('requires authentication', async () => {
    await request(createTestApp()).get('/persona/observations').expect(401);
  });

  it('asks nothing of the model when there are no facts', async () => {
    const {auth} = await member();

    expect(await get(auth)).toEqual({observations: [], generating: false});
    expect(generateText).not.toHaveBeenCalled();
  });

  it('shows only the facts the curation keeps, written for the member', async () => {
    const {userId, auth} = await member();
    const story = await memory(userId, 'Home');
    await Persona.create({
      user: userId,
      important_notes: ["User's mother is named Maria"],
      key_preferences: ['Prefers the AI to use the Hannah voice'],
    });
    await pending(userId, story._id, 'User has two sisters');

    const observations = await curated(auth, [
      card(['F1'], 'Your mother is named Maria', {note: 'She comes up often.'}),
    ]);

    expect(observations).toEqual([
      expect.objectContaining({
        heading: 'Your mother is named Maria',
        note: 'She comes up often.',
        category_key: 'relationships_people',
      }),
    ]);
    const prompt = generateText.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('Prefers the AI to use the Hannah voice');
    expect(prompt).toContain('Pat');
  });

  it('keeps left-out facts for the AI and does not consider them again', async () => {
    const {userId, auth} = await member();
    await Persona.create({
      user: userId,
      key_preferences: ['Prefers the Hannah voice'],
    });

    await curated(auth, []);
    generateText.mockClear();
    await get(auth);

    expect(generateText).not.toHaveBeenCalled();
    const persona = await Persona.findOne({user: userId}).lean();
    expect(persona!.key_preferences).toEqual(['Prefers the Hannah voice']);
  });

  it('merges facts into one card and counts all their memories', async () => {
    const {userId, auth} = await member();
    const first = await memory(userId, 'First');
    const second = await memory(userId, 'Second');
    await pending(userId, first._id, 'User loves nature photography');
    await pending(userId, second._id, 'User has an interest in photography');

    const observations = await curated(auth, [
      card(['F1', 'F2'], 'You love nature photography'),
    ]);

    expect(observations).toHaveLength(1);
    expect(observations[0].source_count).toBe(2);
    const sources = await request(createTestApp())
      .get(`/persona/observations/${observations[0].id}/sources`)
      .set(auth)
      .expect(200);
    expect(
      sources.body.data.sources.map((source: {title: string}) => source.title),
    ).toEqual(expect.arrayContaining(['First', 'Second']));
  });

  it('attaches new facts to an existing card instead of adding another', async () => {
    const {userId, auth} = await member();
    const first = await memory(userId, 'First');
    await pending(userId, first._id, 'User loves photography');
    const [existing] = await curated(auth, [
      card(['F1'], 'You love photography'),
    ]);
    const second = await memory(userId, 'Second');
    await pending(userId, second._id, 'User photographs birds on weekends');

    const observations = await curated(auth, [
      {sources: ['F1'], merge_into: 'C1'} as never,
    ] as never);

    expect(observations.map(item => item.id)).toEqual([existing.id]);
    expect(observations[0].source_count).toBe(2);
  });

  it('works through long lists a batch at a time', async () => {
    const {userId, auth} = await member();
    await Persona.create({
      user: userId,
      important_notes: Array.from({length: 45}, (_, i) => `Fact ${i}`),
    });

    await curated(auth, []);

    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it('does not curate facts again for a reader holding a stale view', async () => {
    const {userId, auth} = await member();
    await Persona.create({user: userId, important_notes: ['A fact']});
    await curated(auth);
    expect(generateText).toHaveBeenCalledTimes(1);

    // This reader read the view before the first curation finished.
    const stale = await ObservationView.findOne({user: userId}).lean();
    const findOne = vi.spyOn(ObservationView, 'findOne').mockReturnValueOnce({
      lean: async () => ({...stale, processed: [], generating_until: null}),
    } as never);
    try {
      expect((await get(auth)).generating).toBe(false);
    } finally {
      findOne.mockRestore();
    }

    expect(generateText).toHaveBeenCalledTimes(1);
    const view = await ObservationView.findOne({user: userId}).lean();
    expect(view!.generating_until).toBeNull();
  });

  it('only starts one curation for concurrent readers', async () => {
    const {userId, auth} = await member();
    await Persona.create({user: userId, important_notes: ['A fact']});
    generateText.mockResolvedValue(JSON.stringify({cards: []}));

    await Promise.all(Array.from({length: 5}, () => get(auth)));
    await curated(auth);

    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it('backs off and tries later when curation fails', async () => {
    const {userId, auth} = await member();
    await Persona.create({user: userId, important_notes: ['A fact']});
    provider.down = true;

    await get(auth);
    await vi.waitFor(async () => {
      const view = await ObservationView.findOne({user: userId}).lean();
      expect(view!.next_attempt_at).toBeTruthy();
    });

    expect(await get(auth)).toEqual({observations: [], generating: false});
    const view = await ObservationView.findOne({user: userId}).lean();
    expect(view!.processed).toEqual([]);
  });

  it('hides a card once its only memory is deleted', async () => {
    const {userId, auth} = await member();
    const story = await memory(userId, 'Home');
    await pending(userId, story._id, 'User lived in Accra');
    await curated(auth, [card(['F1'], 'You once lived in Accra')]);

    await Memory.updateOne({_id: story._id}, {status: 'deleted'});

    expect((await get(auth)).observations).toEqual([]);
  });

  it('drops the wording once the facts behind a card are purged', async () => {
    const {userId, auth} = await member();
    const story = await memory(userId, 'Home');
    await pending(userId, story._id, 'User lived in Accra');
    await curated(auth, [card(['F1'], 'You once lived in Accra')]);

    await PendingInsight.deleteMany({user: userId});
    await get(auth);

    const view = await ObservationView.findOne({user: userId}).lean();
    expect(view!.items).toEqual([]);
  });

  describe('editing', () => {
    async function seeded() {
      const account = await member();
      const story = await memory(account.userId, 'Home');
      await Persona.create({
        user: account.userId,
        important_notes: ['User has two sisters', 'Unrelated fact'],
        memory_insights_summary: 'stale',
      });
      await pending(account.userId, story._id, 'User has two sisters');
      const [target] = await curated(account.auth, [
        card(['F1'], 'You have two sisters'),
      ]);
      return {...account, target};
    }

    it('saves the wording and keeps it attributed for the AI', async () => {
      const {userId, auth, target} = await seeded();

      await request(createTestApp())
        .patch(`/persona/observations/${target.id}`)
        .set(auth)
        .send({heading: 'You have three sisters', note: 'All of them older.'})
        .expect(200);

      const persona = await Persona.findOne({user: userId}).lean();
      expect(persona!.important_notes).toEqual([
        "In the user's own words: You have three sisters. All of them older.",
        'Unrelated fact',
      ]);
      expect(persona!.memory_insights_summary).toBeUndefined();
      const [card] = (await get(auth)).observations;
      expect(card).toMatchObject({
        id: target.id,
        heading: 'You have three sisters',
        note: 'All of them older.',
      });
    });

    it('keeps sources after an edit and never curates it again', async () => {
      const {auth, target} = await seeded();
      await request(createTestApp())
        .patch(`/persona/observations/${target.id}`)
        .set(auth)
        .send({heading: 'You have three sisters', note: 'All older.'})
        .expect(200);
      generateText.mockClear();

      const {observations, generating} = await get(auth);

      expect(generating).toBe(false);
      expect(generateText).not.toHaveBeenCalled();
      expect(observations[0].source_count).toBe(1);
    });

    it('stops the old wording being extracted again', async () => {
      const {userId, auth, target} = await seeded();
      await request(createTestApp())
        .patch(`/persona/observations/${target.id}`)
        .set(auth)
        .send({heading: 'You have three sisters', note: 'All older.'})
        .expect(200);

      const filtered = await filterForgottenInsights(userId, {
        important_notes: ['User has two sisters', 'User sails'],
      });

      expect(filtered.important_notes).toEqual(['User sails']);
    });
  });

  describe('forgetting', () => {
    it('removes the card and every fact behind it, keeping memories', async () => {
      const {userId, auth} = await member();
      const story = await memory(userId, 'Home');
      await Persona.create({
        user: userId,
        important_notes: ['User has two sisters', 'Unrelated fact'],
      });
      await pending(userId, story._id, 'User has two sisters.');
      const [target] = await curated(auth, [
        card(['F1'], 'You have two sisters'),
      ]);

      await request(createTestApp())
        .delete(`/persona/observations/${target.id}`)
        .set(auth)
        .expect(200);

      expect((await get(auth)).observations).toEqual([]);
      const persona = await Persona.findOne({user: userId}).lean();
      expect(persona!.important_notes).toEqual(['Unrelated fact']);
      expect(await PendingInsight.countDocuments({user: userId})).toBe(0);
      expect(await Memory.countDocuments({user: userId})).toBe(1);
    });

    it('does not bring it back when it is extracted again', async () => {
      const {userId, auth} = await member();
      const story = await memory(userId, 'Home');
      await pending(userId, story._id, 'User has two sisters');
      const [target] = await curated(auth, [
        card(['F1'], 'You have two sisters'),
      ]);
      await request(createTestApp())
        .delete(`/persona/observations/${target.id}`)
        .set(auth)
        .expect(200);

      const filtered = await filterForgottenInsights(userId, {
        important_notes: ['User has two sisters.', 'User loves sailing'],
      });

      expect(filtered.important_notes).toEqual(['User loves sailing']);
    });
  });

  it.each([
    ['patch', {heading: 'Anything', note: 'Something'}],
    ['delete', undefined],
  ] as const)('keeps %s scoped to the member', async (method, body) => {
    const owner = await member();
    const other = await member();
    await Persona.create({user: owner.userId, important_notes: ['Private']});
    const [target] = await curated(owner.auth, [
      card(['F1'], 'Your private thing'),
    ]);

    await request(createTestApp())
      [method](`/persona/observations/${target.id}`)
      .set(other.auth)
      .send(body)
      .expect(404);

    expect((await get(owner.auth)).observations[0].heading).toBe(
      'Your private thing',
    );
  });

  it.each([
    ['an empty heading', 'patch', 'a'.repeat(24), {heading: ' ', note: 'Note'}],
    ['an empty note', 'patch', 'a'.repeat(24), {heading: 'Hi', note: ' '}],
    [
      'an overlong note',
      'patch',
      'a'.repeat(24),
      {heading: 'Hi', note: 'x'.repeat(379)},
    ],
    ['a malformed id', 'delete', 'not-an-id', undefined],
  ] as const)('rejects %s', async (_name, method, id, body) => {
    const {auth} = await member();
    await request(createTestApp())
      [method](`/persona/observations/${id}`)
      .set(auth)
      .send(body)
      .expect(422);
  });
});

describe('applyCuration', () => {
  const factIdByRef = new Map([
    ['F1', 'fact-1'],
    ['F2', 'fact-2'],
  ]);
  const apply = (cards: object[], existing: never[] = []) =>
    applyCuration({raw: JSON.stringify({cards}), existing, factIdByRef})!;

  it.each([
    ['third person heading', {heading: "User's main hobby is photography"}],
    ['third person note', {note: 'The user mentions this a lot.'}],
    ['no note', {note: ''}],
    ['no heading', {heading: ''}],
    ['an unknown field', {field: 'social_accounts'}],
    ['an unknown category', {category: 'not_a_field'}],
    ['invented facts', {sources: ['F99']}],
  ])('rejects a card with %s', (_name, change) => {
    expect(apply([{...card(['F1'], 'You love sailing'), ...change}])).toEqual(
      [],
    );
  });

  it("accepts a field's label as well as its key", () => {
    const [item] = apply([
      card(['F1'], 'You love sailing', {category: 'Passions & Interests'}),
    ]);

    expect(item.category).toBe('passions_interests');
  });

  it('merges a repeated heading into the first card', () => {
    const items = apply([
      card(['F1'], 'You love sailing'),
      card(['F2'], 'you love sailing.'),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].sources).toEqual(['fact-1', 'fact-2']);
  });

  it('cleans the heading and removes long dashes', () => {
    const [item] = apply([card(['F1'], 'You sail — often.')]);

    expect(item.heading).toBe('You sail , often');
  });

  it('returns null for unusable output but accepts keeping nothing', () => {
    const input = {existing: [], factIdByRef};
    expect(applyCuration({...input, raw: 'not json'})).toBeNull();
    expect(applyCuration({...input, raw: '{"cards":[]}'})).toEqual([]);
  });
});

describe('speaksToMember', () => {
  it.each([
    ['You have two sisters', true],
    ['Your app helps its users share memories', true],
    ['The user has two sisters', false],
    ["User's mother is Maria", false],
    ['User plans to travel', false],
    ["It shows in the host's stories", false],
  ])('%s -> %s', (text, expected) => {
    expect(speaksToMember(text)).toBe(expected);
  });
});
