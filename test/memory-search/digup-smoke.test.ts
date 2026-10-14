import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import request from 'supertest';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createUserFixture, issueLegacyAccessToken} from '../helpers/factories';
import {createTestApp} from '../helpers/app';
import Memory from '../../src/module/database/model/memory';
import File from '../../src/module/database/model/file';
import {indexMemory} from '../../src/services/memory-search/indexing';

vi.mock('../../src/services/storage', async importOriginal => ({
  ...(await importOriginal<object>()),
  getFile: async (name: string) => ({
    Body: Readable.from([
      await readFile(
        path.join('test/fixtures/memory-search-trial', path.basename(name)),
      ),
    ]),
  }),
}));
vi.mock('../../src/services/queues/memory-search', () => ({
  queueMemorySearch: vi.fn(async () => false),
}));

describe.skipIf(process.env.RUN_DIGUP_SMOKE !== 'true')(
  'actual model through the authenticated memory search endpoint',
  () => {
    beforeAll(connectTestDatabase);
    afterAll(closeTestDatabase);
    afterEach(async () => {
      vi.unstubAllEnvs();
      await clearTestDatabase();
    });

    it('searches fictional stories and public photos in an isolated test database', async () => {
      const base = 'test/fixtures/memory-search-trial';
      const fixture = JSON.parse(
        await readFile(path.join(base, 'collection.json'), 'utf8'),
      );
      const owner = await createUserFixture();
      vi.stubEnv('MEMORY_SEARCH_ENABLED', 'true');
      vi.stubEnv('MEMORY_SEARCH_USER_IDS', owner.id);
      const ids = new Map<string, string>();
      for (const sample of fixture.memories) {
        const attachments: string[] = [];
        if (sample.kind === 'photo') {
          const bytes = await readFile(path.join(base, sample.file));
          const file = await File.create({
            user: owner.id,
            name: sample.file,
            type: 'image/png',
            size: bytes.length,
            provider: 's3',
            status: 'ready',
            access_mode: 'signed_only',
          });
          attachments.push(file.id);
        }
        const memory = await Memory.create({
          user: owner.id,
          title: sample.title,
          body:
            sample.kind === 'story'
              ? await readFile(path.join(base, sample.file), 'utf8')
              : '',
          type: 'story',
          status: 'save',
          attachments,
        });
        ids.set(sample.id, memory.id);
        expect(await indexMemory(owner.id, memory.id)).toBe(true);
      }
      const queries = [
        ...fixture.queries,
        {
          text: 'the place we lived just after getting married',
          expected: ['s01'],
        },
        {
          text: 'Dad learning to fix electronics for a living',
          expected: ['s05'],
        },
        {text: 'Mum telling stories during a blackout', expected: ['s08']},
        {text: 'the puppy that became part of the family', expected: ['s10']},
        {text: 'our flight to Tokyo', expected: []},
        {text: 'a dog playing in snow', expected: []},
      ];
      const app = createTestApp();
      const token = issueLegacyAccessToken(owner);
      const rows = [];
      for (const query of queries) {
        const started = Date.now();
        const response = await request(app)
          .get('/memories/search')
          .query({q: query.text})
          .auth(token, {type: 'bearer'});
        expect(response.status).toBe(200);
        expect(response.body.data.search.mode).toBe('hybrid');
        const docs: {
          _id: string;
          title: string;
          attachments: {url: string; access?: unknown}[];
        }[] = response.body.data.docs;
        const expected = query.expected.map(id => ids.get(id));
        const position = docs.findIndex(doc => expected.includes(doc._id));
        rows.push({
          query: query.text,
          expected: query.expected,
          results: docs.map(doc => doc.title),
          rank: position < 0 ? null : position + 1,
          milliseconds: Date.now() - started,
        });
        expect(JSON.stringify(response.body)).not.toContain('search_index');
        for (const doc of docs)
          for (const file of doc.attachments) {
            expect(file.url).toContain('sig=');
            expect(file.access).toBeDefined();
          }
      }
      const positives = rows.filter(row => row.expected.length);
      const negatives = rows.filter(row => !row.expected.length);
      const summary = {
        queries: rows.length,
        positives: positives.length,
        top1: positives.filter(row => row.rank === 1).length,
        top3: positives.filter(row => row.rank && row.rank <= 3).length,
        negatives: negatives.length,
        falsePositives: negatives.filter(row => row.results.length).length,
      };
      await mkdir('tmp/memory-search-integration', {recursive: true});
      await writeFile(
        'tmp/memory-search-integration/results.json',
        JSON.stringify({summary, rows}, null, 2) + '\n',
      );
      await writeFile(
        'tmp/memory-search-integration/results.md',
        [
          '# Memento integrated search test',
          '',
          'Actual model, authenticated API, isolated database, fictional stories and public photos. Default pilot relevance thresholds; no production data.',
          '',
          JSON.stringify(summary),
          '',
          '| Search | Results | Correct position |',
          '| --- | --- | --- |',
          ...rows.map(
            row =>
              `| ${row.query} | ${row.results.join('; ') || 'None'} | ${row.rank || '—'} |`,
          ),
          '',
        ].join('\n'),
      );
      console.log('Integrated search measurements:', JSON.stringify(summary));
      // A small correctness smoke check, not a claim that every query is solved.
      expect(rows.find(row => row.query === 'our first home').rank).toBe(1);
      expect(rows.find(row => row.query === 'a close-up of a cat').rank).toBe(
        1,
      );
    }, 180_000);
  },
);
