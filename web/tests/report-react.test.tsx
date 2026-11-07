import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportView, reportText } from '../react/report';
import { setLocale } from '../react/i18n';
import type { Appeal, Checklist, DialogRecord, Evaluation } from '../react/types';

function fixture() {
  const checklist: Checklist = { id: 'report-cl', version: 1, name: 'Fictional checklist', sections: [{ id: 's1', name: 'Fictional section' }], criteria: [{ id: 'c01', title: 'Fictional contact', description: 'Fictional original rule.', answer_type: 'binary', weight: 10 }] };
  const dialog: DialogRecord = { conversation_id: 'fictional-report', title: 'Fictional conversation', channel: 'agent chat', language: 'RU', transcript: [{ speaker: 'bot', timestamp: '00:00', text: 'Fictional bot context.' }, { speaker: 'operator', timestamp: '00:02', text: 'Fictional operator reply.' }, { speaker: 'client', timestamp: '00:03', text: 'Fictional thanks.' }] };
  const evaluation: Evaluation = { id: 'report-evaluation', conversation_id: dialog.conversation_id, checklist_id: checklist.id, checklist_version: 1, checklist, model: 'qa-evaluation-alpha', total: 100, original_total: 90, gross_error: false, criteria: [{ criterion_id: 'c01', answer: 'yes', original_answer: 'no', explanation: 'Fictional explanation.', points: 100, effective_weight: 100, evidence: [{ turn: 1, quote: 'Fictional operator reply.' }] }] };
  const appeals: Appeal[] = [{ id: 'a', evaluation_id: evaluation.id, criterion_id: 'c01', comment: 'Fictional appeal.', status: 'changed', decision: { answer: 'yes', reason: 'Fictional review decision.' } }, { id: 'b', evaluation_id: 'another-evaluation', criterion_id: 'c01', comment: 'Other evaluation must remain absent.', status: 'open' }];
  return { dialog, evaluation, checklist, appeals, demo: false, onBack: () => {} };
}
const render = (data = fixture()) => renderToStaticMarkup(<ReportView {...data}/>);

test('React report renders saved scores, original proof context and exact matching appeals', () => {
  const html = render();
  for (const text of ['quality-report', 'report-total', 'report-original', 'Fictional original rule.', 'Fictional bot context.', 'Fictional thanks.', 'Fictional review decision.', 'Реплика 2', 'Исходный ответ', 'Печать / PDF', 'freedom-logo-print.svg']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Other evaluation must remain absent|Учебный отчёт/);
});

test('React report guards historical version and keeps raw criterion ID instead of newer rules', () => {
  const data = fixture(); data.evaluation.checklist = { ...data.checklist, version: 2, criteria: [{ ...data.checklist.criteria[0], title: 'Wrong newer title.' }] };
  assert.ok(render(data).includes('Fictional contact'));
  data.checklist = { ...data.checklist, version: 3, criteria: [{ ...data.checklist.criteria[0], title: 'Wrong fallback title.' }] };
  const html = render(data); assert.doesNotMatch(html, /Wrong newer title|Wrong fallback title|Fictional original rule/); assert.match(html, /Снимок использованной версии чек-листа недоступен/);
});

