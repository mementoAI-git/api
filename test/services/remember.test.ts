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
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const {generateText, provider} = vi.hoisted(() => ({
  generateText: vi.fn(),
  provider: {down: false},
}));
vi.mock('../../src/services/ai', () => ({
  default: {
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
import {
  forgetObservation,
  listObservations,
} from '../../src/module/api/persona/observations';
import {
  handleForgetRequest,
  handleRememberRequest,
  parseForgetRequest,
  parseRememberedCard,
  parseRememberRequest,
  rememberFact,
  REMEMBERED_PREFIX,
} from '../../src/module/api/persona/remember';
import {CONTENT_ACTION_HANDLERS} from '../../src/module/api/ai/voice/content-actions';
import {filterForgottenInsights} from '../../src/workers/insight/forgotten';

const card = (extra = {}) =>
  JSON.stringify({
    field: 'important_notes',
    category: 'relationships_people',
    heading: 'Your sister Ada lives in Lagos',
    note: 'You talk every Sunday.',
    ...extra,
  });

describe('remembering a fact', () => {
  let userId: string;

  beforeAll(async () => {
    await connectTestDatabase();
    await ObservationView.init();
  });
  beforeEach(async () => {
    generateText.mockReset();
    generateText.mockResolvedValue(card());
    provider.down = false;
    userId = (await createUserFixture({nickname: 'Pat'})).id;
  });
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('saves the fact for the AI and shows a card straight away', async () => {
    const {id} = await rememberFact(userId, 'My sister Ada lives in Lagos');

    const persona = await Persona.findOne({user: userId}).lean();
    expect(persona!.important_notes).toEqual([
      `${REMEMBERED_PREFIX} My sister Ada lives in Lagos`,
    ]);
    const {data} = await listObservations(userId);
    expect(data.generating).toBe(false);
    expect(data.observations).toEqual([
      expect.objectContaining({
        id,
        heading: 'Your sister Ada lives in Lagos',
        note: 'You talk every Sunday.',
      }),
    ]);
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it('saves and replies without waiting for a slow card, which arrives later', async () => {
    let finish = (_value: string) => {};
    generateText.mockReturnValue(
      new Promise<string>(resolve => {
        finish = resolve;
      }),
    );

    const result = await rememberFact(userId, 'My sister Ada lives in Lagos');

    expect(result).toEqual({id: null});
    const persona = await Persona.findOne({user: userId}).lean();
    expect(persona!.important_notes).toHaveLength(1);

    finish(card());
    await vi.waitFor(
      async () => {
        const {data} = await listObservations(userId);
        expect(data.observations).toHaveLength(1);
      },
      {timeout: 5_000},
    );
  });

  it('puts a preference in preferences', async () => {
    generateText.mockResolvedValue(card({field: 'key_preferences'}));

    await rememberFact(userId, 'I prefer tea');

    const {data} = await listObservations(userId);
    expect(data.observations[0].field).toBe('key_preferences');
  });

  it('links the conversation it was said in as a source', async () => {
    const chat = await Memory.create({
      user: userId,
      type: 'conversation',
      status: 'save',
      title: 'Host chat',
      body: '',
    });

    await rememberFact(userId, 'My sister Ada', {memory: String(chat._id)});

    const {data} = await listObservations(userId);
    expect(data.observations[0].source_count).toBe(1);
  });

  it('does not duplicate when asked twice', async () => {
    const first = await rememberFact(userId, 'My sister Ada lives in Lagos');
    const second = await rememberFact(userId, 'My sister Ada lives in Lagos');

    expect(second.id).toBe(first.id);
    const persona = await Persona.findOne({user: userId}).lean();
    expect(persona!.important_notes).toHaveLength(1);
    expect((await listObservations(userId)).data.observations).toHaveLength(1);
  });

  it('still saves the fact when the card cannot be written', async () => {
    provider.down = true;

    const result = await rememberFact(userId, 'My sister Ada');

    expect(result).toEqual({id: null});
    const persona = await Persona.findOne({user: userId}).lean();
    expect(persona!.important_notes).toHaveLength(1);
    // Curation writes the card later, since it is still unprocessed.
    provider.down = false;
    generateText.mockResolvedValue(JSON.stringify({cards: []}));
    expect((await listObservations(userId)).data.generating).toBe(true);
    await vi.waitFor(async () => {
      expect((await listObservations(userId)).data.generating).toBe(false);
    });
    const prompt = generateText.mock.lastCall![0][0].content as string;
    expect(prompt).toContain('Always keep it');
  });

  it('does not show a card written in the third person', async () => {
    generateText.mockResolvedValue(card({heading: "User's sister is Ada"}));

    const {id} = await rememberFact(userId, 'My sister is Ada');

    expect(id).toBeNull();
  });

  it('can be forgotten, and asking again brings it back', async () => {
    const {id} = await rememberFact(userId, 'My sister Ada');
    await forgetObservation(userId, id!);
    expect((await listObservations(userId)).data.observations).toEqual([]);
    const fact = `${REMEMBERED_PREFIX} My sister Ada`;
    expect(
      (await filterForgottenInsights(userId, {important_notes: [fact]}))
        .important_notes,
    ).toEqual([]);

    await rememberFact(userId, 'My sister Ada');

    expect((await listObservations(userId)).data.observations).toHaveLength(1);
    expect(
      (await filterForgottenInsights(userId, {important_notes: [fact]}))
        .important_notes,
    ).toEqual([fact]);
  });

  describe('forgetting', () => {
    const forget = CONTENT_ACTION_HANDLERS.forget_observation;
    const remembered = async (heading: string, note: string, fact: string) => {
      generateText.mockResolvedValueOnce(card({heading, note}));
      await rememberFact(userId, fact);
    };
    const headings = async () =>
      (await listObservations(userId)).data.observations.map(
        item => item.heading,
      );

    it('reads back first, and only forgets with the code', async () => {
      await remembered(
        'You love jollof',
        'You love jollof rice.',
        'I love jollof rice',
      );
      await remembered(
        'Your sister Ada',
        'Ada lives in Lagos.',
        'My sister Ada lives in Lagos',
      );

      const first = await forget(userId, {query: 'jollof rice'});
      expect(first.result).toContain('Nothing has happened yet');
      expect(await headings()).toHaveLength(2);

      const code = first.result.match(/confirmation "([^"]+)"/)?.[1];
      const done = await forget(userId, {
        query: 'jollof rice',
        confirmation: code,
      });
      expect(done.result).toContain('Forgotten');
      expect(done.effects).toEqual([{type: 'refresh', what: 'observations'}]);
      expect(await headings()).toEqual(['Your sister Ada']);
    });

    it('removes nothing when it cannot tell which one they mean', async () => {
      await remembered(
        'You love jollof',
        'You love jollof rice.',
        'I love jollof rice',
      );
      await remembered(
        'You love fried rice',
        'You love fried rice too.',
        'I love fried rice',
      );

      const run = await forget(userId, {query: 'rice'});
      expect(run.result).toContain('Nothing was removed');
      expect(await headings()).toHaveLength(2);
    });

    it('says so when nothing matches', async () => {
      await remembered(
        'You love jollof',
        'You love jollof rice.',
        'I love jollof rice',
      );
      const run = await forget(userId, {query: 'my blue bicycle'});
      expect(run.result).toContain('nothing matched');
    });

    it('recognises a typed request, not everyday use of the word', () => {
      expect(parseForgetRequest('Please forget that I love jollof.')).toBe(
        'I love jollof',
      );
      expect(parseForgetRequest('delete the observation about my sister')).toBe(
        'my sister',
      );
      expect(parseForgetRequest('remove jollof from my preferences')).toBe(
        'jollof',
      );
      expect(parseForgetRequest('forget it')).toBeNull();
      expect(parseForgetRequest('forget that')).toBeNull();
      expect(parseForgetRequest("don't forget that I love jollof")).toBeNull();
      expect(
        parseForgetRequest('forget that time we went to Lagos'),
      ).toBeNull();
      expect(parseForgetRequest('I always forget my keys')).toBeNull();
    });

    it('forgets from typed chat only when every word matches one card', async () => {
      await remembered(
        'You love jollof',
        'You love jollof rice.',
        'I love jollof rice',
      );

      const missed = await handleForgetRequest(
        userId,
        'forget that I love jollof and eggs',
      );
      expect(missed).toContain('Do not say it is forgotten');
      expect(await headings()).toHaveLength(1);

      const done = await handleForgetRequest(
        userId,
        'forget that I love jollof',
      );
      expect(done).toContain('you just removed');
      expect(await headings()).toEqual([]);
    });
  });

  it('holds the curation lease while the card is written, so the page polls for it', async () => {
    let finish: (value: string) => void = () => undefined;
    generateText.mockReturnValueOnce(
      new Promise<string>(resolve => {
        finish = resolve;
      }),
    );
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
    const saving = rememberFact(userId, 'I love jollof rice');
    await vi.advanceTimersByTimeAsync(3_000);
    vi.useRealTimers();
    await saving;

    const during = await listObservations(userId);
    expect(during.data.generating).toBe(true);
    expect(during.data.observations).toEqual([]);

    finish(card({heading: 'You love jollof', note: 'You love jollof rice.'}));
    await vi.waitFor(async () => {
      const after = await listObservations(userId);
      expect(after.data.observations).toHaveLength(1);
      expect(after.data.generating).toBe(false);
    });
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  describe('voice tool', () => {
    const tool = CONTENT_ACTION_HANDLERS.remember_fact;

    it('saves and lets the host undo it', async () => {
      const run = await tool(userId, {fact: 'My sister Ada lives in Lagos'});

      expect(run.result).toContain('Saved');
      expect(run.undo).toEqual({
        kind: 'forget_observation',
        id: expect.any(String),
      });
      expect(await PendingInsight.countDocuments({user: userId})).toBe(0);
    });

    it('asks when there is nothing to save', async () => {
      const run = await tool(userId, {fact: '  '});

      expect(run.result).toContain('nothing to remember');
      expect(generateText).not.toHaveBeenCalled();
    });
  });

  describe('typed chat', () => {
    it('saves a request and tells the AI to confirm it', async () => {
      const chat = await Memory.create({
        user: userId,
        type: 'conversation',
        status: 'save',
        title: 'Host chat',
        body: '',
      });

      const note = await handleRememberRequest(
        userId,
        'Remember that my sister Ada lives in Lagos',
        undefined,
        String(chat._id),
      );

      expect(note).toContain('You just saved this');
      expect(note).toContain('my sister Ada lives in Lagos');
      expect((await listObservations(userId)).data.observations).toHaveLength(
        1,
      );
    });

    it('does nothing for an ordinary message', async () => {
      expect(
        await handleRememberRequest(
          userId,
          'I remember that my dad loved Sundays',
          undefined,
          'memory',
        ),
      ).toBe('');
      expect(generateText).not.toHaveBeenCalled();
    });
  });
});

describe('parseRememberRequest', () => {
  it.each([
    [
      'Remember that my sister Ada lives in Lagos',
      'my sister Ada lives in Lagos',
    ],
    ['please remember that I hate coriander', 'I hate coriander'],
    ['Can you remember that I hate coriander?', 'I hate coriander?'],
    ["Don't forget that Ada's birthday is in May", "Ada's birthday is in May"],
    ['Keep in mind that I am vegetarian', 'I am vegetarian'],
    ['Remember this: I am vegetarian', 'I am vegetarian'],
    ['save to memory that I am vegetarian', 'I am vegetarian'],
    ['Note that I am vegetarian', 'I am vegetarian'],
    ['I am vegetarian. Remember that.', 'I am vegetarian'],
    ['I am vegetarian, add this as a fact', 'I am vegetarian'],
    ['I am vegetarian. Please save that to your memory', 'I am vegetarian'],
  ])('finds the fact in %j', (message, fact) => {
    expect(parseRememberRequest(message)).toBe(fact);
  });

  it.each([
    ['Remember this'],
    ['add that as a fact'],
    ['please save this to memory.'],
    ["don't forget that"],
  ])('uses the previous message for %j', message => {
    expect(parseRememberRequest(message, 'I am vegetarian')).toBe(
      'I am vegetarian',
    );
    expect(parseRememberRequest(message)).toBeNull();
  });

  it.each([
    ['I remember that my dad loved Sundays'],
    ['Do you remember that song?'],
    ['Remember that time we went to Lagos?'],
    ['Remember that day at the beach'],
    ['Remember when we went to Lagos'],
    ['What did I tell you to remember?'],
    ['I want to add this as a fact'],
    ['Notes from today'],
    ['It is hard to remember things'],
  ])('ignores %j', message => {
    expect(parseRememberRequest(message, 'Previous')).toBeNull();
  });
});

describe('parseRememberedCard', () => {
  it('accepts a field label and defaults an unknown field', () => {
    expect(
      parseRememberedCard(
        card({category: 'Relationships & People', field: 'nonsense'}),
      ),
    ).toMatchObject({
      category: 'relationships_people',
      field: 'important_notes',
    });
  });

  it.each([
    ['no heading', {heading: ''}],
    ['no note', {note: ''}],
    ['third person', {note: 'The user talks to her weekly.'}],
  ])('rejects %s', (_name, change) => {
    expect(parseRememberedCard(card(change))).toBeNull();
  });

  it('keeps the card when the category is wrong', () => {
    expect(parseRememberedCard(card({category: 'nope'}))?.category).toBe(
      'identity_self',
    );
  });

  it('rejects unusable output', () => {
    expect(parseRememberedCard('not json')).toBeNull();
  });
});
