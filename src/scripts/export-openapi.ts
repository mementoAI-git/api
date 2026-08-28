import {existsSync, readFileSync, writeFileSync} from 'fs';
import {resolve} from 'path';
import {
  buildOpenApiDocument,
  serializeOpenApi,
  stableChecksum,
} from '../contracts/openapi';

const root = process.cwd();
const jsonPath = resolve(root, 'openapi.json');
const checksumPath = resolve(root, 'openapi.sha256');
const document = buildOpenApiDocument();
const json = serializeOpenApi(document);
const checksum = `${stableChecksum(document)}  openapi.json\n`;

if (process.argv.includes('--check')) {
  const currentJson = existsSync(jsonPath)
    ? readFileSync(jsonPath, 'utf8')
    : '';
  const currentChecksum = existsSync(checksumPath)
    ? readFileSync(checksumPath, 'utf8')
    : '';
  if (currentJson !== json || currentChecksum !== checksum) {
    process.stderr.write(
      'OpenAPI artifacts are stale. Run npm run contracts:export.\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write('OpenAPI artifacts are current.\n');
  }
} else {
  writeFileSync(jsonPath, json);
  writeFileSync(checksumPath, checksum);
  process.stdout.write('Wrote openapi.json and openapi.sha256.\n');
}
