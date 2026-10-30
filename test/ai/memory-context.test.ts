import assert from 'node:assert/strict';
import test, {TestContext} from '../helpers/legacy-test';
import Memory from '../../src/module/database/model/memory';
import {
  buildMemoriesContext,
  getMemorySummaries,
} from '../../src/module/api/ai/memory-context';

interface Row {
  _id: string;
  user: string;
  type: string;
  status: string;
  title: string;
  body?: string;
  summary?: string;
  created_at: string;
  updated_at: string;
  topics?: string[];
}

const story: Row = {
  _id: 'new-story',
  user: 'host',
  type: 'story',
  status: 'save',
  title: 'A new adventure',
  body: '<p>I went hiking &amp; watched the sunrise.</p>',
  created_at: '2026-10-08T08:00:00.000Z',
  updated_at: '2026-10-08T08:00:00.000Z',
};

// Simulate database filtering and projection to catch summary-only queries
// and timestamps accidentally omitted from the retrieved documents.
function mockMemories(t: TestContext, rows: Row[]) {
  return t.mock.method(Memory, 'find', (query: Record<string, unknown>) => {
    let selected = rows.filter(row => {
      if (row.user !== query.user || row.type !== query.type) return false;
      if (['draft', 'deleted'].includes(row.status)) return false;
      const excluded = (query._id as {$ne?: string} | undefined)?.$ne;
      if (row._id === excluded) return false;
      if (query.summary && (row.summary === undefined || row.summary === null))
        return false;
      return true;
    });
    const chain = {
      sort(order: Record<string, number>) {
        selected.sort((a, b) => {
          for (const [field, direction] of Object.entries(order)) {
            const key = field as keyof Row;
            const result = String(a[key] ?? '').localeCompare(
              String(b[key] ?? ''),
            );
            if (result) return result * direction;
          }
          return 0;
        });
        return chain;
      },
      limit(limit: number) {
        selected = selected.slice(0, limit);
        return chain;
      },
      async select(fields: string) {
        // Like MongoDB, _id comes back unless excluded.
        return selected.map(row =>
          Object.fromEntries(
            ['_id', ...fields.split(' ')]
              .filter(field => field in row)
              .map(field => [field, row[field as keyof Row]]),
          ),
        );
      },
    };
    return chain as unknown as ReturnType<typeof Memory.find>;
  });
}

void test('a saved story is available before background summarization', async t => {
  mockMemories(t, [story]);
  const results = await getMemorySummaries('host');
  assert.equal(results.length, 1);
  assert.match(results[0].summary, /I went hiking & watched the sunrise/);
  assert.doesNotMatch(results[0].summary, /<p>/);
});

void test('excludes drafts, deleted stories, other hosts and the current conversation', async t => {
  mockMemories(t, [
    story,
    {...story, _id: 'draft', status: 'draft'},
    {...story, _id: 'deleted', status: 'deleted'},
    {...story, _id: 'other', user: 'someone-else'},
    {...story, _id: 'current', type: 'conversation', summary: 'Current chat'},
  ]);
  const results = await getMemorySummaries('host', 'current');
  assert.deepEqual(
    results.map(row => row.title),
    [story.title],
  );
});

void test('merges stories and conversations chronologically with timestamps', async t => {
  mockMemories(t, [
    {...story, summary: 'Latest hike'},
    {
      ...story,
      _id: 'chat',
      type: 'conversation',
      title: 'Old chat',
      summary: 'Chess and snacks',
      created_at: '2026-10-01T08:00:00.000Z',
    },
  ]);
  const results = await getMemorySummaries('host');
  assert.deepEqual(
    results.map(row => row.title),
    [story.title, 'Old chat'],
  );
  assert.equal(
    (results[0] as unknown as {created_at: string}).created_at,
    story.created_at,
  );
});

void test('an edited old story cannot displace the newest post and current text', async t => {
  mockMemories(t, [
    {...story, summary: 'Outdated summary'},
    {
      ...story,
      _id: 'older',
      title: 'An old post',
      created_at: '2026-09-01T08:00:00.000Z',
      updated_at: '2026-10-09T08:00:00.000Z',
    },
  ]);
  const context = buildMemoriesContext(await getMemorySummaries('host'));
  assert.match(context, /LATEST SAVED STORY[^\n]*A new adventure/);
  assert.match(context, /2026-10-08T08:00:00.000Z/);
  assert.match(context, /I went hiking/);
  assert.doesNotMatch(context, /Outdated summary/);
  assert.match(context, /do not guess/i);
});

void test('story excerpts and retrieval stay bounded', async t => {
  mockMemories(
    t,
    Array.from({length: 20}, (_, i) => ({
      ...story,
      _id: `story-${i}`,
      body: 'a'.repeat(10000),
    })),
  );
  const results = await getMemorySummaries('host');
  assert.equal(results.length, 12);
  assert.ok(results.every(row => row.summary.length <= 2001));
});

void test('an attachment-only latest story is identified without inventing content', async t => {
  mockMemories(t, [{...story, body: '<p></p>'}]);
  const context = buildMemoriesContext(await getMemorySummaries('host'));
  assert.match(context, /LATEST SAVED STORY/);
  assert.match(context, /no text.*available/i);
});