test('React report distinguishes null, zero and missing answers without recalculating scores', () => {
  const data = fixture(); data.evaluation.total = null; data.evaluation.original_total = 0; data.evaluation.criteria[0].answer = undefined as any;
  const html = render(data); assert.match(html, /report-total">Не рассчитан/); assert.match(html, /report-original">0 <span>\/ 100/); assert.match(html, /Ответ не получен/); assert.doesNotMatch(html, /report-answer">N\/A/);
  data.evaluation.total = 17.25; data.evaluation.gross_error = true; data.evaluation.criteria[0].answer = 'na'; data.evaluation.criteria[0].na_reason = 'Fictional non-applicability.';
  const na = render(data); assert.match(na, /17,25/); assert.match(na, /Fictional non-applicability/); assert.match(na, /Отметка отдельно от итогового балла/);
});

test('report distinguishes absent original total before review from a null original after a real review', () => {
  const data = fixture();
  data.evaluation.original_total = null;
  data.evaluation.criteria[0].original_answer = data.evaluation.criteria[0].answer;
  data.appeals = data.appeals.map(appeal => ({ ...appeal, evaluation_id: 'unrelated-evaluation' }));
  const untouched = render(data);
  assert.match(untouched, /report-total">100 <span>\/ 100/);
  assert.match(untouched, /report-original">Пересмотр не проводился<\/p>/);
  assert.doesNotMatch(untouched, /report-original">Не рассчитан|report-original">100/);
  data.evaluation.original_total = undefined;
  assert.match(render(data), /report-original">Пересмотр не проводился<\/p>/);
  try {
    setLocale('en'); assert.match(render(data), /report-original">No review performed<\/p>/);
    setLocale('kk'); assert.match(render(data), /report-original">Қайта қарау жүргізілмеген<\/p>/);
  } finally { setLocale('ru'); }
  data.evaluation.original_total = null;
  data.evaluation.total = null;
  data.evaluation.criteria[0].answer = 'na';
  data.evaluation.criteria[0].original_answer = 'na';
  data.appeals = [{ ...fixture().appeals[0], evaluation_id: data.evaluation.id }];
  const reviewed = render(data);
  assert.match(reviewed, /report-original">Не рассчитан<\/p>/);
  assert.doesNotMatch(reviewed, /Пересмотр не проводился/);
  data.evaluation.original_total = 0;
  assert.match(render(data), /report-original">0 <span>\/ 100/);
});

test('React report marks partial scores while distinguishing missing answers from legitimate N/A', () => {
  const data = fixture();
  data.checklist.criteria.push({ ...data.checklist.criteria[0], id: 'c02', title: 'Fictional second criterion' });
  data.evaluation.total = 37.5;
  data.evaluation.criteria[0].answer = 'na';
  data.evaluation.criteria[0].na_reason = 'Fictional non-applicability.';
  data.evaluation.criteria.push({ criterion_id: 'c02', answer: null as any, explanation: 'Fictional unanswered criterion.' });
  const html = render(data);
  assert.match(html, /Оценка неполная: есть критерии без ответа/);
  assert.match(html, /Предварительный балл/);
  assert.match(html, /report-total">37,5 <span>\/ 100/);
  assert.match(html, /report-answer">N\/A/);
  assert.match(html, /report-answer">Ответ не получен/);
  try {
    setLocale('en'); assert.match(render(data), /Preliminary score/); assert.match(render(data), /The evaluation is incomplete/);
    setLocale('kk'); assert.match(render(data), /Алдын ала ұпай/); assert.match(render(data), /Бағалау толық емес/);
  } finally { setLocale('ru'); }
  data.evaluation.total = null;
  data.evaluation.criteria[1].answer = 'na';
  data.evaluation.criteria[1].na_reason = 'Fictional second non-applicability.';
  const allNa = render(data);
  assert.match(allNa, /report-total">Не рассчитан/);
  assert.doesNotMatch(allNa, /Оценка неполная|Предварительный балл|Ответ не получен/);
});

test('React report escapes source HTML and redacts secrets from every text field', () => {
  const data = fixture(); data.dialog.title = '<img src=x onerror=unsafe>'; data.dialog.channel = 'voice call';
  data.evaluation.criteria[0].explanation = 'https://example.invalid/path?sig=fake-private-value';
  data.evaluation.criteria[0].evidence![0].quote = 'API_KEY=fake-private-key-value';
  const html = render(data); assert.doesNotMatch(html, /<img src=x|onerror=unsafe>|fake-private-value|fake-private-key-value|sig=|<audio|<iframe/); assert.match(html, /&lt;img/); assert.match(html, /ссылка с данными доступа скрыта/); assert.match(html, /Запись доступна в карточке диалога/);
  assert.doesNotMatch(reportText('https://private.invalid/?X-Amz-Signature=fake-private-value'), /fake-private-value/);
});

test('React report validates integer proof indices without renumbering invalid transcript entries', () => {
  const data = fixture(); data.dialog.transcript![0] = null as any; data.evaluation.criteria[0].checked_range = { from: 0, to: 2 };
  const invalid = render(data); assert.match(invalid, /некорректная ссылка или диапазон/); assert.match(invalid, /Реплика 2/); assert.match(invalid, /Реплика 3/); assert.doesNotMatch(invalid, /Реплика 1 ·/);
  data.dialog.transcript![0] = { speaker: 'bot', text: 'Fictional original turn.' };
  assert.match(render(data), /Проверенный участок: реплики 1–3/);
  data.evaluation.criteria[0].evidence = [{ turn: '1' as any, quote: 'Invalid index.' }]; assert.match(render(data), /Ссылка на реплику недействительна/);
});

test('React report marks model provenance and localizes labels while preserving source language', () => {
  const data = fixture(); data.evaluation.provider = 'mock'; const mockReport=render(data);assert.match(mockReport, /Учебный отчёт/);assert.match(mockReport,/Оценки получены в тестовом режиме/);assert.doesNotMatch(mockReport,/Вымышленные данные и оценки/);
  try { setLocale('en'); assert.match(render(data), /Conversation quality report/); assert.doesNotMatch(render(data), /Отчёт о качестве диалога/); assert.match(render(data), /Fictional operator reply/); } finally { setLocale('ru'); }
  assert.doesNotThrow(() => render({ ...data, evaluation: null as any, checklist: null as any }));
});

test('report redacts quoted JSON credential values in rationale and full transcript', () => {
  const data=fixture();
  const secret='FAKE_SYNTHETIC_VALUE_WITH_SPACES';
  data.dialog.transcript!.push({speaker:'client',text:`{"token":"${secret}","api_key":"${secret}","password":"${secret} with spaces"}`});
  data.evaluation.criteria[0].explanation=`{'authorization':'${secret}', 'token': '${secret} with spaces'}`;
  const html=render(data);
  assert.doesNotMatch(html,new RegExp(secret));
  assert.match(html,/данные доступа скрыты/);
  for(const wrapped of [`metadata="token=${secret}"`,`{"payload":{"token":"${secret}"}}`,`{"ANTHROPIC_API_KEY":"${secret}"}`])assert.ok(!reportText(wrapped).includes(secret));
  assert.equal(reportText('metadata="normal context"'),'metadata="normal context"');
});

test('print-only full transcript includes non-evidence turns with original indices and safe text', () => {
  const data = fixture();
  data.dialog.transcript!.push(
    { speaker:'system', timestamp:'00:04', text:'Fictional system event outside evidence.' },
    { speaker:'client', timestamp:'00:05', text:'Fictional client message outside evidence.' },
    { speaker:'bot', timestamp:'00:06', text:'Fictional bot message outside evidence.' },
    { speaker:'https://private.invalid/?sig=fake-role', timestamp:'https://private.invalid/?sig=fake-time', text:'Fictional final non-evidence message: https://private.invalid/?sig=fake-text' },
  );
  const html = render(data);
  const print = html.match(/<section class="report-section report-full-transcript-print"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert.ok(print, 'a dedicated print section must exist without opening screen details');
  for (const text of ['Fictional system event outside evidence.', 'Fictional client message outside evidence.', 'Fictional bot message outside evidence.', 'Fictional final non-evidence message:', 'Реплика 7', 'Система', 'Клиент', 'Бот']) assert.ok(print.includes(text), text);
  assert.doesNotMatch(print, /fake-role|fake-time|fake-text|private\.invalid|sig=/);
  assert.match(html, /<details class="report-section report-full-transcript-screen"><summary>/);
  assert.doesNotMatch(html, /report-full-transcript-screen" open/);
  try { setLocale('en'); assert.match(render(data), /Full transcript/); setLocale('kk'); assert.match(render(data), /Толық транскрипт/); } finally { setLocale('ru'); }
});
