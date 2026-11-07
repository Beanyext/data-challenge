import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../report.mjs';

function fixture() {
  const checklist = { id: 'qa', version: 2, name: 'Учебный чек-лист', sections: [{ id: 's1', name: 'Контакт' }], criteria: [{ id: 'c1', title: 'Приветствие', description: 'Поздороваться.', weight: 10, answer_type: 'binary', gross_error: false }] };
  const dialog = { conversation_id: 'fictional-001', title: 'Вымышленный диалог', channel: 'agent chat', language: 'KZ', transcript: [{ timestamp: '00:00', speaker: 'client', text: 'Сәлеметсіз бе!' }, { timestamp: '00:02', speaker: 'operator', text: 'Сәлеметсіз бе! Мен оқу операторы.' }, { timestamp: '00:03', speaker: 'client', text: 'Рақмет.' }] };
  const evaluation = { id: 'eval-1', conversation_id: dialog.conversation_id, checklist_id: 'qa', checklist_version: 2, checklist, model: 'test-model', evaluated_at: '2026-11-07T10:00:00Z', total: 100, original_total: 90, gross_error: false, sections: [{ id: 's1', score: 100 }], criteria: [{ criterion_id: 'c1', answer: 'yes', original_answer: 'no', points: 100, weight: 10, effective_weight: 100, explanation: 'Приветствие дано.', evidence: [{ turn: 1, quote: 'Сәлеметсіз бе!' }], checked_range: null, na_reason: null, needs_review: false }] };
  return { dialog, evaluation, checklist };
}

test('report includes saved metadata, scores, evidence context, original answer and matching decision', () => {
  const data = fixture();
  const html = buildReport({ ...data, appeals: [{ id: 'a1', evaluation_id: 'eval-1', criterion_id: 'c1', status: 'changed', comment: 'Проверьте приветствие.', decision: { answer: 'yes', reason: 'Подтверждено репликой.', decided_at: '2026-11-07T10:05:00Z' } }] });
  for (const text of ['quality-report', 'Отчёт о качестве диалога', 'fictional-001', 'Приветствие', 'test-model', 'Баллы по разделам', 'Исходный балл', '90', 'Базовый вес', 'Действующий вес', 'Исходный ответ', 'Реплика 2', '00:02', 'Рақмет.', 'Подтверждено репликой.', 'Оценка изменена']) assert.ok(html.includes(text), text);
  assert.match(html, /Время оценки, Алматы/);
  assert.doesNotMatch(html, /Учебный отчёт/);
});

test('null score differs from numeric zero; missing evaluation invents no result', () => {
  const data = fixture();
  data.evaluation.total = null;
  data.evaluation.original_total = 0;
  const html = buildReport(data);
  assert.match(html, /class="report-total">Не рассчитан/);
  assert.match(html, /class="report-original">0 <span>\/ 100/);
  assert.match(buildReport({ dialog: data.dialog }), /Оценка ещё не выполнена/);
  assert.doesNotMatch(buildReport(), /class="report-total"/);
  data.evaluation.total = Infinity;
  assert.match(buildReport(data), /class="report-total">Не передано/);
});

test('demo or mock metadata explicitly marks report as not an AI result', () => {
  for (const patch of [{ demo: true }, { evaluation: { ...fixture().evaluation, demo: true } }, { evaluation: { ...fixture().evaluation, provider: 'mock' } }, { evaluation: { ...fixture().evaluation, provider: 'demo' } }, { evaluation: { ...fixture().evaluation, model: 'mock' } }]) {
    assert.match(buildReport({ ...fixture(), ...patch }), /Учебный отчёт/);
  }
});

test('wrong checklist snapshot is not used to title historical results', () => {
  const data = fixture();
  data.evaluation.checklist = { ...data.checklist, version: 3, criteria: [{ id: 'c1', title: 'Чужое изменённое правило' }] };
  const validFallback = buildReport(data);
  assert.match(validFallback, /Приветствие/);
  assert.doesNotMatch(validFallback, /Чужое изменённое правило/);
  data.checklist = { ...data.checklist, id: 'another', criteria: [{ id: 'c1', title: 'Чужое правило' }] };
  const missing = buildReport(data);
  assert.match(missing, /Снимок использованной версии чек-листа недоступен/);
  assert.doesNotMatch(missing, /Чужое правило|Чужое изменённое правило|Поздороваться/);
});

