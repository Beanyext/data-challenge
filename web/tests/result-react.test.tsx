import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvaluationView } from '../react/result';
import { DialogWorkspaceSummary } from '../react/pages';
import { JSDOM } from 'jsdom';
const renderEvaluationView = props => renderToStaticMarkup(<EvaluationView {...props}/>);
const renderEvaluationWorkspace = props => renderToStaticMarkup(<><DialogWorkspaceSummary evaluation={props.evaluation}/><EvaluationView {...props}/></>);

function fixture() {
  return {
    demo: true,
    dialog: { transcript: [{ speaker: 'client', text: 'Вопрос' }, { speaker: 'operator', text: 'Ответ' }] },
    checklist: { id: 'cl', version: 1, sections: [{ id: 'a', name: 'Начало' }, { id: 'b', name: 'Решение' }, { id: 'c', name: 'Нарушения' }], criteria: [
      { id: 'binary', section_id: 'a', title: 'Контакт', answer_type: 'binary', weight: 10 },
      { id: 'scale', section_id: 'b', title: 'Ясность', answer_type: 'scale', weight: 15, scale: { max: 10, steps: [{ value: 0, label: 'Нет ответа' }, { value: 4, label: 'Непонятно' }, { value: 7, label: 'Один сбой' }, { value: 10, label: 'Ясно' }] } },
      { id: 'gross', section_id: 'c', title: 'Грубые ошибки', answer_type: 'binary', gross_error: true, weight: 0 },
    ] },
    evaluation: { id: 'e1', checklist_version: 1, total: 87.63, gross_error: false, criteria: [
      { criterion_id: 'binary', answer: 'yes', weight: 10, points: 10, explanation: 'Есть приветствие', evidence: [{ turn: 1, quote: 'Ответ' }] },
      { criterion_id: 'scale', answer: 7, weight: 15, effective_weight: 17.63, points: 12.34, explanation: 'Один сбой' },
      { criterion_id: 'gross', answer: 'no', weight: 0, explanation: 'Не выявлено' },
    ] },
    appeals: [],
  };
}

