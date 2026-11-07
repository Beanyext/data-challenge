import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDatasetSource, parseEvaluationFiles, collectServerEntries } from '../submission-source.mjs';

function dialog(id, channel = 'agent chat') {
  return { conversation_id: id, channel, language: 'RU', transcript: [{ speaker: 'client', text: 'Вымышленный запрос «проверка» & тест', timestamp: '00:00' }, { speaker: 'operator', text: 'Учебный ответ', timestamp: '00:02' }] };
}
function dataset(name = 'PROD') {
  return Array.from({ length: name === 'DEV' ? 65 : 10 }, (_, index) => dialog(`fictional-${index + 1}`, name === 'DEV' && index >= 60 ? 'voice call' : 'agent chat'));
}
const copy = value => JSON.parse(JSON.stringify(value));

test('organizer source preserves exact records, order and original transcript indices', () => {
  const records = dataset('DEV');
  records[0].transcript = [];
  const input = { isSuccess: true, data: { dataset_group_id: 'DEV', total_records: 65, records } };
  const before = copy(input), parsed = parseDatasetSource(input, { dataset: 'DEV' });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.groupId, 'DEV');
  assert.equal(parsed.dialogs, records);
  assert.equal(parsed.dialogs[2].transcript, records[2].transcript);
  assert.deepEqual(input, before);
});

test('source permits records wrapper and bare PROD array, rejects wrong group and counts', () => {
  const records = dataset();
  assert.equal(parseDatasetSource(records, { dataset: 'PROD' }).dialogs.length, 10);
  assert.equal(parseDatasetSource({ records }, { dataset: 'PROD' }).dialogs.length, 10);
  assert.match(parseDatasetSource({ records, dataset_group_id: 'DEV' }, { dataset: 'PROD' }).errors.join(' '), /DEV/);
  assert.match(parseDatasetSource({ records, total_records: 11 }, { dataset: 'PROD' }).errors.join(' '), /total_records/);
  assert.ok(parseDatasetSource(records.slice(0, 9), { dataset: 'PROD' }).errors.length);
  const voice = dataset(); voice[0].channel = 'voice call';
  assert.ok(parseDatasetSource(voice, { dataset: 'PROD' }).errors.length);
  const wrongDev = dataset('DEV'); wrongDev[64].channel = 'agent chat';
  assert.ok(parseDatasetSource(wrongDev, { dataset: 'DEV' }).errors.length);
});

test('failed organizer response and malformed records cannot be accepted or disclose values', () => {
  const failed = parseDatasetSource({ isSuccess: false, error: 'https://secret.invalid/?sig=private', data: { records: dataset() } }, { dataset: 'PROD' });
  assert.equal(failed.dialogs.length, 0);
  assert.doesNotMatch(JSON.stringify(failed), /secret\.invalid|private|sig=/);
  for (const change of [record => { record.conversation_id = ' '; }, record => { delete record.conversation_id; }, record => { record.channel = 'unknown'; }, record => { record.transcript = {}; }, record => { record.transcript[0] = null; }, record => { record.transcript[0].text = 1; }, record => { record.transcript[0].speaker = 'assistant'; }, record => { record.transcript[0].timestamp = null; }]) {
    const records = dataset(); change(records[0]);
    assert.ok(parseDatasetSource(records, { dataset: 'PROD' }).errors.length);
    assert.equal(parseDatasetSource(records, { dataset: 'PROD' }).dialogs.length, 0);
  }
  const duplicate = dataset(); duplicate[1].conversation_id = duplicate[0].conversation_id;
  assert.match(parseDatasetSource(duplicate, { dataset: 'PROD' }).errors.join(' '), /повторяется/);
});

test('evaluation sources preserve raw evaluator arrays without one-based conversion', () => {
  const evaluations = [{ conversation_id: 'fictional-1', criteria: [{ criterion_id: 'c1', evidence: [{ turn: 0 }] }] }, { conversation_id: 'fictional-2', error: 'Учебный сбой' }];
  const files = [{ name: 'one.json', document: evaluations[0] }, { name: 'many.json', document: { data: { evaluations: [evaluations[1]] } } }];
  const parsed = parseEvaluationFiles(files);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.evaluations[0], evaluations[0]);
  assert.equal(parsed.evaluations[0].criteria[0].evidence[0].turn, 0);
  assert.equal(parseEvaluationFiles([{ name: 'all.json', document: evaluations }]).evaluations.length, 2);
  assert.equal(parseEvaluationFiles([{ name: 'all.json', document: { evaluations } }]).evaluations.length, 2);
});