test('report escapes hostile text and rejects noninteger proof references with positive control', () => {
  const data = fixture();
  const attack = '<img src=x onerror="window.unsafe=1">';
  data.dialog.title = attack;
  data.dialog.transcript[1].text = attack;
  data.evaluation.criteria[0].explanation = attack;
  data.evaluation.criteria[0].evidence[0].quote = attack;
  data.evaluation.criteria[0].checked_range = { from: attack, to: 1 };
  const html = buildReport(data);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img/);
  assert.match(html, /некорректная ссылка или диапазон/);
  data.evaluation.criteria[0].checked_range = { from: 0, to: 1 };
  assert.match(buildReport(data), /Проверенный участок: реплики 1–2/);
  assert.doesNotMatch(buildReport(data), /некорректная ссылка или диапазон/);
  data.evaluation.criteria[0].evidence = [{ turn: '1', quote: attack }];
  assert.match(buildReport(data), /Ссылка на реплику недействительна/);
});

test('report omits audio URLs, endpoints and signed links; calls include text-only record note', () => {
  const data = fixture();
  data.dialog.channel = 'voice call';
  data.dialog.audio_url = 'https://audio.example.invalid/recording?sig=secret-audio';
  data.evaluation.endpoint = 'https://api.example.invalid/invoke?sig=secret-endpoint';
  data.evaluation.criteria[0].explanation = 'Источник https://private.example.invalid/path?sig=secret-inline';
  const html = buildReport(data);
  assert.doesNotMatch(html, /audio\.example|api\.example|private\.example|secret-audio|secret-endpoint|secret-inline|sig=/);
  assert.match(html, /Запись доступна в карточке диалога/);
  assert.match(html, /ссылка с данными доступа скрыта/);
  assert.doesNotMatch(html, /<audio|<iframe|src=/);
});

test('appeals are filtered by exact evaluation ID, including missing-ID control', () => {
  const data = fixture();
  const appeals = [{ evaluation_id: 'eval-1', criterion_id: 'c1', comment: 'Своя апелляция', status: 'open' }, { evaluation_id: 'eval-10', criterion_id: 'c1', comment: 'Чужая апелляция', status: 'open' }, { criterion_id: 'c1', comment: 'Без оценки', status: 'open' }];
  assert.match(buildReport({ ...data, appeals }), /Своя апелляция/);
  assert.doesNotMatch(buildReport({ ...data, appeals }), /Чужая апелляция|Без оценки/);
  delete data.evaluation.id;
  assert.doesNotMatch(buildReport({ ...data, appeals }), /Своя апелляция|Чужая апелляция|Без оценки/);
});

test('N/A, gross errors and review flags do not recalculate final score', () => {
  const data = fixture();
  data.evaluation.total = 17.25;
  data.evaluation.gross_error = true;
  data.evaluation.criteria[0] = { criterion_id: 'c1', answer: 'na', na_reason: 'Запрос не требовал действия.', needs_review: true, explanation: 'Неприменимо.' };
  const html = buildReport(data);
  assert.match(html, /17,25 <span>\/ 100/);
  assert.match(html, /Грубые ошибки/);
  assert.match(html, /Обнаружены/);
  assert.match(html, /Отметка отдельно от итогового балла/);
  assert.match(html, /Причина N\/A/);
  assert.match(html, /Запрос не требовал действия/);
  assert.match(html, /Нужна проверка человеком/);
  assert.match(html, /Не применяется/);
});

test('malformed arrays and timestamps are handled without inventing metadata', () => {
  const data = fixture();
  data.dialog.transcript = null;
  data.evaluation.evaluated_at = 'not a date';
  data.evaluation.criteria[0].evidence = 'bad';
  data.evaluation.sections = 'bad';
  assert.doesNotThrow(() => buildReport(data));
  assert.match(buildReport(data), /Не указано/);
  assert.match(buildReport(data), /Доказательства в результате не переданы/);
});

test('invalid transcript entries do not shift original turn numbers', () => {
  const data = fixture();
  data.dialog.transcript[0] = null;
  const html = buildReport(data);
  assert.match(html, /Реплика 2 · 00:02/);
  assert.match(html, /Реплика 3/);
  assert.match(html, /Сәлеметсіз бе! Мен оқу операторы/);
  assert.doesNotMatch(html, /Реплика 1 · Клиент/);
});
