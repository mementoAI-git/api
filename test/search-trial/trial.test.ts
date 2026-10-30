import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  loadCollection,
  renderReport,
  runTrial,
} from '../../src/scripts/memory-search-trial/trial';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map(folder => rm(folder, {recursive: true, force: true})),
  );
});

async function collection() {
  const folder = await mkdtemp(path.join(tmpdir(), 'memento-trial-test-'));
  folders.push(folder);
  await writeFile(
    path.join(folder, 'one.txt'),
    'We moved into a tiny apartment after the wedding.',
  );
  await writeFile(
    path.join(folder, 'two.txt'),
    'My father repaired radios in his workshop.',
  );
  const manifest = {
    version: 1,
    memories: [
      {id: 'one', title: 'Starting out', kind: 'story', file: 'one.txt'},
      {id: 'two', title: 'His workshop', kind: 'story', file: 'two.txt'},
    ],
    queries: [
      {text: 'our first home', expected: ['one']},
      {text: 'a skiing holiday', expected: []},
    ],
  };
  const file = path.join(folder, 'collection.json');
  await writeFile(file, JSON.stringify(manifest));
  return {folder, file, manifest};
}

describe('approved local collection', () => {
  it('reads only explicitly listed stories, leaving other files out', async () => {
    const {folder, file} = await collection();
    await writeFile(path.join(folder, 'private.txt'), 'Not part of the trial');
    const loaded = await loadCollection(file);
    expect(loaded.memories.map(memory => memory.id)).toEqual(['one', 'two']);
    expect(loaded.memories[0].text).toContain('tiny apartment');
  });

  it.each(['../private.txt', '/tmp/private.txt'])(
    'rejects paths outside the collection: %s',
    async value => {
      const {file, manifest} = await collection();
      manifest.memories[0].file = value;
      await writeFile(file, JSON.stringify(manifest));
      await expect(loadCollection(file)).rejects.toThrow(/relative|outside/);
    },
  );

  it('rejects symlinks instead of reading their targets', async () => {
    const {folder, file, manifest} = await collection();
    await symlink(path.join(folder, 'two.txt'), path.join(folder, 'link.txt'));
    manifest.memories[0].file = 'link.txt';
    await writeFile(file, JSON.stringify(manifest));
    await expect(loadCollection(file)).rejects.toThrow(/symlink/);
  });

  it('rejects parent symlinks that escape the approved folder', async () => {
    const {folder, file, manifest} = await collection();
    const outside = await mkdtemp(path.join(tmpdir(), 'memento-outside-'));
    folders.push(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'Private');
    await symlink(outside, path.join(folder, 'nested'));
    manifest.memories[0].file = 'nested/secret.txt';
    await writeFile(file, JSON.stringify(manifest));
    await expect(loadCollection(file)).rejects.toThrow(/outside/);
  });

  it('rejects unknown expected IDs, duplicate IDs, unsupported files and command-like queries', async () => {
    const {file, manifest} = await collection();
    for (const changed of [
      {...manifest, queries: [{text: 'home', expected: ['missing']}]},
      {...manifest, memories: [manifest.memories[0], manifest.memories[0]]},
      {...manifest, queries: [{text: '--reindex', expected: ['one']}]},
      {...manifest, queries: [{text: 'code: secrets', expected: ['one']}]},
      {...manifest, memories: [{...manifest.memories[0], file: 'secrets.env'}]},
    ]) {
      await writeFile(file, JSON.stringify(changed));
      await expect(loadCollection(file)).rejects.toThrow();
    }
  });
});

