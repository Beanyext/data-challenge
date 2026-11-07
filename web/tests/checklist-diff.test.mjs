import test from 'node:test';
import assert from 'node:assert/strict';
import { compareChecklists, renderChecklistDiff } from '../checklist-diff.mjs';

const clone = value => structuredClone(value);
function fixture() {
  return {
    id: 'quality', version: 1, name: 'Качество диалога', guidance: ['Оценивать оператора.'],
    sections: [{ id: 's1', name: 'Контакт' }, { id: 's2', name: 'Решение' }], rounding: { digits: 2 },
    criteria: [
      { id: 'c01', title: 'Приветствие', description: 'Поздоровался.', weight: 10, answer_type: 'binary', scale: null, na_allowed: false, na_rule: null, notes: null, gross_error: false, section_id: 's1' },
      { id: 'c02', title: 'Консультация', description: 'Полно ответил.', weight: 90, answer_type: 'scale', scale: { min: 0, max: 10, steps: [{ value: 0, label: 'Нет ответа' }, { value: 10, label: 'Полный ответ' }] }, na_allowed: true, na_rule: 'Не сформулирован запрос.', notes: 'Учесть контекст.', gross_error: false, section_id: 's2' },
    ],
  };
}

test('empty input and an unchanged clone contain no edits', () => {
  for (const [before, after] of [[undefined, undefined], [null, null], [{}, {}], [fixture(), clone(fixture())]]) {
    assert.deepEqual(compareChecklists(before, after), { changed: false, changes: [] });
  }
  assert.match(renderChecklistDiff(compareChecklists(null, null)), /Изменений нет/);
});

test('new configuration describes added settings and every new criterion', () => {
  const result = compareChecklists(null, fixture());
  assert.equal(result.changed, true);
  assert.ok(result.changes.every(change => change.kind === 'added'));
  assert.deepEqual(result.changes.filter(c => c.field === 'criterion').map(c => c.criterion_id), ['c01', 'c02']);
  assert.ok(result.changes.some(c => c.field === 'guidance'));
  assert.ok(result.changes.some(c => c.field === 'rounding'));
});

test('criterion identity uses ID rather than position or title', () => {
  const before = fixture(), after = clone(before);
  after.criteria[0].id = 'new-id';
  const changes = compareChecklists(before, after).changes;
  assert.deepEqual(changes.map(c => [c.kind, c.criterion_id]), [['removed', 'c01'], ['added', 'new-id']]);
  assert.ok(changes[0].before.includes('Поздоровался.'));
  assert.ok(changes[1].after.includes('Поздоровался.'));
});

test('meaningful criterion fields are individually compared', () => {
  const before = fixture(), after = clone(before), c = after.criteria[0];
  Object.assign(c, { title: 'Контакт', description: 'Поздоровался и представился.', weight: 20, answer_type: 'scale', scale: { min: 0, max: 5, steps: [{ value: 0, label: 'Нет' }, { value: 5, label: 'Да' }] }, na_allowed: true, na_rule: 'Нет реплик оператора.', notes: 'Новая подсказка.', gross_error: true, section_id: 's2' });
  const changes = compareChecklists(before, after).changes;
  assert.deepEqual(changes.map(c => c.field).sort(), ['title', 'description', 'weight', 'answer_type', 'scale', 'na_allowed', 'na_rule', 'notes', 'gross_error', 'section_id'].sort());
  assert.ok(changes.every(c => c.criterion_id === 'c01' && c.kind === 'changed'));
});

test('N/A permission and its applicability rule are separate changes', () => {
  const before = fixture(), after = clone(before);
  after.criteria[1].na_allowed = false;
  after.criteria[1].na_rule = null;
  const changes = compareChecklists(before, after).changes;
  assert.deepEqual(changes.map(c => c.field), ['na_allowed', 'na_rule']);
  assert.deepEqual([changes[0].before, changes[0].after], ['Да', 'Нет']);
  assert.equal(changes[1].after, '—');
});

test('scale labels, bounds, values and step ordering are meaningful', () => {
  for (const mutate of [
    c => { c.scale.steps[0].label = 'Не выполнено'; },
    c => { c.scale.min = -1; },
    c => { c.scale.max = 20; },
    c => { c.scale.steps[0].value = 1; },
    c => { c.scale.steps.reverse(); },
    c => { c.scale.steps.push({ value: 5, label: 'Частично' }); },
  ]) {
    const before = fixture(), after = clone(before);
    mutate(after.criteria[1]);
    const result = compareChecklists(before, after);
    assert.deepEqual(result.changes.map(c => c.field), ['scale']);
    assert.notEqual(result.changes[0].before, result.changes[0].after);
  }
});

