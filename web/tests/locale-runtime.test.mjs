import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const [locale, restore] of [['en','modal'],['kk','editor']]) {
  test(`${locale} full interface boots after a language reload and preserves ${restore} draft`, () => {
    const env = {...process.env,CQA_TEST_LOCALE:locale,CQA_TEST_RESTORE:restore};
    // Start a real independent test process; do not inherit Node's worker marker.
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'web/tests/react-app.test.mjs'], {
      env,encoding:'utf8',timeout:15000,
    });
    assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
    assert.match(result.stdout,/pass 1/,'the language scenario must actually execute');
  });
}
