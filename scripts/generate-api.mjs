import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';

const check = process.argv.includes('--check');
if (process.argv.slice(2).some((argument) => argument !== '--check')) {
  throw new Error('Usage: node scripts/generate-api.mjs [--check]');
}

const contractUrl = new URL('../api/openapi.yaml', import.meta.url);
const outputUrl = new URL('../src/api/generated.ts', import.meta.url);
const source = JSON.parse(await readFile(new URL('../api/source.json', import.meta.url), 'utf8'));
const contract = await readFile(contractUrl);
if (
  !/^[a-f0-9]{40}$/.test(source.commit) ||
  createHash('sha256').update(contract).digest('hex') !== source.sha256
) {
  throw new Error(
    'The pinned API contract does not match api/source.json. Update its provenance deliberately.',
  );
}

const generated = `// Backend source commit: ${source.commit}\n${astToString(await openapiTS(contractUrl))}`;
if (check) {
  if ((await readFile(outputUrl, 'utf8')) !== generated) {
    throw new Error(
      'API types are out of date. Run npm run api:generate and review the contract change.',
    );
  }
} else {
  await writeFile(outputUrl, generated);
}
