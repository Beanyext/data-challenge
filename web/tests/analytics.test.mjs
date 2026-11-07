import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsGroupKey, analyticsLanguage, loadAnalytics, summarizeAnalytics } from '../analytics.mjs';
const config = [
  { id: 'a', title: 'А · Ә & <', answer_type: 'binary', weight: 10, na_allowed: true },
  { id: 's', title: 'Scale', answer_type: 'scale', weight: 20, scale: { min: 0, max: 5, steps: [{ value: 0 }, { value: 5 }] } },
  { id: 'g', title: 'Gross', answer_type: 'binary', weight: 0, gross_error: true },
];
const row = (id, overrides = {}) => ({ conversation_id: id, evaluation_id: `e-${id}`, status: 'evaluated', language: 'RU', ...overrides });
function ev(id, criteria = [], overrides = {}) {
  return { id: `e-${id}`, conversation_id: id, checklist_id: 'c', checklist_version: 1,
    checklist: { id: 'c', version: 1, name: 'Чек-лист', criteria: config }, total: 50, criteria, ...overrides };
}
const full = [
  { criterion_id: 'a', answer: 'yes', points: 50, effective_weight: 50 },
  { criterion_id: 's', answer: 5, points: 50, effective_weight: 50 },
  { criterion_id: 'g', answer: 'no', points: null, effective_weight: 0 },
];

test('criterion denominators exclude N/A, missing, null and review; preserve genuine zero, and count gross independently', async () => {
  const evaluations = [ev('1', full, { total: 0 }), ev('2', [
    { criterion_id: 'a', answer: 'no', points: 0, effective_weight: 40 },
    { criterion_id: 's', answer: 0, points: 0, effective_weight: 60 },
    { criterion_id: 'g', answer: 'yes', gross_error: true, effective_weight: 0 },
  ], { gross_error: true }), ev('3', [
    { criterion_id: 'a', answer: 'na', applicable: false, points: null, effective_weight: 0 },
    { criterion_id: 's', answer: null, points: null, effective_weight: null },
    { criterion_id: 'g', answer: 'yes', needs_review: true },
  ], { total: null, complete: false }), ev('4', [{ criterion_id: 'a', answer: 'yes', points: 20, effective_weight: 20, needs_review: true }], { total: null })];
  const data = await loadAnalytics(evaluations.map((_, i) => row(String(i + 1))), id => evaluations.find(item => item.id === id));
  const summary = summarizeAnalytics(data, analyticsGroupKey('c', 1));
  assert.equal(summary.records, 4); assert.equal(summary.average, 25); assert.equal(summary.scored, 2); assert.equal(summary.gross, 1);
  assert.deepEqual(summary.criteria.map(({ valid, na, unknown, losses, averageLoss, grossCount }) => ({ valid, na, unknown, losses, averageLoss, grossCount })), [
    { valid: 2, na: 1, unknown: 1, losses: 1, averageLoss: 20, grossCount: 0 },
    { valid: 2, na: 0, unknown: 2, losses: 1, averageLoss: 30, grossCount: 0 },
    { valid: 2, na: 0, unknown: 2, losses: 0, averageLoss: null, grossCount: 1 },
  ]);
  assert.equal(summary.criteria[0].lossRate, .5); assert.deepEqual(summary.criteria[0].dialogIds, ['2']);
});

test('invalid or duplicate criterion answers and absent server points are unknown, not zero; unknown average remains null', async () => {
  const data = await loadAnalytics([row('1')], () => ev('1', [
    { criterion_id: 'a', answer: 'yes', points: 0, effective_weight: 10 }, { criterion_id: 'a', answer: 'no', points: 0, effective_weight: 10 },
    { criterion_id: 's', answer: 3, points: 3, effective_weight: 10 }, { criterion_id: 'g', answer: 'na' },
  ], { total: null }));
  const result = summarizeAnalytics(data, data.groups[0].key);
  assert.equal(result.average, null);
  for (const item of result.criteria) { assert.equal(item.valid, 0); assert.equal(item.unknown, 1); assert.equal(item.lossRate, null); }
  const absentPoints = await loadAnalytics([row('1')], () => ev('1', [{ criterion_id: 'a', answer: 'yes' }]));
  assert.equal(summarizeAnalytics(absentPoints, absentPoints.groups[0].key).criteria[0].unknown, 1);
});

