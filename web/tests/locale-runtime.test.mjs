import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const locale of ['en','kk']) {
  test(`${locale} full interface boots and preserves selection and modal draft through live language changes`, () => {
    const env = {...process.env,CQA_TEST_LOCALE:locale};
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'web/tests/react-app.test.mjs'], {
      env,encoding:'utf8',timeout:15000,
    });
    assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
    assert.match(result.stdout,/pass 1/,'the full interface scenario must execute');
  });
}
