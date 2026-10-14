import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {embedInputs} from '../../src/services/memory-search/engine';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map(folder => rm(folder, {recursive: true, force: true})),
  );
});

async function helper(response: string, ready = true, acceptQuit = true) {
  const folder = await mkdtemp(path.join(tmpdir(), 'memento-engine-test-'));
  folders.push(folder);
  const executable = path.join(folder, 'digup');
  await writeFile(
    executable,
    `#!/usr/bin/env node
const readline = require('node:readline');
console.log(JSON.stringify({ready:${ready},info:{model:'google/embeddinggemma-2',revision:'bfcd298762cc34d0357ece5ebdd31791a3a374d8',runtime:'llama.cpp-vectors1',dtype:'text-q8_0+mmproj-q8_0',dim:768}}));
readline.createInterface({input:process.stdin}).on('line', line => {
 const request = JSON.parse(line);
 if(request.op === 'quit') {${acceptQuit ? 'process.exit(0);' : 'return;'}}
 ${response}
});
`,
    {mode: 0o700},
  );
  return {executable, modelDir: folder};
}

describe('DigUp embedding protocol', () => {
  it('reads validated float32 vectors without passing backend credentials', async () => {
    process.env.MEMENTO_TEST_PRIVATE_TOKEN = 'should-not-inherit';
    const config = await helper(
      `if(process.env.MEMENTO_TEST_PRIVATE_TOKEN) process.exit(2); const values=Buffer.alloc(request.inputs.length*768*4); for(let i=0;i<request.inputs.length;i++) values.writeFloatLE(1,i*768*4); console.log(JSON.stringify({id:request.id,ok:true,dim:768,count:request.inputs.length,vectors:values.toString('base64'),errors:request.inputs.map(()=>null)}));`,
    );
    try {
      const result = await embedInputs(
        [{op: 'text', inputs: ['one', 'two']}],
        config,
      );
      expect(result[0]).toHaveLength(2);
      expect(result[0][0]).toHaveLength(768);
      expect(result[0][0][0]).toBe(1);
    } finally {
      delete process.env.MEMENTO_TEST_PRIVATE_TOKEN;
    }
  });

  it.each([
    `console.log(JSON.stringify({id:request.id,ok:true,dim:768,count:1,vectors:'AAAA',errors:[null]}));`,
    `console.log(JSON.stringify({id:request.id,ok:false,error:'Unreadable input'}));`,
    `const b=Buffer.alloc(768*4); console.log(JSON.stringify({id:request.id,ok:true,dim:768,count:1,vectors:b.toString('base64'),errors:[null]}));`,
    `process.exit(1);`,
  ])('rejects failed, truncated and empty embeddings', async response => {
    await expect(
      embedInputs([{op: 'text', inputs: ['one']}], await helper(response)),
    ).rejects.toThrow();
  });

  it('rejects a worker that cannot load its model', async () => {
    await expect(
      embedInputs([{op: 'text', inputs: ['one']}], await helper('', false)),
    ).rejects.toThrow();
  });

  it('terminates a stalled worker', async () => {
    // Ignore quit and remain alive after stdin closes, so process startup speed
    // cannot turn this timeout check into an ordinary protocol-error check.
    const config = await helper('setInterval(() => {}, 1000);', true, false);
    await expect(
      embedInputs([{op: 'text', inputs: ['one']}], config, 100),
    ).rejects.toThrow(/timed out/i);
  });
});