test('only recognized CLI summary is skipped; malformed summaries and organizer output reject', () => {
  const summary = { models: ['synthetic'], dialogs: 10, failed: 0 };
  const source = { conversation_id: 'fictional-1', criteria: [] };
  const parsed = parseEvaluationFiles([{ name: 'summary.json', document: summary }, { name: 'eval.json', document: source }]);
  assert.equal(parsed.evaluations.length, 1);
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parsed.errors.length, 0);
  assert.ok(parseEvaluationFiles([{ name: 'other.json', document: summary }]).errors.length);
  assert.ok(parseEvaluationFiles([{ name: 'summary.json', document: { models: [], dialogs: '10' } }]).errors.length);
  assert.ok(parseEvaluationFiles([{ name: 'summary.json', document: { ...summary, conversation_id: ' ' } }]).errors.length);
  assert.ok(parseEvaluationFiles([{ name: 'summary.json', document: { ...summary, isSuccess: false } }]).errors.length);
  for (const document of [{ schema_version: '1.0', results: [] }, { results: [] }, { data: { schema_version: '1.0', results: [] } }, { evaluations: [{ conversation_id: 'a', schema_version: '1.0' }] }]) assert.ok(parseEvaluationFiles([{ name: 'converted.json', document }]).errors.length);
});

test('nonboolean organizer success flag is not treated as a successful API response', () => {
  const result = parseDatasetSource({ isSuccess: 'false', data: { records: dataset() } }, { dataset: 'PROD' });
  assert.ok(result.errors.length);
  assert.deepEqual(result.dialogs, []);
});

test('duplicate, blank and empty evaluation files are errors', () => {
  for (const files of [[], [{ name: 'empty.json', document: [] }], [{ name: 'blank.json', document: { conversation_id: ' ' } }], [{ name: 'a.json', document: [{ conversation_id: 'same' }, { conversation_id: 'same' }] }]]) {
    const result = parseEvaluationFiles(files);
    assert.ok(result.errors.length);
    assert.deepEqual(result.evaluations, []);
  }
});

function serverFixture(source) {
  const rows = source.map((record, index) => ({ conversation_id: record.conversation_id, evaluation_id: `eval-${index + 1}`, status: 'evaluated' }));
  const evaluations = new Map(rows.map(row => [row.evaluation_id, { id: row.evaluation_id, conversation_id: row.conversation_id, criteria: [], total: 100 }]));
  const details = new Map(source.map((record, index) => [record.conversation_id, { ...copy(record), evaluation_id: `eval-${index + 1}` }]));
  const calls = { list: 0, detail: [], evaluation: [], writes: 0, inFlight: 0, maxInFlight: 0 };
  const api = {
    demo: false,
    async listDialogs() { calls.list++; return rows; },
    async getDialog(id) { calls.detail.push(id); if (!details.has(id)) throw new Error('No fixture'); return details.get(id); },
    async getEvaluation(id) {
      calls.evaluation.push(id); calls.inFlight++; calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
      await new Promise(resolve => setTimeout(resolve, id === 'eval-1' ? 15 : 1)); calls.inFlight--;
      if (!evaluations.has(id)) throw new Error('https://private.invalid/invoke?sig=not-for-output');
      return evaluations.get(id);
    },
    async evaluate() { calls.writes++; throw new Error('Forbidden POST'); },
    async uploadDialog() { calls.writes++; throw new Error('Forbidden POST'); },
    async importDialogs() { calls.writes++; throw new Error('Forbidden POST'); },
    async saveChecklist() { calls.writes++; throw new Error('Forbidden POST'); },
  };
  return { api, rows, evaluations, details, calls };
}

test('server collection uses only reads, limits concurrency and preserves source order and proof data', async () => {
  const source = dataset(), fixture = serverFixture(source), progress = [];
  fixture.rows.push({ conversation_id: 'unrelated-team-dialog', evaluation_id: 'do-not-fetch', status: 'evaluated' });
  const before = copy(source);
  const result = await collectServerEntries(fixture.api, source, { onProgress: value => progress.push(value) });
  assert.deepEqual(result.errors, []);
  assert.equal(result.entries.length, 10);
  assert.equal(fixture.calls.writes, 0);
  assert.equal(fixture.calls.maxInFlight, 4);
  assert.deepEqual(fixture.calls.detail, []);
  assert.ok(!fixture.calls.evaluation.includes('do-not-fetch'));
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(result.entries.map(entry => entry.dialog.conversation_id), source.map(record => record.conversation_id));
  assert.equal(result.entries[0].dialog, source[0]);
  assert.deepEqual(source, before);
  assert.deepEqual(progress.map(value => value.completed), Array.from({ length: 11 }, (_, index) => index));
  assert.ok(progress.every(value => value.total === 10));
});

