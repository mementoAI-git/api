import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {z} from 'zod';

const kind = z.enum(['story', 'photo']);
const schema = z
  .object({
    version: z.literal(1),
    memories: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
            title: z.string().trim().min(1).max(160),
            kind,
            file: z.string().min(1).max(500),
          })
          .strict(),
      )
      .min(2)
      .max(30),
    queries: z
      .array(
        z
          .object({
            text: z
              .string()
              .trim()
              .min(1)
              .max(200)
              .refine(
                value =>
                  !/^(-|code:)/i.test(value) &&
                  !Array.from(value).some(char => char.charCodeAt(0) < 32),
                'Use an ordinary memory description',
              ),
            expected: z.array(z.string()).max(30),
            kind: kind.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

type Manifest = z.infer<typeof schema>;
type Sample = Manifest['memories'][number] & {
  source: string;
  text: string;
  extension: string;
};
export type Collection = {memories: Sample[]; queries: Manifest['queries']};
export type ExecuteDigUp = (args: string[]) => Promise<string>;

function isWithin(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** Explicit local files only. Does not connect to Memento, storage or a database. */
export async function loadCollection(
  manifestPath: string,
): Promise<Collection> {
  const manifestFile = await realpath(manifestPath);
  const root = path.dirname(manifestFile);
  const manifestStat = await lstat(manifestFile);
  if (!manifestStat.isFile() || manifestStat.size > 256 * 1024)
    throw new Error('Collection manifest must be a file under 256 KiB');
  const manifest = schema.parse(
    JSON.parse(await readFile(manifestFile, 'utf8')),
  );
  const ids = new Set(manifest.memories.map(memory => memory.id));
  if (ids.size !== manifest.memories.length)
    throw new Error('Memory IDs must be unique');
  for (const query of manifest.queries) {
    for (const id of query.expected) {
      const sample = manifest.memories.find(memory => memory.id === id);
      if (!sample || (query.kind && sample.kind !== query.kind))
        throw new Error(`Unknown or incompatible expected memory: ${id}`);
    }
  }
  const memories: Sample[] = [];
  let totalBytes = 0;
  for (const memory of manifest.memories) {
    if (path.isAbsolute(memory.file))
      throw new Error('Use relative file paths inside the collection');
    const candidate = path.resolve(root, memory.file);
    if (!isWithin(root, candidate))
      throw new Error('File is outside the approved collection');
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink())
      throw new Error('Collection files cannot be symlinks');
    if (!stat.isFile())
      throw new Error('Collection entries must be ordinary files');
    const source = await realpath(candidate);
    if (!isWithin(root, source))
      throw new Error('File resolves outside the approved collection');
    const extension = path.extname(source).toLowerCase();
    const allowed =
      memory.kind === 'story'
        ? ['.txt', '.md']
        : ['.jpg', '.jpeg', '.png', '.webp', '.heic'];
    if (!allowed.includes(extension))
      throw new Error(`Unsupported ${memory.kind} file: ${extension}`);
    const maxBytes = memory.kind === 'story' ? 1024 * 1024 : 20 * 1024 * 1024;
    totalBytes += stat.size;
    if (
      stat.size === 0 ||
      stat.size > maxBytes ||
      totalBytes > 100 * 1024 * 1024
    )
      throw new Error('Collection is empty or exceeds trial size limits');
    memories.push({
      ...memory,
      source,
      extension,
      text: memory.kind === 'story' ? await readFile(source, 'utf8') : '',
    });
  }
  return {memories, queries: manifest.queries};
}

// A transparent comparison, not a claim to reproduce the production search ranker.
function keywordSearch(
  collection: Collection,
  query: Collection['queries'][number],
): string[] {
  const stopWords = new Set([
    'the',
    'and',
    'our',
    'was',
    'for',
    'find',
    'with',
    'about',
    'where',
    'show',
    'when',
    'that',
  ]);
  const words = [
    ...new Set(query.text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []),
  ].filter(word => !stopWords.has(word));
  return collection.memories
    .filter(memory => !query.kind || memory.kind === query.kind)
    .map(memory => {
      const title = memory.title.toLowerCase();
      const body = memory.text.toLowerCase();
      return {
        id: memory.id,
        score: words.reduce(
          (score, word) =>
            score +
            (title.includes(word) ? 3 : 0) +
            (body.includes(word) ? 2 : 0),
          0,
        ),
      };
    })
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map(row => row.id);
}

const hitSchema = z
  .array(
    z
      .object({
        path: z.string(),
        kind: z.string(),
        cosine: z.number().finite().optional(),
        keyword_rank: z.number().optional(),
      })
      .passthrough(),
  )
  .max(100);

type Match = {
  id: string;
  title: string;
  kind: 'story' | 'photo';
  meaningMatch: boolean;
};
type QueryResult = {
  text: string;
  kind: 'story' | 'photo' | 'all';
  expected: string[];
  matches: Match[];
  keywordMatches: string[];
  rank: number | null;
  keywordRank: number | null;
  milliseconds: number;
};

function firstRank(ids: string[], expected: string[]): number | null {
  const index = ids.findIndex(id => expected.includes(id));
  return index < 0 ? null : index + 1;
}

function summarize(rows: QueryResult[]) {
  const positives = rows.filter(row => row.expected.length > 0);
  const negatives = rows.filter(row => row.expected.length === 0);
  return {
    positiveQueries: positives.length,
    top1: positives.filter(row => row.rank === 1).length,
    top3: positives.filter(row => row.rank !== null && row.rank <= 3).length,
    keywordTop1: positives.filter(row => row.keywordRank === 1).length,
    negativeQueries: negatives.length,
    falsePositiveQueries: negatives.filter(row => row.matches.length > 0)
      .length,
    semanticQueries: rows.filter(row =>
      row.matches.some(match => match.meaningMatch),
    ).length,
  };
}

/** Runs only against a fresh copy of the approved samples, never a user's DigUp index. */
export async function runTrial(collection: Collection, execute: ExecuteDigUp) {
  const workspace = await realpath(
    await mkdtemp(path.join(tmpdir(), 'memento-memory-trial-')),
  );
  try {
    const samples = path.join(workspace, 'samples');
    const index = path.join(workspace, 'index');
    await mkdir(samples, {mode: 0o700});
    const staged = new Map<string, Sample>();
    for (const memory of collection.memories) {
      const target = path.join(samples, memory.id + memory.extension);
      await copyFile(memory.source, target);
      staged.set(target, memory);
    }
    const started = performance.now();
    await execute(['index', samples, '--index', index]);
    const indexingMilliseconds = Math.round(performance.now() - started);
    const status = await execute(['status', '--index', index]);
    const vectors = Number(
      status.match(/vectors:\s*([\d,]+)/)?.[1]?.replace(/,/g, '') || 0,
    );
    if (vectors === 0)
      throw new Error(
        'DigUp produced no vectors. Install its model before evaluating meaning search.',
      );
    if (
      /\b(?:failed|pending|partial|skipped)\b/.test(status) ||
      /long files still being read/.test(status)
    )
      throw new Error(
        'DigUp indexing is incomplete; inspect the files and model before rerunning.',
      );
    const queries: QueryResult[] = [];
    for (const query of collection.queries) {
      const args = [
        'search',
        query.text,
        '--index',
        index,
        '--json',
        '-n',
        '5',
      ];
      if (query.kind)
        args.push(
          '--kind',
          query.kind === 'story' ? 'doc' : 'image,screenshot',
        );
      const queryStarted = performance.now();
      const raw = hitSchema.parse(JSON.parse(await execute(args)));
      const matches: Match[] = [];
      for (const hit of raw) {
        const memory = staged.get(path.resolve(hit.path));
        if (!memory)
          throw new Error(
            'DigUp returned a file outside the approved trial collection',
          );
        if (query.kind && memory.kind !== query.kind)
          throw new Error('DigUp returned an unexpected file type');
        if (matches.some(match => match.id === memory.id)) continue;
        matches.push({
          id: memory.id,
          title: memory.title,
          kind: memory.kind,
          meaningMatch: hit.cosine !== undefined,
        });
      }
      const keywordMatches = keywordSearch(collection, query);
      queries.push({
        text: query.text,
        kind: query.kind || 'all',
        expected: query.expected,
        matches,
        keywordMatches,
        rank: firstRank(
          matches.map(match => match.id),
          query.expected,
        ),
        keywordRank: firstRank(keywordMatches, query.expected),
        milliseconds: Math.round(performance.now() - queryStarted),
      });
    }
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      engine: 'DigUp / EmbeddingGemma 2',
      engineVersion:
        status.split('\n').find(line => line.startsWith('this digup:')) ||
        'Version not reported',
      modelFingerprint:
        status.split('\n').find(line => line.startsWith('built with:')) ||
        'Fingerprint not reported',
      sampleCount: collection.memories.length,
      samples: collection.memories.map(({id, title, kind}) => ({
        id,
        title,
        kind,
      })),
      photoCount: collection.memories.filter(memory => memory.kind === 'photo')
        .length,
      vectorCount: vectors,
      indexingMilliseconds,
      summary: {
        ...summarize(queries),
        byKind: {
          story: summarize(queries.filter(row => row.kind === 'story')),
          photo: summarize(queries.filter(row => row.kind === 'photo')),
          all: summarize(queries.filter(row => row.kind === 'all')),
        },
      },
      queries,
    };
  } finally {
    await rm(workspace, {recursive: true, force: true});
  }
}

export type TrialReport = Awaited<ReturnType<typeof runTrial>>;

export function renderReport(report: TrialReport): string {
  const escape = (value: string) =>
    value
      .replace(/[\r\n]/g, ' ')
      .replace(/\|/g, '\\|')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const summary = report.summary;
  const label = (id: string) =>
    escape(report.samples.find(sample => sample.id === id)?.title || id);
  return [
    '# Memento memory search trial',
    '',
    'Local sample collection only. This is an experiment, not a production search result.',
    '',
    `Samples: ${report.sampleCount} (${report.photoCount} photos). Search vectors: ${report.vectorCount}.`,
    report.engineVersion,
    report.modelFingerprint,
    `Indexing: ${(report.indexingMilliseconds / 1000).toFixed(1)} seconds. Search times below include starting the local model.`,
    '',
    `Correct first result: ${summary.top1}/${summary.positiveQueries}. Correct result in first three: ${summary.top3}/${summary.positiveQueries}.`,
    `Simple keyword comparison, correct first result: ${summary.keywordTop1}/${summary.positiveQueries}.`,
    `Queries with unwanted results: ${summary.falsePositiveQueries}/${summary.negativeQueries} no-match tests.`,
    `Queries returning a meaning-based match: ${summary.semanticQueries}/${report.queries.length}.`,
    '',
    '| Search | Expected | Results in order | Correct result position | Keyword position | Time |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.queries.map(
      row =>
        `| ${escape(row.text)} | ${row.expected.map(label).join(', ') || 'No match'} | ${row.matches.map(match => escape(match.title)).join(', ') || 'None'} | ${row.rank ?? '—'} | ${row.keywordRank ?? '—'} | ${row.milliseconds} ms |`,
    ),
    '',
    'Small sample scores do not establish family-photo recognition, multilingual quality, production speed or readiness.',
    'A meaning match means the engine supplied a similarity score; it does not prove the match is correct.',
    'The keyword comparison uses titles and written content. It does not reproduce Memento’s production search.',
    'Photo matching recognizes visible content, not who a person is or their relationship to the owner.',
    '',
  ].join('\n');
}
