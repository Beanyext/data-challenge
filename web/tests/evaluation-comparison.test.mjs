import test from 'node:test';
import assert from 'node:assert/strict';
import { compareEvaluations } from '../evaluation-comparison.mjs';

const checklist = {
  id: 'synthetic-checklist', version: 1, name: 'Вымышленный чек-лист Ә & <',
  sections: [{ id: 's', name: 'Вымышленный раздел' }], rounding: { digits: 2 }, guidance: ['Вымышленное правило'],
  criteria: [
    { id: 'a', title: 'Вымышленный контакт', description: 'Вымышленное правило', code: 'contact', section_id: 's', answer_type: 'binary', weight: 50, na_allowed: true },
    { id: 'b', title: 'Вымышленная шкала', description: 'Вымышленное правило', code: 'scale', section_id: 's', answer_type: 'scale', weight: 50, scale: { min: 0, max: 5, steps: [{ value: 0, label: 'Нет' }, { value: 5, label: 'Да' }] } },
    { id: 'g', title: 'Вымышленное нарушение', description: 'Вымышленное правило', code: 'gross', answer_type: 'binary', weight: 0, gross_error: true },
  ],
};
const criteria = [
  { criterion_id: 'a', answer: 'yes', points: 50, effective_weight: 50, explanation: 'Вымышленный ответ «Сұрақ» & <тест>', evidence: [{ turn: 0, quote: 'Вымышленная реплика' }] },
  { criterion_id: 'b', answer: 5, points: 50, effective_weight: 50, evidence: [], checked_range: { from: 0, to: 2 } },
  { criterion_id: 'g', answer: 'no', points: null, effective_weight: 0 },
];
const evaluation = (id, values = {}) => ({ id, conversation_id: 'synthetic-dialog', checklist_id: checklist.id, checklist_version: 1, checklist: structuredClone(checklist), total: 100, criteria: structuredClone(criteria), model: 'synthetic-model', ...values });
const options = { conversationId: 'synthetic-dialog', beforeId: 'before', afterId: 'after' };
const compare = (before = evaluation('before'), after = evaluation('after')) => compareEvaluations(before, after, options);

test('identical saved results are unchanged regardless of object key ordering; inputs are never mutated', () => {
  const before = evaluation('before'), after = evaluation('after');
  after.checklist.rounding = { digits: 2 };
  after.criteria[0].evidence = [{ quote: 'Вымышленная реплика', turn: 0 }];
  after.criteria.reverse();
  const original = JSON.stringify([before, after]);
  const result = compare(before, after);
  assert.equal(result.error, null); assert.equal(result.changedCount, 0); assert.equal(result.totalDelta, 0);
  assert.deepEqual(result.rows.map(item => item.criterion.id), ['a', 'b', 'g']);
  assert.equal(result.rows[0].before, before.criteria[0]); assert.equal(result.rows[0].after, after.criteria[2]);
  assert.equal(result.partialBefore, false); assert.equal(result.partialAfter, false);
  assert.equal(JSON.stringify([before, after]), original);
});

test('answer, N/A, score, maximum and gross changes are detected without rescoring', () => {
  const after = evaluation('after', { total: 0, gross_error: true });
  after.criteria[0] = { criterion_id: 'a', answer: 'na', applicable: false, points: null, effective_weight: 0, na_reason: 'Вымышленная причина N/A' };
  after.criteria[1] = { ...after.criteria[1], answer: 0, points: 0, effective_weight: 100 };
  after.criteria[2] = { ...after.criteria[2], answer: 'yes', gross_error: true };
  const result = compare(undefined, after);
  assert.equal(result.error, null); assert.equal(result.changedCount, 3); assert.equal(result.totalDelta, -100);
  assert.equal(result.partialAfter, false); assert.equal(result.rows[1].after.points, 0);
});

test('gross-error answers excluded from numeric scoring still form a complete saved evaluation', () => {
  const before = evaluation('before', { total: 90, complete: true }), after = evaluation('after', { total: 100, complete: true });
  for (const item of [before, after]) {
    item.criteria[2] = { criterion_id: 'g', answer: 'no', gross_error: false, applicable: false, points: null, effective_weight: null };
  }
  const result = compare(before, after);
  assert.equal(result.error, null); assert.equal(result.partialBefore, false); assert.equal(result.partialAfter, false);
  assert.equal(result.totalDelta, 10);
  after.criteria[2].answer = 'yes'; after.criteria[2].gross_error = true;
  assert.equal(compare(before, after).partialAfter, false);
  after.criteria[2].answer = 'na';
  assert.equal(compare(before, after).partialAfter, true);
});

test('proof-only, rationale-only, range-only and review changes cannot disappear in only-changes mode', () => {
  const changes = [
    item => { item.evidence[0].turn = 1; },
    item => { item.evidence[0].quote = 'Другая вымышленная реплика'; },
    item => { item.explanation = 'Другое вымышленное объяснение'; },
    item => { item.checked_range = { from: 0, to: 1 }; },
    item => { item.needs_review = true; },
    item => { item.review_reason = 'Вымышленный пересмотр'; },
    item => { item.decision = { answer: 'no', reason: 'Вымышленная причина', status: 'changed' }; },
  ];
  for (const change of changes) {
    const after = evaluation('after'); change(after.criteria[0]);
    const result = compare(undefined, after);
    assert.equal(result.error, null); assert.equal(result.changedCount, 1); assert.equal(result.rows[0].changed, true);
  }
});