test('versions and languages remain independent, including KK/KZ aliases and unknown language', async () => {
  const rows = [row('1'), row('2', { language: 'kk' }), row('3', { language: 'EN' }), row('4', { language: '' })];
  const data = await loadAnalytics(rows, id => {
    const conversation = id.slice(2); return ev(conversation, full, conversation === '3' ? { checklist_version: 2, checklist: { id: 'c', name: 'v2', version: 2, criteria: config } } : {});
  });
  assert.equal(data.groups.length, 2);
  assert.equal(summarizeAnalytics(data, analyticsGroupKey('c', 1)).records, 3);
  assert.equal(summarizeAnalytics(data, analyticsGroupKey('c', 1), 'KZ').records, 1);
  assert.equal(summarizeAnalytics(data, analyticsGroupKey('c', 1), 'EN').records, 0);
  assert.equal(summarizeAnalytics(data, analyticsGroupKey('c', 2), 'EN').records, 1);
  assert.equal(summarizeAnalytics(data, analyticsGroupKey('c', 1), 'other').records, 1);
  assert.equal(analyticsLanguage('kk'), 'KZ');
});

test('only GET function runs, concurrency is capped, latest IDs frozen, text is never read, partial failures counted', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(String(i)));
  Object.defineProperty(rows[0], 'transcript', { get() { throw Error('transcript accessed'); } });
  const ids = []; let active = 0, maximum = 0;
  const loading = loadAnalytics(rows, async id => {
    ids.push(id); maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    if (id === 'e-2') throw Error('secret upstream error never copied');
    const result = ev(id.slice(2), full);
    Object.defineProperty(result, 'explanation', { get() { throw Error('text accessed'); } });
    return result;
  }, { concurrency: 80 });
  rows[9].evaluation_id = 'changed-later';
  const data = await loading;
  assert.equal(maximum, 4); assert.equal(data.records.length, 9); assert.equal(data.failures.request, 1);
  assert.ok(ids.includes('e-9')); assert.ok(!ids.includes('changed-later'));
  assert.ok(!JSON.stringify(data).includes('secret upstream'));
});

test('pending/error rows never fall back to old successes; identity and snapshot failures are visible omissions', async () => {
  const rows = [row('new', { status: 'new' }), row('pending', { status: 'running' }), row('error', { status: 'error' }),
    row('wrongid'), row('wrongdialog'), row('snapshot'), row('nosnapshot'), row('nullcriterion')];
  const ids = [];
  const data = await loadAnalytics(rows, id => {
    ids.push(id); const name = id.slice(2);
    return ev(name, full, name === 'wrongid' ? { id: 'other' } : name === 'wrongdialog' ? { conversation_id: 'other' }
      : name === 'snapshot' ? { checklist_version: 2 } : name === 'nosnapshot' ? { checklist: null } : { criteria: [null] });
  });
  assert.equal(ids.length, 5); assert.deepEqual(data.skipped, { unevaluated: 1, pending: 1, error: 1 });
  assert.deepEqual(data.failures, { request: 0, identity: 2, snapshot: 3, conflict: 0 }); assert.equal(data.groups.length, 0);
});

test('same version with incompatible checklist snapshot excludes the whole conflicting group', async () => {
  const data = await loadAnalytics([row('1'), row('2')], id => ev(id.slice(2), full, id === 'e-2' ? { checklist: { id: 'c', name: 'Чек-лист', version: 1, criteria: config.map(item => item.id === 'a' ? { ...item, description: 'Different scoring rule' } : item) } } : {}));
  assert.equal(data.failures.conflict, 2); assert.equal(data.records.length, 0); assert.equal(data.groups.length, 0);
});