test('presentation preserves provided scores, weights and configuration without recalculation', () => {
  const data = fixture();
  const before = structuredClone(data);
  const html = renderEvaluationWorkspace(data);
  assert.match(html, /87,63/);
  assert.match(html, /12,34/);
  assert.match(html, /17,63/);
  assert.match(html, /Базовый вес/);
  assert.match(html, /Вес после N\/A/);
  assert.match(html, /Баллы в итог/);
  assert.match(html, /is-current"><span>7<\/span>/);
  assert.deepEqual(data, before);
});

test('all result criteria remain visible once, including criteria outside configured sections', () => {
  const data = fixture();
  data.evaluation.criteria.push({ criterion_id: 'new-server-criterion', answer: 'no', explanation: 'Новый критерий' });
  const html = renderEvaluationView(data);
  for (const item of data.evaluation.criteria) assert.equal(html.split(`id="criterion-${item.criterion_id}"`).length - 1, 1);
  assert.match(html, /Начало/);
  assert.match(html, /Решение/);
  assert.match(html, /Нарушения/);
  assert.match(html, /Другие критерии/);
});

test('N/A has neutral presentation, a visible reason and no zero-score substitution', () => {
  const data = fixture();
  data.evaluation.criteria = [{ criterion_id: 'scale', answer: 'na', na_reason: 'Запрос не сформулирован', needs_review: true }];
  const html = renderEvaluationView(data);
  assert.match(html, /result-answer-na">Не применяется/);
  assert.match(html, /Запрос не сформулирован/);
  assert.match(html, /Нужна проверка человеком/);
  assert.doesNotMatch(html, /criterion-metrics/);
  assert.doesNotMatch(html, /result-answer-attention">Не применяется/);
});

test('a gross violation is independently visible beside an unchanged high score', () => {
  const data = fixture();
  data.evaluation.total = 99.9;
  data.evaluation.gross_error = true;
  data.evaluation.criteria[2].answer = 'yes';
  const html = renderEvaluationWorkspace(data);
  assert.match(html, /99,9/);
  assert.match(html, /result-critical-banner/);
  assert.match(html, /Нарушение выявлено/);
  assert.match(html, /Отмечается отдельно от итогового балла/);
});

test('N/A reasons remain visible for a configured separate flag without adding points', () => {
  const data = fixture();
  data.checklist.criteria[2].na_allowed = true;
  data.evaluation.criteria = [{ criterion_id: 'gross', answer: 'na', na_reason: 'Отметка неприменима к этому каналу' }];
  const html = renderEvaluationView(data);
  assert.match(html, /result-answer-na/);
  assert.match(html, /Отметка неприменима к этому каналу/);
  assert.doesNotMatch(html, /criterion-metrics/);
});

test('server section scores remain visible without a checklist snapshot', () => {
  const data = fixture();
  data.checklist = undefined;
  data.evaluation.sections = [{ id: 'a', name: 'Контакт <вход>', score: 12.34 }, { id: 'b', name: 'Решение', score: null }];
  const html = renderEvaluationView(data);
  assert.match(html, /Контакт &lt;вход&gt;/);
  assert.match(html, /12,34/);
  assert.match(html, /Решение <strong>—/);
  for (const item of data.evaluation.criteria) assert.equal(html.split(`id="criterion-${item.criterion_id}"`).length - 1, 1);
});

test('first quote is visible directly and all untrusted evidence remains escaped', () => {
  const data = fixture();
  data.evaluation.criteria[0].evidence = [
    { turn: 1, quote: '<img src=x onerror=alert(1)>' },
    { turn: '1" onclick="alert(1)', quote: '<script>bad</script>' },
  ];
  data.evaluation.criteria[1].checked_range = { from: '0" onmouseover="bad', to: 1 };
  const html = renderEvaluationView(data);
  assert.ok(html.indexOf('&lt;img') < html.indexOf('<details'));
  assert.match(html, /data-turn="1"/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Некорректный диапазон доказательства/);
  assert.doesNotMatch(html, /<img|<script|onclick=|onmouseover=/);
});

test('valid checked ranges keep existing navigation hooks and exclude out-of-range targets', () => {
  const data = fixture();
  data.evaluation.criteria[1].checked_range = { from: 0, to: 1 };
  let html = renderEvaluationView(data);
  assert.match(html, /data-turn="0" data-range-end="1"/);
  data.evaluation.criteria[1].checked_range.to = 4;
  html = renderEvaluationView(data);
  assert.doesNotMatch(html, /data-range-end="4"/);
});

test('review comparison uses original values including zero and preserves appeal action', () => {
  const data = fixture();
  data.evaluation.original_total = 0;
  data.evaluation.criteria[1].original_answer = 0;
  data.appeals = [{ evaluation_id: 'e1', criterion_id: 'scale', status: 'changed', decision: { answer: 7, reason: 'Учтена реплика' } }];
  const html = renderEvaluationView(data);
  assert.match(html, /Исходная оценка<\/span><strong>0/);
  assert.match(html, /Исходный ответ<\/span><strong>0/);
  assert.match(html, /Учтена реплика/);
  assert.match(html, /data-appeal="scale"/);
  assert.match(html, /Итоговая оценка/);
});

test('an identical original total alone does not imply a review, but a recorded decision does', () => {
  const data = fixture();
  data.evaluation.original_total = data.evaluation.total;
  assert.doesNotMatch(renderEvaluationView(data), /result-total-revision/);
  data.appeals = [{ evaluation_id: 'other-evaluation', criterion_id: 'scale', status: 'confirmed', decision: { answer: 7, reason: 'Решение по другой оценке' } }];
  assert.doesNotMatch(renderEvaluationView(data), /result-total-revision/);
  data.appeals = [{ evaluation_id: 'e1', criterion_id: 'scale', status: 'confirmed', decision: { answer: 7, reason: 'Ответ подтверждён' } }];
  const html = renderEvaluationView(data);
  assert.match(html, /result-total-revision/);
  assert.match(html, /Ответ подтверждён/);
});

test('a decision stored on the criterion and an original zero total each retain the review summary', () => {
  const data = fixture();
  data.evaluation.original_total = data.evaluation.total;
  data.evaluation.criteria[1].decision = { status: 'confirmed', answer: 7, reason: 'Решение из сохранённой оценки' };
  assert.match(renderEvaluationView(data), /result-total-revision/);
  delete data.evaluation.criteria[1].decision;
  assert.doesNotMatch(renderEvaluationView(data), /result-total-revision/);
  data.evaluation.original_total = 0;
  const html = renderEvaluationView(data);
  assert.match(html, /result-total-revision/);
  assert.match(html, /Исходная оценка<\/span><strong>0/);
});

test('absence of an evaluation and all-N/A results have distinct empty presentations', () => {
  assert.match(renderEvaluationView({ evaluation: null }), /Оценка ещё не выполнена/);
  const data = fixture();
  data.evaluation.total = null;
  const html = renderEvaluationWorkspace(data);
  assert.match(html, /Нет применимых критериев для расчёта/);
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('.review-summary-score strong').textContent, '— / 100');
});

test('criterion rows preserve unknown criteria and separate violation, review and N/A', () => {
  const data = fixture();
  data.evaluation.criteria[2].answer = 'yes';
  data.evaluation.criteria[2].needs_review = true;
  data.evaluation.criteria[1].answer = 'na';
  data.evaluation.criteria.push({ criterion_id: 'new:criterion/with spaces', answer: 'no' });
  const dom = new JSDOM(renderEvaluationView(data));
  const document = dom.window.document;
  const map = document.getElementById('criteria-map');
  assert.equal(map.getAttribute('role'), 'region');
  assert.equal(map.getAttribute('tabindex'), '-1');
  const buttons = [...map.querySelectorAll('.result-row')];
  assert.equal(buttons.length, 4);
  for (const button of buttons) {
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.ok(document.getElementById(button.getAttribute('aria-controls')).hasAttribute('hidden'));
  }
  assert.equal(document.querySelector('.result-criterion-critical .result-answer').textContent, 'Нарушение выявлено');
  assert.equal(document.querySelector('.result-criterion-critical .result-row-review').textContent, 'Нужна проверка');
  assert.equal(document.querySelector('.result-criterion-na .result-answer').textContent, 'Не применяется');
  assert.equal(document.getElementById('criterion-new:criterion/with spaces').querySelector('.result-row-title').textContent, 'new:criterion/with spaces');
  for (const id of ['scale', 'gross']) {
    assert.equal(document.getElementById(`criterion-${id}`).querySelector('.result-calculation'), null);
    assert.equal(document.getElementById(`criterion-${id}`).querySelector('.result-points'), null);
  }
  dom.window.close();
  const unknown = fixture();
  unknown.checklist = undefined;
  unknown.evaluation.gross_error = true;
  unknown.evaluation.criteria[2].answer = 'yes';
  const missingDefinition = new JSDOM(renderEvaluationView(unknown));
  assert.ok(missingDefinition.window.document.querySelector('.result-critical-banner'));
  assert.equal(missingDefinition.window.document.querySelectorAll('.result-criterion-neutral').length, 3);
  assert.equal(missingDefinition.window.document.querySelector('.result-answer-success'), null, 'unknown yes cannot be classified as a positive answer');
  missingDefinition.window.close();
});
