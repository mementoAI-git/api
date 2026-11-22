import {execFileSync} from 'child_process';
import {readFileSync} from 'fs';
import * as path from 'path';
import {describe, expect, it} from 'vitest';

/**
 * scripts/deploy.sh streams scripts/deploy/<env>/*.sh to the server, the
 * same scripts the GitHub workflows embed as heredocs. Keep them identical,
 * so a manual deploy and an Actions deploy do exactly the same thing.
 */
function heredocs(workflow: string): string[] {
  const lines = readFileSync(workflow, 'utf8').split('\n');
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes("<<'REMOTE'")) continue;
    let end = i + 1;
    while (lines[end].trim() !== 'REMOTE') end += 1;
    const body = lines.slice(i + 1, end);
    const indent = Math.min(
      ...body.filter(l => l.trim()).map(l => l.length - l.trimStart().length),
    );
    blocks.push(body.map(l => l.slice(indent)).join('\n') + '\n');
  }
  return blocks;
}

/** macOS ships bash 3.2, whose parser chokes on `case` inside `$( )`; the server and CI run bash 5. */
const bashMajor = Number(
  execFileSync('bash', ['-c', 'echo ${BASH_VERSINFO[0]}']).toString().trim(),
);

const CASES: [string, string, string[]][] = [
  [
    'prod',
    '.github/workflows/deploy-prod.yml',
    ['prepare-release.sh', 'activate-release.sh'],
  ],
  [
    'dev',
    '.github/workflows/deploy-dev.yml',
    ['prepare-release.sh', 'activate-release.sh', 'cleanup-failed-release.sh'],
  ],
];

describe('manual deploy scripts', () => {
  it.each(CASES)(
    '%s scripts match the workflow heredocs',
    (env, workflow, files) => {
      const blocks = heredocs(path.join(process.cwd(), workflow));
      expect(blocks).toHaveLength(files.length);
      files.forEach((file, index) => {
        const script = readFileSync(
          path.join(process.cwd(), 'scripts/deploy', env, file),
          'utf8',
        );
        expect(script).toBe(blocks[index]);
      });
    },
  );

  it
    .skipIf(bashMajor < 4)
    .each([
      'scripts/deploy.sh',
      ...CASES.flatMap(([env, , files]) =>
        files.map(f => `scripts/deploy/${env}/${f}`),
      ),
    ])('%s is valid bash', file => {
    expect(() =>
      execFileSync('bash', ['-n', path.join(process.cwd(), file)]),
    ).not.toThrow();
  });

  it('refuses to run without an environment or settings', () => {
    const run = (args: string[]) => {
      try {
        execFileSync(
          'bash',
          [path.join(process.cwd(), 'scripts/deploy.sh'), ...args],
          {
            stdio: 'pipe',
            env: {...process.env, HOME: '/nonexistent'},
            cwd: '/tmp',
          },
        );
        return 0;
      } catch (error) {
        return (error as {status: number}).status;
      }
    };
    expect(run([])).toBe(2);
    expect(run(['staging'])).toBe(2);
  });
});
