import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { EvaluationView } from '../react/result';
import { DialogRows, EstimateNote } from '../react/pages';
import { PrintReport } from '../react/print-report';
import { dialogTitle } from '../react/shared';
import { setLocale, translate as t, translatePlural } from '../react/i18n';
import { shortReason, criterionReason } from '../react/text';

const dom = (html: string) => new JSDOM(`<body>${html}</body>`).window.document;
const transcript = Array.from({ length: 6 }, (_, index) => ({ speaker: index % 2 ? 'operator' : 'client', text: `Реплика ${index + 1}`, timestamp: `2026-11-07T09:00:${String(index * 5).padStart(2, '0')}Z`, display_time: `00:${String(index * 5).padStart(2, '0')}` }));
function fixture() {
  return {
    dialog: { conversation_id: 'd1', channel: 'agent chat', language: 'RU', transcript },
    checklist: { id: 'cl', version: 2, name: 'Чек-лист', sections: [{ id: 'a', name: 'Начало' }, { id: 'b', name: 'Решение' }, { id: 'g', name: 'Нарушения' }], criteria: [
      { id: 'full', section_id: 'a', title: 'Приветствие', description: 'Правило', answer_type: 'binary' as const, weight: 10 },
      { id: 'zero', section_id: 'b', title: 'Консультация', description: 'Правило', answer_type: 'scale' as const, weight: 20, scale: { max: 20, steps: [{ value: 0, label: 'Нет ответа' }, { value: 20, label: 'Полный ответ' }] } },
      { id: 'part', section_id: 'b', title: 'Ведение', description: 'Правило', answer_type: 'scale' as const, weight: 15, scale: { max: 10, steps: [{ value: 5, label: 'Частично' }, { value: 10, label: 'Ясно' }] } },
      { id: 'na', section_id: 'a', title: 'Идентификация', description: 'Правило', answer_type: 'binary' as const, weight: 5, na_allowed: true, na_rule: 'Не нужна' },
      { id: 'gross', section_id: 'g', title: 'Грубые ошибки', description: 'Правило', answer_type: 'binary' as const, weight: 0, gross_error: true },
    ] },
    evaluation: { id: 'e1', checklist_version: 2, total: 39.29, gross_error: true, sections: [{ id: 'a', name: 'Начало', score: 22.22, max: 22.22 }, { id: 'b', name: 'Решение', score: 16.67, max: 77.78 }, { id: 'g', name: 'Нарушения', score: null, max: 0 }], criteria: [
      { criterion_id: 'full', answer: 'yes' as const, points: 22.22, effective_weight: 22.22, weight: 10, applicable: true, explanation: 'Приветствие — Да. Оператор поздоровался. Основание — реплика [2].', evidence: [{ turn: 1, quote: 'Реплика 2' }] },
      { criterion_id: 'zero', answer: 0, points: 0, effective_weight: 44.44, weight: 20, applicable: true, reason: 'Ответа по существу нет, см. [4] и [9].', explanation: 'Консультация — 0. Ответа нет. Основание — реплики [4] и [9].', checked_range: { from: 2, to: 5 } },
      { criterion_id: 'part', answer: 5, points: 16.67, effective_weight: 33.33, weight: 15, applicable: true, explanation: 'Ведение — 5. Один сбой.', evidence: [{ turn: 4, quote: 'Реплика 5' }] },
      { criterion_id: 'na', answer: 'na' as const, points: null, effective_weight: 0, weight: 5, applicable: false, na_reason: 'Вопрос общий, см. [1].' },
      { criterion_id: 'gross', answer: 'yes' as const, points: null, effective_weight: 0, weight: 0, gross_error: true, reason: 'Оператор предложил перевод денег лично, реплика [6].', explanation: 'Грубые ошибки — Да. Оператор предложил перевод денег лично. Основание — реплика [6].', evidence: [{ turn: 5, quote: 'Скиньте деньги мне на карту' }] },
    ] },
    appeals: [{ id: 'ap1', evaluation_id: 'e1', criterion_id: 'part', comment: 'Не согласен', status: 'open' as const }],
  };
}