test('rounded one-hundredth loss is counted and mock provenance survives real API mode', async () => {
  const data = await loadAnalytics([row('1')], () => ev('1', [{ criterion_id: 'a', answer: 'no', points: 9.99, effective_weight: 10 }], { provider: 'mock' }));
  assert.equal(data.records[0].educational, true);
  const summary = summarizeAnalytics(data, data.groups[0].key);
  assert.equal(summary.criteria[0].losses, 1);
  assert.ok(Math.abs(summary.criteria[0].averageLoss - .01) < 1e-10);
});


test('incomplete criterion sets never contribute to the complete-score average even with a numeric total', async () => {
  const evaluations = [ev('missing', full.slice(0, 1)), ev('duplicate', [...full, full[0]]),
    ev('invalid', full.map(item => item.criterion_id === 's' ? {...item, answer: 3} : item)),
    ev('reported', full, {missing: ['unresolved']}), ev('valid', full, {total: 0})];
  const data = await loadAnalytics(evaluations.map(item => row(item.conversation_id)), id => evaluations.find(item => item.id === id));
  const result = summarizeAnalytics(data, data.groups[0].key);
  assert.equal(result.records, 5);
  assert.equal(result.scored, 1);
  assert.equal(result.average, 0);
});

test('server gross answers with applicable false count as complete and have their own denominator', async () => {
  const evaluations = [ev('clear', full.map(item => item.criterion_id === 'g' ? {...item, applicable: false, effective_weight: null} : item), {total: 100, complete: true}),
    ev('gross', full.map(item => item.criterion_id === 'g' ? {...item, answer: 'yes', applicable: false, effective_weight: null} : {...item, points: 0, answer: item.criterion_id === 's' ? 0 : 'no'}), {total: 0, complete: true, gross_error: true}),
    ev('review', full.map(item => item.criterion_id === 'g' ? {...item, applicable: false, needs_review: true} : item), {total: 100, complete: false})];
  const data = await loadAnalytics(evaluations.map(item => row(item.conversation_id)), id => evaluations.find(item => item.id === id));
  const summary = summarizeAnalytics(data, data.groups[0].key);
  assert.equal(summary.scored, 2); assert.equal(summary.average, 50); assert.equal(summary.gross, 1);
  const gross = summary.criteria.find(item => item.id === 'g');
  assert.equal(gross.valid, 2); assert.equal(gross.grossCount, 1); assert.equal(gross.lossRate, .5); assert.equal(gross.unknown, 1);
  assert.deepEqual(gross.dialogIds, ['gross']);
});

test('invalid gross answers and non-gross applicable false remain incomplete', async () => {
  const evaluations = [ev('invalid-gross', full.map(item => item.criterion_id === 'g' ? {...item, answer: 'na', applicable: false} : item), {complete: true}),
    ev('invalid-normal', full.map(item => item.criterion_id === 'a' ? {...item, applicable: false} : item), {complete: true})];
  const data = await loadAnalytics(evaluations.map(item => row(item.conversation_id)), id => evaluations.find(item => item.id === id));
  const summary = summarizeAnalytics(data, data.groups[0].key);
  assert.equal(summary.scored, 0); assert.equal(summary.average, null);
  assert.equal(summary.criteria.find(item => item.id === 'g').unknown, 1);
  assert.equal(summary.criteria.find(item => item.id === 'a').unknown, 1);
});

test('equivalent saved checklist objects with reordered keys remain in the same analytics group', async () => {
  const before = ev('1', full), after = ev('2', full);
  before.checklist.sections = [{id: 's', name: 'Вымышленная секция'}];
  after.checklist.sections = [{name: 'Вымышленная секция', id: 's'}];
  before.checklist.criteria = config.map(item => item.id === 's' ? {...item, scale: {...item.scale, steps: item.scale.steps.map(step => ({value: step.value, label: 'Synthetic step'}))}} : item);
  after.checklist.criteria = config.map(item => item.id === 's' ? {...item, scale: {...item.scale, steps: item.scale.steps.map(step => ({label: 'Synthetic step', value: step.value}))}} : item);
  const data = await loadAnalytics([row('1'), row('2')], id => id === before.id ? before : after);
  assert.equal(data.failures.conflict, 0); assert.equal(data.records.length, 2); assert.equal(data.groups.length, 1);
});