test('appeal record IDs and timestamps alone do not mark visually identical decisions as changed', () => {
  const before = evaluation('before'), after = evaluation('after');
  before.criteria[0].decision = {appeal_id: 'synthetic-first', answer: 'yes', reason: 'Same synthetic decision', status: 'confirmed', decided_at: '2026-11-07T19:00:00Z'};
  after.criteria[0].decision = {appeal_id: 'synthetic-second', answer: 'yes', reason: 'Same synthetic decision', status: 'confirmed', decided_at: '2026-11-07T19:01:00Z'};
  assert.equal(compare(before, after).changedCount, 0);
  after.criteria[0].decision.reason = 'Changed synthetic decision';
  assert.equal(compare(before, after).changedCount, 1);
});

test('missing criteria, unresolved answers and absent totals remain partial or unknown rather than zero', () => {
  const after = evaluation('after', { criteria: structuredClone(criteria.slice(1)), total: 0 });
  const missing = compare(undefined, after);
  assert.equal(missing.error, null); assert.equal(missing.rows[0].after, null); assert.equal(missing.partialAfter, true); assert.equal(missing.totalDelta, null);
  for (const overrides of [{ total: null }, { total: undefined }, { total: NaN }, { complete: false }, { missing: ['a'] }]) {
    const result = compare(undefined, evaluation('after', overrides));
    assert.equal(result.totalDelta, null);
  }
  for (const answer of [null, undefined, 'invalid']) {
    const after = evaluation('after'); after.criteria[0].answer = answer;
    assert.equal(compare(undefined, after).partialAfter, true);
  }
  const zero = evaluation('after'); zero.criteria[1].answer = 0;
  assert.equal(compare(undefined, zero).partialAfter, false);
  const absentPoints = evaluation('after'); delete absentPoints.criteria[1].points;
  assert.equal(compare(undefined, absentPoints).rows[1].changed, true);
});

test('a different conversation, wrong requested ID or same run is rejected before displaying any data', () => {
  for (const overrides of [{ conversation_id: 'other' }, { conversation_id: undefined }, { id: 'foreign' }]) {
    const result = compare(undefined, evaluation('after', overrides));
    assert.equal(result.error, 'identity'); assert.deepEqual(result.rows, []); assert.equal(result.totalDelta, null);
  }
  assert.equal(compareEvaluations(evaluation('before'), evaluation('before'), { ...options, afterId: 'before' }).error, 'identity');
  assert.equal(compareEvaluations(null, evaluation('after'), options).error, 'identity');
});

test('different checklist versions and conflicting saved snapshots are never compared', () => {
  const version = evaluation('after'); version.checklist_version = 2; version.checklist.version = 2;
  assert.equal(compare(undefined, version).error, 'version');
  const differentId = evaluation('after'); differentId.checklist_id = 'other'; differentId.checklist.id = 'other';
  assert.equal(compare(undefined, differentId).error, 'version');
  const changes = [
    item => { item.checklist.criteria[0].weight = 20; },
    item => { item.checklist.criteria[0].description = 'Другое правило'; },
    item => { item.checklist.criteria[1].scale.steps[0].value = 1; },
    item => { item.checklist.sections[0].name = 'Другой раздел'; },
    item => { item.checklist.guidance.push('Другая инструкция'); },
    item => { item.checklist.rounding.digits = 0; },
    item => { item.checklist = undefined; },
    item => { item.checklist.version = 2; },
  ];
  for (const change of changes) {
    const after = evaluation('after'); change(after);
    const result = compare(undefined, after); assert.equal(result.error, 'snapshot'); assert.deepEqual(result.rows, []);
  }
});

test('duplicate or foreign criterion results and malformed arrays are rejected; missing results are allowed as partial', () => {
  for (const invalid of [undefined, null, {}, [null], [...criteria, criteria[0]], [...criteria, { criterion_id: 'foreign', answer: 'yes' }]]) {
    const result = compare(undefined, evaluation('after', { criteria: invalid }));
    assert.equal(result.error, 'criteria'); assert.deepEqual(result.rows, []);
  }
  assert.equal(compare(undefined, evaluation('after', { criteria: [] })).partialAfter, true);
});

test('mock provenance stays visible on real API data and no model/API operations are called', () => {
  for (const overrides of [{ provider: 'mock' }, { model: 'mock' }, { model: 'mock-test' }, { demo: true }]) {
    assert.equal(compare(undefined, evaluation('after', overrides)).educational, true);
  }
  assert.equal(compare().educational, false);
});

test('malformed evidence, checked ranges and decisions fail closed before reaching the UI', () => {
  const invalid = [
    { evidence: {} }, { evidence: 'invalid' }, { evidence: null }, { evidence: [null] },
    { evidence: [3] }, { evidence: [[]] }, { evidence: [{ turn: 'invalid' }] },
    { checked_range: [] }, { checked_range: 'invalid' }, { checked_range: {} },
    { checked_range: { from: 0, to: 'invalid' } }, { checked_range: 3 },
    { decision: [] }, { decision: 'invalid' }, { decision: 3 },
  ];
  for (const override of invalid) {
    const after = evaluation('after'); Object.assign(after.criteria[0], override);
    const result = compare(undefined, after);
    assert.equal(result.error, 'criteria', JSON.stringify(override));
    assert.deepEqual(result.rows, []);
  }
  const after = evaluation('after');
  Object.assign(after.criteria[0], { evidence: [{ turn: -1 }, { turn: 999.5 }], checked_range: { from: -2, to: 999 }, decision: null });
  assert.equal(compare(undefined, after).error, null, 'Numeric invalid references are shown as unavailable by the UI');
});