test('turn numbers in explanations open message N-1; numbers outside the transcript stay text', () => {
  const document = dom(renderToStaticMarkup(<EvaluationView {...fixture()}/>));
  const zero = document.getElementById('criterion-zero')!;
  const buttons = [...zero.querySelectorAll('.result-reason .turn-ref')];
  assert.deepEqual(buttons.map(button => [button.textContent, button.getAttribute('data-turn')]), [['№ 4', '3']]);
  assert.match(zero.querySelector('.result-reason')!.textContent!, /№ 9/, 'out-of-range number is plain text');
  assert.ok(!zero.querySelector('.result-reason')!.textContent!.includes('['));
  const na = document.getElementById('criterion-na')!;
  assert.equal(na.querySelector('.result-na .turn-ref')!.getAttribute('data-turn'), '0');
  assert.equal(document.querySelector('.result-row .turn-ref'), null, 'collapsed row shows plain numbers inside its button');
});

test('summary ring, section bars and lost points ordered by size with actions', () => {
  const document = dom(renderToStaticMarkup(<EvaluationView {...fixture()}/>));
  assert.equal(document.querySelector('.result-summary'), null);
  assert.ok(document.querySelector('.result-ring.result-ring-low'), 'below 60 is red');
  assert.equal(document.querySelector('.result-ring')!.getAttribute('aria-label'), 'Итоговый балл: 39,29 из 100');
  assert.deepEqual([...document.querySelectorAll('.section-bar-name')].map(node => node.textContent), ['Начало', 'Решение'], 'sections without points are not drawn');
  const rows = [...document.querySelectorAll('.loss-row')];
  assert.deepEqual(rows.map(row => row.getAttribute('data-criterion')), ['zero', 'part'], 'largest loss first; full, N/A and gross excluded');
  assert.equal(rows[0].querySelector('.loss-value')!.textContent, '−44,44');
  assert.match(rows[0].querySelector('.loss-title')!.textContent!, /Консультация · 0 из 20/);
  assert.equal(rows[0].querySelector('.loss-reason .turn-ref')!.getAttribute('data-turn'), '3');
  assert.equal(rows[0].querySelector('.loss-actions [data-turn]')!.getAttribute('data-turn'), '2', 'without evidence the checked range start is used');
  assert.equal(rows[1].querySelector('.loss-actions [data-turn]')!.textContent, 'К реплике № 5');
  assert.ok(rows[1].querySelector('[data-appeal="part"]')!.hasAttribute('disabled'), 'an open appeal disables a second one');
  assert.ok(!rows[0].querySelector('[data-appeal="zero"]')!.hasAttribute('disabled'));
  const none = fixture();
  none.evaluation.criteria = none.evaluation.criteria.filter(item => item.criterion_id === 'full');
  none.checklist.criteria = none.checklist.criteria.filter(item => item.id === 'full');
  assert.match(renderToStaticMarkup(<EvaluationView {...none}/>), /Баллы не потеряны/);
});

test('gross error banner names the reason, quotes the evidence and offers both actions', () => {
  const document = dom(renderToStaticMarkup(<EvaluationView {...fixture()}/>));
  const banner = document.querySelector('.result-critical-banner')!;
  assert.match(banner.querySelector('strong')!.textContent!, /^Грубая ошибка: Оператор предложил перевод денег лично, реплика № 6\.$/);
  assert.equal(banner.querySelector('strong .turn-ref')!.getAttribute('data-turn'), '5');
  assert.match(banner.querySelector('blockquote')!.textContent!, /Скиньте деньги мне на карту/);
  assert.equal(banner.querySelector('.result-critical-actions [data-turn]')!.textContent, 'К реплике № 6');
  assert.ok(banner.querySelector('[data-appeal="gross"]'));
  assert.match(banner.textContent!, /На итог не влияет, учитывается отдельно\./);
  assert.ok(!banner.textContent!.includes('Проверьте раздел нарушений'));
});

