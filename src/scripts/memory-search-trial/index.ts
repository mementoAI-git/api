import {execFile} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs, promisify} from 'node:util';
import {loadCollection, renderReport, runTrial} from './trial';

const execFileAsync = promisify(execFile);

async function main() {
  const {values} = parseArgs({
    options: {
      manifest: {type: 'string'},
      digup: {type: 'string'},
      models: {type: 'string'},
      output: {type: 'string'},
      help: {type: 'boolean'},
    },
  });
  if (values.help) {
    console.log(
      'Usage: npm run search:trial -- --manifest <collection.json> --digup <digup executable> --models <model folder> [--output tmp/memory-search-trial]',
    );
    return;
  }
  if (!values.manifest || !values.digup || !values.models)
    throw new Error(
      'Supply --manifest, --digup and --models. Use --help for an example.',
    );
  const collection = await loadCollection(path.resolve(values.manifest));
  const executable = path.resolve(values.digup);
  // Do not inherit credentials or a DIGUP_WORKER_DIR override from the backend.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    DIGUP_MODELS: path.resolve(values.models),
  };
  const report = await runTrial(collection, async args => {
    const {stdout} = await execFileAsync(executable, args, {
      env,
      encoding: 'utf8',
      timeout: args[0] === 'index' ? 600_000 : 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  });
  const output = path.resolve(values.output || 'tmp/memory-search-trial');
  await mkdir(output, {recursive: true, mode: 0o700});
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(report, null, 2) + '\n',
    {mode: 0o600},
  );
  await writeFile(path.join(output, 'results.md'), renderReport(report), {
    mode: 0o600,
  });
  console.log(renderReport(report));
  console.log(`Reports saved to ${output}`);
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Memory search trial failed',
  );
  process.exitCode = 1;
});