test('collection freezes list evaluation IDs and queries detail only when absent', async () => {
  const source = [dialog('a'), dialog('b')], fixture = serverFixture(source);
  delete fixture.rows[1].evaluation_id;
  const read = fixture.api.getEvaluation;
  fixture.api.getEvaluation = async id => { fixture.rows[0].evaluation_id = 'newly-replaced'; return read(id); };
  fixture.details.get('b').transcript = [{ speaker: 'operator', text: 'Changed server indexing' }];
  const result = await collectServerEntries(fixture.api, source);
  assert.deepEqual(fixture.calls.evaluation, ['eval-1', 'eval-2']);
  assert.deepEqual(fixture.calls.detail, ['b']);
  assert.equal(result.entries[0].evaluation.id, 'eval-1');
  assert.equal(result.entries[1].dialog, source[1]);
  assert.equal(result.entries[1].dialog.transcript.length, 2);
});

test('one failed saved result remains explicit and never leaks signed error messages', async () => {
  const source = [dialog('a'), dialog('b')], fixture = serverFixture(source);
  fixture.evaluations.delete('eval-2');
  const result = await collectServerEntries(fixture.api, source);
  assert.deepEqual(result.errors, []);
  assert.equal(result.entries[0].evaluation.conversation_id, 'a');
  assert.equal(result.entries[1].dialog.conversation_id, 'b');
  assert.ok(result.entries[1].error);
  assert.equal(result.entries[1].evaluation, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private\.invalid|sig=|not-for-output/);
});

test('demo and malformed or duplicate server/source lists stop with global errors', async () => {
  const source = [dialog('a')];
  const demo = serverFixture(source); demo.api.demo = true;
  assert.ok((await collectServerEntries(demo.api, source)).errors.length);
  assert.equal(demo.calls.list, 0);
  for (const rows of [null, {}, [{ conversation_id: 'a' }, { conversation_id: 'a' }], [{ conversation_id: ' ' }]]) {
    const fixture = serverFixture(source); fixture.api.listDialogs = async () => rows;
    const result = await collectServerEntries(fixture.api, source);
    assert.ok(result.errors.length);
    assert.deepEqual(result.entries, []);
    assert.equal(fixture.calls.evaluation.length, 0);
  }
  const fixture = serverFixture(source);
  fixture.api.listDialogs = async () => { throw new Error('https://private.invalid/?sig=hidden'); };
  const failure = await collectServerEntries(fixture.api, source);
  assert.ok(failure.errors.length);
  assert.doesNotMatch(JSON.stringify(failure), /private\.invalid|sig=|hidden/);
  assert.ok((await collectServerEntries(fixture.api, [dialog('a'), dialog('a')])).errors.length);
});

test('missing, pending and failed records retain expected IDs without using older results', async () => {
  const source = [dialog('missing'), dialog('pending'), dialog('failed'), dialog('no-result')], fixture = serverFixture(source);
  fixture.rows.shift(); fixture.rows[0].status = 'running'; fixture.rows[1].status = 'failed';
  fixture.rows[2].evaluation_id = null; fixture.details.get('no-result').evaluation_id = null;
  const result = await collectServerEntries(fixture.api, source);
  assert.deepEqual(result.entries.map(entry => entry.dialog.conversation_id), source.map(item => item.conversation_id));
  assert.ok(result.entries.every(entry => entry.error && !entry.evaluation));
  assert.equal(fixture.calls.evaluation.length, 0);
  assert.deepEqual(fixture.calls.detail, ['no-result']);
});

test('mismatched record/evaluation IDs and missing evaluation conversation ID reject safely', async () => {
  for (const change of [fixture => { delete fixture.rows[0].evaluation_id; fixture.details.get('a').conversation_id = 'other'; }, fixture => { fixture.evaluations.get('eval-1').conversation_id = 'other'; }, fixture => { delete fixture.evaluations.get('eval-1').conversation_id; }]) {
    const fixture = serverFixture([dialog('a')]); change(fixture);
    const result = await collectServerEntries(fixture.api, [dialog('a')]);
    assert.ok(result.entries[0].error);
    assert.equal(result.entries[0].evaluation, undefined);
  }
});

test('a progress callback failure is a safe warning and does not drop records', async () => {
  const source = [dialog('a')], fixture = serverFixture(source);
  const result = await collectServerEntries(fixture.api, source, { onProgress() { throw new Error('https://private.invalid/?sig=hidden'); } });
  assert.equal(result.entries.length, 1);
  assert.ok(result.entries[0].evaluation);
  assert.equal(result.warnings.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /private\.invalid|sig=/);
});

test('failed evaluations retain demo provenance without raw provider errors', async () => {
  const source = [dialog('a')], fixture = serverFixture(source);
  Object.assign(fixture.evaluations.get('eval-1'), { demo:true, provider:'mock', model:'mock', error:'https://private.invalid/?sig=not-for-output' });
  const result = await collectServerEntries(fixture.api, source);
  assert.equal(result.entries[0].evaluation.demo, true);
  assert.equal(result.entries[0].evaluation.provider, 'mock');
  assert.ok(result.entries[0].error);
  assert.doesNotMatch(JSON.stringify(result), /private\.invalid|sig=|not-for-output/);
});