test('criteria are compact rows with answer tone, points and a disclosure button', () => {
  const document = dom(renderToStaticMarkup(<EvaluationView {...fixture()}/>));
  const row = (id: string) => document.querySelector(`#criterion-${id} .result-row`)!;
  for (const id of ['full', 'zero', 'part', 'na', 'gross']) {
    assert.equal(row(id).getAttribute('aria-expanded'), 'false');
    assert.ok(document.getElementById(row(id).getAttribute('aria-controls')!)!.hasAttribute('hidden'));
  }
  assert.ok(row('full').querySelector('.result-answer-success'));
  assert.ok(row('zero').querySelector('.result-answer-fail'));
  assert.equal(row('part').querySelector('.result-answer-partial')!.textContent, '5 из 10');
  assert.equal(row('na').querySelector('.result-answer-na')!.textContent, 'Не применяется');
  assert.ok(row('gross').querySelector('.result-answer-critical'));
  assert.equal(row('full').querySelector('.result-row-points')!.textContent, '22,22 / 22,22');
  assert.equal(row('na').querySelector('.result-row-points')!.textContent, '—');
  assert.equal(row('gross').querySelector('.result-row-points')!.textContent, 'без баллов');
  assert.equal(row('full').querySelector('.result-row-reason')!.textContent, 'Оператор поздоровался.', 'no «Title — answer.» lead and no basis tail');
});

test('server reason is preferred; otherwise the first sentence without lead and basis', () => {
  assert.equal(shortReason('Консультация — Нет. Оператор не ответил на вопрос о комиссии. Основание — реплики [4] и [6].', 'Консультация'), 'Оператор не ответил на вопрос о комиссии.');
  assert.equal(criterionReason({ criterion_id: 'x', answer: 'no', reason: 'Готовая причина', explanation: 'Другое' }), 'Готовая причина');
  assert.equal(criterionReason({ criterion_id: 'x', answer: 'na', na_reason: 'Вопрос общий.', explanation: '' }), 'Вопрос общий.');
});

test('list rows: call titles, coloured score, attention-only statuses and gross reason', () => {
  const rows = [
    { conversation_id: 'call', channel: 'voice call', language: 'KZ', title: 'Первая реплика клиента', duration_seconds: 312, total: 91, status: 'evaluated', evaluation_id: 'e' },
    { conversation_id: 'call-short', channel: 'voice call', language: 'RU', title: 'Первая реплика', total: null, status: 'new' },
    { conversation_id: 'chat', channel: 'agent chat', language: 'RU', title: 'Вопрос о комиссии', total: 20, gross_error: true, gross_error_reason: 'Оператор предложил перевод денег лично, реплика [12].', open_appeals: 1, needs_review: true, status: 'evaluated', evaluation_id: 'e2' },
    { conversation_id: 'mid', channel: 'agent chat', language: 'EN', title: 'Fees', total: 60, status: 'pending', evaluation_id: 'e3' },
    { conversation_id: 'err', channel: 'agent chat', language: 'EN', title: 'Error', total: null, status: 'error', evaluation_id: 'e4' },
  ];
  const document = new JSDOM(`<table><tbody>${renderToStaticMarkup(<DialogRows rows={rows} selected={new Set()}/>)}</tbody></table>`).window.document;
  const row = (id: string) => document.querySelector(`[data-select="${id}"]`)!.closest('tr')!;
  assert.equal(row('call').querySelector('.dialog-title')!.textContent, 'Звонок · KZ · 05:12');
  assert.equal(row('call-short').querySelector('.dialog-title')!.textContent, 'Звонок · RU');
  assert.equal(row('chat').querySelector('.dialog-title')!.textContent, 'Вопрос о комиссии');
  assert.ok(row('call').querySelector('.score-pill.score-high'));
  assert.ok(row('mid').querySelector('.score-pill.score-mid'));
  assert.ok(row('chat').querySelector('.score-pill.score-low'));
  assert.equal(row('call').querySelector('.row-statuses')!.textContent, '', 'no «Оценён» label');
  assert.equal(row('call-short').querySelector('.row-statuses')!.textContent, 'Без оценки');
  assert.deepEqual([...row('chat').querySelectorAll('.row-statuses .badge')].map(badge => badge.textContent), ['Грубая ошибка', 'Апелляция', 'Нужна проверка']);
  assert.equal(row('mid').querySelector('.row-statuses')!.textContent, 'Оценивается');
  assert.equal(row('err').querySelector('.row-statuses')!.textContent, 'Ошибка оценки');
  assert.equal(row('chat').querySelector('.dialog-gross-reason')!.textContent, 'Оператор предложил перевод денег лично, реплика № 12.');
  assert.equal(row('call').querySelector('.dialog-gross-reason'), null);
  assert.equal(dialogTitle({ conversation_id: 'x', channel: 'agent chat', language: 'RU', transcript: [{ speaker: 'client', text: 'Текст клиента' }] }), 'Текст клиента');
});

