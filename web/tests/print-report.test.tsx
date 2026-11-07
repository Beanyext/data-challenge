import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { PrintReport } from '../react/print-report';
import { setLocale, translate as t } from '../react/i18n';

function fixture() {
  return {
    record: { conversation_id: 'report-test', title: 'Test report', channel: 'voice call', language: 'RU', transcript: Array.from({ length: 120 }, (_, index) => ({ speaker: index % 2 ? 'operator' : 'client', text: `Message ${index + 1}`, timestamp: `00:${index}` })) },
    evaluation: { id: 'evaluation', checklist_id: 'checklist', checklist_version: 4, total: 99.9, original_total: 0, gross_error: true, sections: [{ id: 'section', score: 99.9 }], criteria: [
      { criterion_id: 'normal', answer: 7, original_answer: 0, weight: 15, effective_weight: 17.63, points: 12.34, explanation: 'Explanation', evidence: [{ turn: 0, quote: '<script>unsafe</script>' }, { turn: 119, quote: 'Last quote' }], checked_range: { from: 0, to: 119 } },
      { criterion_id: 'na', answer: 'na', na_reason: 'Not applicable reason', needs_review: true },
      { criterion_id: 'gross', answer: 'yes', needs_review: true },
    ] },
    checklist: { id: 'checklist', version: 4, name: 'Custom checklist', sections: [{ id: 'section', name: 'Custom section' }], criteria: [
      { id: 'normal', section_id: 'section', title: 'Normal criterion', description: 'Custom rule', weight: 15, answer_type: 'scale', scale: { max: 10, steps: [{ value: 7, label: 'Partially' }, { value: 10, label: 'Fully' }] } },
      { id: 'na', title: 'NA criterion', description: 'Custom rule', weight: 5, answer_type: 'binary' },
      { id: 'gross', title: 'Gross criterion', description: 'Custom rule', weight: 0, gross_error: true, answer_type: 'binary' },
    ] },
    appeals: [{ id: 'appeal', evaluation_id: 'evaluation', criterion_id: 'normal', status: 'changed', comment: 'Operator comment', decision: { answer: 7, reason: 'Reviewer reason' } }],
    demo: true,
  };
}

test('print report contains every message, all evidence and decisions without changing source data', () => {
  const props = fixture();
  const original = structuredClone(props);
  const dom = new JSDOM(renderToStaticMarkup(<PrintReport {...props}/>));
  const document = dom.window.document;
  assert.equal(document.querySelectorAll('.print-turn').length, 120);
  assert.match(document.querySelector('.print-turn:last-child').textContent, /Message 120/);
  assert.equal(document.querySelectorAll('.print-evidence').length, 2);
  for (const text of ['Last quote', 'Reviewer reason', 'Operator comment']) assert.ok(document.querySelector('.print-report').textContent.includes(text));
  assert.equal(document.querySelector('script, button, details, [id]'), null);
  assert.match(document.querySelector('.print-evidence').textContent, /<script>unsafe<\/script>/);
  assert.match(document.querySelector('.print-appeal').textContent, /Исходный ответ: 0/);
  assert.match(document.querySelector('.print-revision').textContent, /Исходная оценка: 0/);
  assert.match(document.querySelector('.print-calculation').textContent, /12,34 \/ 17,63/);
  assert.deepEqual(props, original);
  dom.window.close();
});

test('print report preserves N/A, separate gross violation and missing configuration in every locale', () => {
  try {
    for (const locale of ['ru', 'en', 'kk'] as const) {
      setLocale(locale);
      const props = fixture();
      const dom = new JSDOM(renderToStaticMarkup(<PrintReport {...props}/>));
      const document = dom.window.document;
      const cards = document.querySelectorAll('.print-criterion');
      assert.match(document.querySelector('.print-summary').textContent, locale === 'en' ? /99\.9/ : /99,9/);
      assert.ok(document.querySelector('.print-critical').textContent.includes(t('Выявлена грубая ошибка')));
      assert.ok(cards[2].textContent.includes(t('Нарушение выявлено')));
      assert.ok(cards[2].textContent.includes(t('Нужна проверка')));
      assert.equal(cards[2].querySelector('.print-calculation'), null);
      assert.equal(cards[1].querySelector('.print-calculation'), null);
      assert.ok(cards[1].textContent.includes('Not applicable reason'));
      assert.ok(document.querySelector('h1').textContent.includes(t('Отчёт о качестве диалога')));
      assert.ok(document.querySelector('.print-notice').textContent.includes(t('Учебный пример.')));
      dom.window.close();
      props.checklist = undefined;
      const withoutChecklist = renderToStaticMarkup(<PrintReport {...props}/>);
      assert.ok(withoutChecklist.includes('normal') && withoutChecklist.includes(t('Выявлена грубая ошибка')));
    }
  } finally { setLocale('ru'); }
});

test('printing an unevaluated or all-N/A conversation does not invent a zero score', () => {
  const props = fixture();
  props.evaluation = null;
  const empty = renderToStaticMarkup(<PrintReport {...props}/>);
  assert.ok(empty.includes(t('Оценка ещё не выполнена')));
  assert.ok(empty.includes('Message 120'));
  assert.ok(!empty.includes('Custom checklist'), 'unevaluated conversation must not claim a checklist was applied');
  const allNa = fixture();
  allNa.evaluation.total = null;
  allNa.evaluation.original_total = null;
  allNa.evaluation.gross_error = false;
  allNa.evaluation.sections = [];
  allNa.appeals = [];
  allNa.evaluation.criteria = [allNa.evaluation.criteria[1]];
  const dom = new JSDOM(renderToStaticMarkup(<PrintReport {...allNa}/>));
  assert.match(dom.window.document.querySelector('.print-summary').textContent, /— \/ 100/);
  assert.ok(dom.window.document.body.textContent.includes(t('Нет применимых критериев для расчёта')));
  dom.window.close();
});

test('a print report never substitutes another checklist version or implies unchanged weights were redistributed', () => {
  const props = fixture();
  props.checklist.version = 5;
  let html = renderToStaticMarkup(<PrintReport {...props}/>);
  assert.ok(!html.includes('Custom rule') && !html.includes('Custom checklist'));
  assert.ok(html.includes(t('Версия чек-листа недоступна. Показаны сохранённые ответы и баллы.')));
  props.checklist.version = 4;
  props.evaluation.criteria[0].effective_weight = 15;
  html = renderToStaticMarkup(<PrintReport {...props}/>);
  assert.ok(!html.includes(t('Вес после N/A')));
  assert.ok(html.includes(t('Максимум баллов')));
  props.evaluation.checklist = props.checklist;
  props.checklist = { ...props.checklist, version: 5, name: 'Wrong checklist' };
  html = renderToStaticMarkup(<PrintReport {...props}/>);
  assert.ok(html.includes('Custom checklist') && !html.includes('Wrong checklist'));
});
