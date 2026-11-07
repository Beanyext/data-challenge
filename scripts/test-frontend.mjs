import { build } from 'esbuild';
import { mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// The integration test exercises the exact artifact served by the static server.
await import('./build-frontend.mjs');

const directory = 'web/tests';
const files = await readdir(directory);
const tests = files.filter(file => file.endsWith('.test.mjs')).map(file => path.join(directory, file));
await mkdir('outputs/frontend-tests', { recursive: true });
for (const file of files.filter(file => file.endsWith('.test.tsx'))) {
  const output = path.join('outputs/frontend-tests', file.replace(/\.tsx$/, '.mjs'));
  await build({ entryPoints: [path.join(directory, file)], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', jsx: 'automatic', logLevel: 'silent' });
  tests.push(output);
}
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...tests], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