test('evaluation window estimate: test mode, price and time, no history; numbers follow the interface language', () => {
  const health = { provider: 'anthropic', model: 'claude-opus-5-5', estimate: { based_on: 65, cost_per_dialog_usd: 0.0437, seconds_per_dialog: 30, workers: 5 } };
  const text = (props: Parameters<typeof EstimateNote>[0]) => dom(renderToStaticMarkup(<EstimateNote {...props}/>)).body.textContent;
  assert.equal(text({ health, count: 5 }), 'Оценка 5 диалогов: ≈ $0,22 и около 30 с. Модель claude-opus-5-5, в среднем $0,044 за диалог по 65 последним оценкам.');
  assert.equal(text({ health, count: 1 }), 'Оценка 1 диалога: ≈ $0,04 и около 30 с. Модель claude-opus-5-5, в среднем $0,044 за диалог по 65 последним оценкам.');
  assert.match(text({ health, count: 12 })!, /≈ \$0,52 и около 2 мин\./, 'three rounds of 30 s round up to whole minutes');
  assert.match(text({ health: { ...health, estimate: { ...health.estimate, based_on: 21 } }, count: 2 })!, /по 21 последней оценке\./);
  assert.equal(text({ health: { provider: 'mock', model: 'mock', estimate: health.estimate }, count: 3 }), 'Тестовый режим: модель не вызывается, оценка бесплатная.');
  assert.equal(text({ health: { provider: 'anthropic', model: 'claude-opus-5-5', estimate: { based_on: 0, cost_per_dialog_usd: null, seconds_per_dialog: null, workers: 5 } }, count: 3 }), 'Модель claude-opus-5-5. Примерную цену покажем после первых оценок.');
  assert.equal(renderToStaticMarkup(<EstimateNote health={null} count={3}/>), '');
  try {
    setLocale('en');
    assert.equal(text({ health, count: 5 }), 'Evaluating 5 conversations: ≈ $0.22, about 30 s. Model claude-opus-5-5, on average $0.044 per conversation based on the last 65 evaluations.');
    assert.equal(translatePlural(1, { one: 'Переоценить {count} диалог по v{version}', few: 'Переоценить {count} диалога по v{version}', many: 'Переоценить {count} диалогов по v{version}' }, { version: 2 }), 'Re-evaluate 1 conversation with v2');
    setLocale('kk');
    assert.match(text({ health, count: 5 })!, /≈ \$0,22, шамамен 30 сек\./);
  } finally { setLocale('ru'); }
  const forms = { one: 'Переоценить {count} диалог по v{version}', few: 'Переоценить {count} диалога по v{version}', many: 'Переоценить {count} диалогов по v{version}' };
  assert.deepEqual([1, 3, 5, 21].map(count => translatePlural(count, forms, { version: 2 })), ['Переоценить 1 диалог по v2', 'Переоценить 3 диалога по v2', 'Переоценить 5 диалогов по v2', 'Переоценить 21 диалог по v2']);
  assert.equal(t('{m} мин', { m: 2 }), '2 мин');
});

test('print report keeps turn numbers as plain text and uses time from the start of the call', () => {
  const data = fixture();
  const record = { ...data.dialog, channel: 'voice call', duration_seconds: 25 };
  const document = dom(renderToStaticMarkup(<PrintReport record={record} evaluation={data.evaluation} checklist={data.checklist} appeals={[]} demo={false}/>));
  const report = document.querySelector('.print-report')!;
  assert.equal(report.querySelector('button'), null);
  assert.ok(report.textContent!.includes('Основание — реплики № 4 и № 9.'));
  assert.ok(!/\[\d+\]/.test(report.textContent!));
  assert.equal(report.querySelector('.print-turn h4')!.textContent, '1 · Клиент · 00:00');
  assert.equal(report.querySelector('.print-report-subject')!.textContent, 'Звонок · RU · 00:25');
  assert.match(report.querySelector('.print-critical')!.textContent!, /Оператор предложил перевод денег лично, реплика № 6/);
});