test('all checklist-level settings are compared', () => {
  const before = fixture(), after = clone(before);
  after.name = 'Обновлённый чек-лист';
  after.guidance.push('Проверять доказательства.');
  after.sections[0].name = 'Начало разговора';
  after.rounding.digits = 3;
  assert.deepEqual(compareChecklists(before, after).changes.map(c => c.field), ['name', 'guidance', 'sections', 'rounding']);
});

test('guidance order, section order and section IDs are preserved', () => {
  const before = fixture(); before.guidance.push('Второе правило.');
  for (const mutate of [
    after => after.guidance.reverse(),
    after => after.sections.reverse(),
    after => { after.sections[0].id = 'new-section'; },
  ]) {
    const after = clone(before); mutate(after);
    assert.equal(compareChecklists(before, after).changed, true);
  }
});

test('criterion reorder is reported without false field edits', () => {
  const before = fixture(), after = clone(before);
  after.criteria.reverse();
  const changes = compareChecklists(before, after).changes;
  assert.deepEqual(changes.map(c => c.field), ['criteria_order']);
  assert.match(changes[0].before, /^1\. c01/);
  assert.match(changes[0].after, /^1\. c02/);
});

test('adding/removing items alone does not fabricate a reorder', () => {
  const before = fixture(), after = clone(before);
  after.criteria.unshift({ ...clone(after.criteria[0]), id: 'new' });
  assert.deepEqual(compareChecklists(before, after).changes.map(c => c.field), ['criterion']);
  after.criteria.splice(1, 1);
  assert.ok(!compareChecklists(before, after).changes.some(c => c.field === 'criteria_order'));
});

test('metadata and editor scratch state do not appear in a diff', () => {
  const before = fixture(), after = clone(before);
  after.id = 'server-id'; after.version = 42; after.created_at = 'ignored'; after.extra_server_field = true;
  after.criteria[1]._stepsText = 'unfinished editor input'; after.criteria[1].metadata = { saved: true };
  after.criteria[1].scale.steps[0].id = 'server-step-id';
  after.sections[0].updated_at = 'ignored'; after.rounding.metadata = { source: 'server' };
  assert.deepEqual(compareChecklists(before, after), { changed: false, changes: [] });
});

test('object key order and JSON numeric strings do not fabricate changes', () => {
  const before = fixture(), after = clone(before);
  after.criteria[0].weight = '10';
  after.criteria[1].scale = { steps: after.criteria[1].scale.steps, max: '10', min: '0' };
  assert.equal(compareChecklists(before, after).changed, false);
});

test('comparison does not mutate either deeply frozen input', () => {
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const before = fixture(), after = clone(before); after.criteria[0].weight = 15;
  const originalBefore = clone(before), originalAfter = clone(after);
  compareChecklists(freeze(before), freeze(after));
  assert.deepEqual(before, originalBefore); assert.deepEqual(after, originalAfter);
});

test('renderer escapes XSS strings in title, labels, IDs and both values', () => {
  const attack = '<img src=x onerror="alert(1)"> & \'quoted\'';
  const before = fixture(), after = clone(before);
  after.criteria[0].title = attack;
  after.criteria[0].description = '<script>window.bad=1</script>';
  const html = renderChecklistDiff(compareChecklists(before, after));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&quot;alert(1)&quot;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&#39;quoted&#39;'));
  const untrusted = renderChecklistDiff({ changes: [{ kind: 'changed', criterion_id: attack, title: attack, label: attack, before: attack, after: attack }] });
  assert.ok(!untrusted.includes('<img'));
});

test('renderer groups changes with accessible labels and before/after classes', () => {
  const before = fixture(), after = clone(before);
  after.criteria[0].weight = 15;
  after.criteria.splice(1, 1, { ...clone(after.criteria[0]), id: 'c03', title: 'Новый критерий' });
  const html = renderChecklistDiff(compareChecklists(before, after));
  assert.match(html, /role="region" aria-label="Изменения чек-листа"/);
  for (const label of ['Добавлено', 'Удалено', 'Изменено']) assert.ok(html.includes(`aria-label="${label}"`));
  for (const className of ['diff-list', 'diff-item', 'diff-before', 'diff-after']) assert.ok(html.includes(`class="${className}"`));
  assert.ok(html.includes('<strong>Было</strong>'));
  assert.ok(html.includes('<strong>Станет</strong>'));
});
