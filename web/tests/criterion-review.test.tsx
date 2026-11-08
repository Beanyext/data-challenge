import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChecklistEditor, CriterionReview } from '../react/forms';
import type { Checklist, Criterion, CriterionReviewResult } from '../react/types';
import { setLocale } from '../react/i18n';
import { ruleReview } from '../demo.mjs';

const criterion: Criterion = { id: 'c09', section_id: 's1', title: 'Следующий шаг', description: 'Оператор качественно объяснил шаг.', answer_type: 'binary', weight: 5, na_allowed: true, na_rule: '', notes: null };
const checklist: Checklist = { id: 'synthetic', version: 1, name: 'Синтетический', sections: [{ id: 's1', name: 'Раздел' }], criteria: [criterion] };

test('editor shows the AI wording check next to the rule', () => {
  setLocale('ru');
  const html = renderToStaticMarkup(<ChecklistEditor checklist={checklist} checklists={[checklist]} criterionIndex={0} dirty={false} />);
  assert.match(html, /data-action="review-criterion"/);
  assert.match(html, /id="criterion-review"/);
});

test('advice lists problems and offers only changed fields', () => {
  setLocale('ru');
  const review: CriterionReviewResult = {
    verdict: 'unclear', summary: 'Непонятно, что считать <шагом>.',
    issues: [{ field: 'na_rule', problem: 'Нет условия N/A.', fix: 'Добавьте условие.' }],
    suggestion: { title: 'Следующий шаг', description: 'Оператор назвал клиенту конкретный следующий шаг и срок.', na_rule: 'Клиент ушёл до ответа.', notes: '' },
    model: 'claude-opus-5-5', cost_usd: 0.0123, seconds: 14.2,
  };
  const html = renderToStaticMarkup(<CriterionReview review={review} criterion={criterion} />);
  assert.match(html, /Сложно оценить однозначно/);
  assert.match(html, /&lt;шагом&gt;/, 'model text is escaped');
  assert.match(html, /Когда критерий неприменим/);
  assert.match(html, /\$0\.012/);
  assert.match(html, /data-action="apply-criterion-suggestion"/);
  assert.doesNotMatch(html, /criterion-review-field"><small>Название критерия/, 'unchanged title is not offered');
});

test('advice without changes has no apply button; English labels are translated', () => {
  setLocale('en');
  const html = renderToStaticMarkup(<CriterionReview review={{ verdict: 'good', summary: '', issues: [], suggestion: { title: criterion.title, description: criterion.description, na_rule: '', notes: '' }, model: 'demo' }} criterion={criterion} />);
  assert.match(html, /Clearly worded/);
  assert.match(html, /Training mode: simple rules, no AI/);
  assert.doesNotMatch(html, /apply-criterion-suggestion/);
  setLocale('ru');
});

test('training mode rules catch vague words and a missing N/A rule', () => {
  const out = ruleReview({ criterion, checklist: { criteria: [] } });
  assert.equal(out.verdict, 'improve');
  assert.deepEqual(out.issues.map(i => i.field).sort(), ['description', 'description', 'na_rule']);
  assert.throws(() => ruleReview({ criterion: { title: ' ', description: '' } }));
});

test('re-evaluation after a new version explains that only changed criteria go to the model', async () => {
  const { ModalContents } = await import('../react/pages');
  setLocale('ru');
  const base = { kind: 'evaluate' as const, count: 65, checklists: [checklist], demo: false };
  assert.match(renderToStaticMarkup(<ModalContents data={{ ...base, reuse: true }} />), /data-reuse-note/);
  assert.doesNotMatch(renderToStaticMarkup(<ModalContents data={base} />), /data-reuse-note/);
  assert.doesNotMatch(renderToStaticMarkup(<ModalContents data={{ ...base, reuse: true, demo: true }} />), /data-reuse-note/);
});