describe('local DigUp trial', () => {
  it('uses an isolated index, compares rankings and counts unwanted matches honestly', async () => {
    const {file} = await collection();
    let staged = '';
    let index = '';
    const execute = vi.fn(async (args: string[]) => {
      if (args[0] === 'index') {
        staged = args[1];
        index = args[3];
        expect(await readFile(path.join(staged, 'one.txt'), 'utf8')).toContain(
          'apartment',
        );
        return 'indexed';
      }
      if (args[0] === 'status')
        return 'vectors: 2 in 2 segments\n  doc 2 done 2';
      expect(args).toContain(index);
      return JSON.stringify([
        {path: path.join(staged, 'one.txt'), kind: 'doc', cosine: 0.8},
      ]);
    });
    const result = await runTrial(await loadCollection(file), execute);
    expect(result.queries[0].matches[0].id).toBe('one');
    expect(result.queries[0].keywordMatches).toEqual([]);
    expect(result.summary.top1).toBe(1);
    expect(result.summary.falsePositiveQueries).toBe(1);
    expect(result.summary.negativeQueries).toBe(1);
    expect(result.summary.semanticQueries).toBe(2);
    await expect(readFile(path.join(staged, 'one.txt'))).rejects.toThrow();
    expect(JSON.stringify(result)).not.toContain(staged);
    const report = renderReport(result);
    expect(report).toContain('Starting out');
    expect(report).toContain('1/1 no-match tests');
  });

  it('does not report a keyword-only index as a successful meaning search', async () => {
    const {file} = await collection();
    const execute = vi.fn(async (args: string[]) =>
      args[0] === 'status' ? 'vectors: 0 in 0 segments' : '',
    );
    await expect(runTrial(await loadCollection(file), execute)).rejects.toThrow(
      /no vectors/i,
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('rejects incomplete indexing, even when some vectors exist', async () => {
    const {file} = await collection();
    const execute = vi.fn(async (args: string[]) =>
      args[0] === 'status'
        ? 'vectors: 1 in 1 segments\n doc 2 done 1 failed 1'
        : '',
    );
    await expect(runTrial(await loadCollection(file), execute)).rejects.toThrow(
      /incomplete/i,
    );
  });

  it('does not silently count skipped photos as tested', async () => {
    const {file} = await collection();
    const execute = async (args: string[]) =>
      args[0] === 'status'
        ? 'vectors: 1 in 1 segments\n doc 1 done\n image 1 skipped'
        : '';
    await expect(runTrial(await loadCollection(file), execute)).rejects.toThrow(
      /incomplete/i,
    );
  });

  it('rejects results outside the staged collection', async () => {
    const {file} = await collection();
    const execute = vi.fn(async (args: string[]) => {
      if (args[0] === 'status') return 'vectors: 2 in 2 segments';
      if (args[0] === 'search')
        return JSON.stringify([{path: '/some/private/file.txt', kind: 'doc'}]);
      return '';
    });
    await expect(runTrial(await loadCollection(file), execute)).rejects.toThrow(
      /outside/,
    );
  });

  it('removes staged content when the engine fails and leaves the source unchanged', async () => {
    const {file, folder} = await collection();
    let staged = '';
    const execute = async (args: string[]) => {
      staged = args[1];
      throw new Error('Model unavailable');
    };
    await expect(runTrial(await loadCollection(file), execute)).rejects.toThrow(
      'Model unavailable',
    );
    await expect(readFile(path.join(staged, 'one.txt'))).rejects.toThrow();
    expect(await readFile(path.join(folder, 'one.txt'), 'utf8')).toContain(
      'apartment',
    );
  });

  it('accepts image files and measures image-only searches separately', async () => {
    const {file, folder, manifest} = await collection();
    await mkdir(path.join(folder, 'photos'));
    await writeFile(
      path.join(folder, 'photos', 'portrait.jpg'),
      Buffer.from([0xff, 0xd8, 0xff]),
    );
    const mixed = {
      ...manifest,
      memories: [
        ...manifest.memories,
        {
          id: 'photo',
          title: 'Photo',
          kind: 'photo',
          file: 'photos/portrait.jpg',
        },
      ],
      queries: [{text: 'a person', expected: ['photo'], kind: 'photo'}],
    };
    await writeFile(file, JSON.stringify(mixed));
    let staged = '';
    const execute = async (args: string[]) => {
      if (args[0] === 'index') staged = args[1];
      if (args[0] === 'status') return 'vectors: 3 in 3 segments';
      if (args[0] !== 'search') return '';
      expect(args).toContain('image,screenshot');
      return JSON.stringify([
        {path: path.join(staged, 'photo.jpg'), kind: 'image', cosine: 0.7},
      ]);
    };
    const result = await runTrial(await loadCollection(file), execute);
    expect(result.summary.byKind.photo.top1).toBe(1);
  });
});
