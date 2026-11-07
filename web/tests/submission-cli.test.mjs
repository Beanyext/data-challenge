import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../check-submission.mjs', import.meta.url));
const CRITERIA = ['contact', 'discovery', 'identification', 'consultation', 'empathy', 'dialogue', 'closure', 'critical'];

function documents(dataset = 'prod') {
  const records = Array.from({ length: dataset === 'dev' ? 65 : 10 }, (_, index) => ({
    conversation_id: `fixture-${index + 1}`,
    channel: dataset === 'dev' && index >= 60 ? 'voice call' : 'agent chat',
    transcript: [
      { timestamp: '00:01', speaker: 'client', text: 'Вымышленный клиент: сұрақ <&>.' },
      { timestamp: '00:02', speaker: 'operator', text: 'Вымышленный ответ оператора.' },
      { timestamp: '00:03', speaker: 'system', text: 'Вымышленная системная реплика.' },
    ],
  }));
  return {
    source: { isSuccess: true, data: { dataset_group_id: dataset.toUpperCase(), total_records: records.length, records } },
    input: {
      schema_version: '1.0', team_name: 'seeusoon', model: { mode: 'external_api', name: 'fixture-model' },
      results: records.map(dialog => ({
        conversation_id: dialog.conversation_id, status: 'ok',
        criteria: CRITERIA.map((criterion_id, index) => ({ criterion_id, value: [true, null, null, 20, true, 10, true, false][index], rationale: 'Учебный тест', evidence_turns: [2] })),
        score: { final_score: 100, critical_flag: false },
      })),
    },
  };
}

function fixture(t, data = documents()) {
  const dir = mkdtempSync(join(tmpdir(), 'cqa-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'исходный набор.json'), input = join(dir, 'результат.json');
  writeFileSync(source, JSON.stringify(data.source), 'utf8');
  writeFileSync(input, JSON.stringify(data.input), 'utf8');
  const args = ['--dataset', data.source.data.dataset_group_id.toLowerCase(), '--source', source, '--input', input];
  function run(customArgs = args) {
    const result = spawnSync(process.execPath, [CLI, ...customArgs], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return { ...result, output: result.stdout + result.stderr };
  }
  return { dir, source, input, args, run };
}

test('CLI accepts ten canonical PROD results and prints only aggregate diagnostics', t => {
  const files = fixture(t), result = files.run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Проверка: пройдена/);
  assert.match(result.output, /исходных диалогов: 10; результатов: 10; status=ok: 10; status=error: 0/);
  assert.match(result.output, /Ошибок: 0; предупреждений: 0/);
  assert.doesNotMatch(result.output, /Вымышленн|Учебный тест|fixture-model|seeusoon|fixture-1/);
});

test('CLI accepts full DEV channel mix and rejects a DEV source presented as PROD', t => {
  const files = fixture(t, documents('dev'));
  let result = files.run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Набор: DEV; исходных диалогов: 65; результатов: 65/);
  result = files.run(['--dataset', 'prod', '--source', files.source, '--input', files.input]);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Источник DEV нельзя использовать/);
});

test('CLI rejects wrong result counts and IDs without printing the ID', t => {
  const missing = documents();
  missing.input.results.pop();
  let files = fixture(t, missing), result = files.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Количество результатов/);
  const foreign = documents();
  foreign.input.results[0].conversation_id = 'private-identifier-never-log';
  files = fixture(t, foreign); result = files.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /ID отсутствует/);
  assert.doesNotMatch(result.output, /private-identifier-never-log/);
});

test('CLI accepts numeric zero, rejects null scores for ok, and warns about valid error entries', t => {
  const data = documents(), zero = data.input.results[0];
  zero.criteria.forEach(item => { if (item.value !== null) item.value = typeof item.value === 'boolean' ? false : 0; });
  zero.score.final_score = 0;
  data.input.results[1] = { conversation_id: 'fixture-2', status: 'error', criteria: [], score: null, error: 'Вымышленная причина сбоя, не выводить.' };
  const files = fixture(t, data);
  let result = files.run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /есть записи status=error: 1/);
  assert.match(result.output, /status=ok: 9; status=error: 1/);
  assert.match(result.output, /предупреждений: 1/);
  assert.doesNotMatch(result.output, /Вымышленная причина/);
  zero.score = null;
  writeFileSync(files.input, JSON.stringify(data.input));
  result = files.run();
  assert.equal(result.status, 1, result.output);
  zero.score = { final_score: 0, critical_flag: false };
  data.input.results[1].score = 0;
  writeFileSync(files.input, JSON.stringify(data.input));
  result = files.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /score: null/);
});

test('CLI suppresses parser payloads, signed URLs, secrets and unreadable paths', t => {
  const secret = 'NEVER_LOG_PAYLOAD_https://private.example.invalid/?sig=fixture-secret';
  for (const key of ['source', 'input']) {
    const files = fixture(t);
    writeFileSync(files[key], `{"payload":"${secret}"} trailing`);
    const result = files.run();
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /требуется корректный UTF-8 JSON/);
    assert.doesNotMatch(result.output, /NEVER_LOG|private\.example|fixture-secret|payload|trailing|SyntaxError/);
  }
  const files = fixture(t);
  const result = files.run(['--dataset', 'prod', '--source', join(files.dir, secret), '--input', files.input]);
  assert.equal(result.status, 2, result.output);
  assert.match(result.output, /Не удалось прочитать/);
  assert.doesNotMatch(result.output, /NEVER_LOG|private\.example|fixture-secret|cqa-cli-/);
});

test('CLI reads UTF-8 BOM, rejects invalid UTF-8 and never rewrites its files', t => {
  const files = fixture(t);
  for (const path of [files.source, files.input]) writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(path)]));
  const before = [readFileSync(files.source), readFileSync(files.input)], names = readdirSync(files.dir);
  const first = files.run(), second = files.run();
  assert.equal(first.status, 0, first.output);
  assert.equal(second.status, 0, second.output);
  assert.deepEqual(readFileSync(files.source), before[0]);
  assert.deepEqual(readFileSync(files.input), before[1]);
  assert.deepEqual(readdirSync(files.dir), names);
  writeFileSync(files.input, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
  const invalid = files.run();
  assert.equal(invalid.status, 2, invalid.output);
  assert.match(invalid.output, /требуется корректный UTF-8 JSON/);
});

test('CLI rejects missing, duplicate, unknown and malformed flags without echoing arguments', t => {
  const files = fixture(t);
  const bad = [
    [], files.args.slice(0, -1), files.args.slice(0, -2),
    [...files.args, '--dataset', 'prod'], [...files.args, '--source', files.source], [...files.args, '--input', files.input],
    [...files.args, '--publish', 'DO_NOT_ECHO'],
    ['--dataset', 'PROD', '--source', files.source, '--input', files.input],
    ['--dataset=prod', '--source', files.source, '--input', files.input],
    ['--dataset', '', '--source', files.source, '--input', files.input],
    [...files.args, 'DO_NOT_ECHO'],
  ];
  for (const args of bad) {
    const result = files.run(args);
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /Использование:/);
    assert.doesNotMatch(result.output, /DO_NOT_ECHO|cqa-cli-/);
  }
});
