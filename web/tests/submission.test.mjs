import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubmission, validateSubmission } from '../submission.mjs';

const IDS = ['contact', 'discovery', 'identification', 'consultation', 'empathy', 'dialogue', 'closure', 'critical'];
const ALIASES = IDS.map((_, i) => `c${String(i + 1).padStart(2, '0')}`);
const VALUES = ['yes', 'yes', 'yes', 20, 'yes', 10, 'yes', 'no'];
const MODEL = 'actual-model-alpha-2026';
const clone = value => structuredClone(value);

function fixture(dataset = 'prod') {
  const expectedDialogs = Array.from({ length: dataset === 'dev' ? 65 : 10 }, (_, i) => ({
    conversation_id: `${dataset}-source-${String(i + 1).padStart(3, '0')}`,
    channel: dataset === 'dev' && i >= 60 ? 'voice call' : 'agent chat',
    transcript: [
      { speaker: 'bot', timestamp: '00:00', text: 'Вымышленная реплика бота.' },
      { speaker: 'system', timestamp: '00:01', text: 'Вымышленное событие.' },
      { speaker: 'client', timestamp: '00:02', text: 'Вымышленный вопрос.' },
      { speaker: 'operator', timestamp: '00:03', text: 'Вымышленный ответ оператора.' },
      { speaker: 'system', timestamp: '00:04', text: 'Вымышленное завершение.' },
    ],
  }));
  return {
    dataset, teamName: 'Команда «Проверка»', model: { mode: 'external_api', name: MODEL }, expectedDialogs,
    entries: expectedDialogs.map(dialog => ({ dialog: clone(dialog), evaluation: {
      conversation_id: dialog.conversation_id, provider: 'provider', model: MODEL,
      calls: [{ model: MODEL }],
      criteria: ALIASES.map((criterion_id, i) => ({ criterion_id, answer: VALUES[i], explanation: 'Краткое обоснование учебной фикстуры теста.', evidence: [{ turn: 3, quote: 'Этот текст не должен попадать в JSON.' }], checked_range: null, needs_review: false })),
    } })),
  };
}

function snapshot() {
  return { criteria: ALIASES.map((id, i) => ({
    id, answer_type: [3, 5].includes(i) ? 'scale' : 'binary', weight: [10, 15, 20, 20, 15, 15, 5, 0][i],
    na_allowed: [1, 2, 3, 6].includes(i), gross_error: i === 7,
    scale: [3, 5].includes(i) ? { min: 0, max: i === 3 ? 20 : 10, steps: (i === 3 ? [0, 5, 10, 15, 20] : [0, 4, 7, 10]).map(value => ({ value, label: 'Ступень' })) } : null,
  })) };
}

function document() {
  const input = fixture();
  const built = buildSubmission(input);
  assert.deepEqual(built.errors, []);
  return { input, doc: built.document };
}

test('missing or empty input returns validation errors rather than an export or exception', () => {
  for (const input of [undefined, null, {}, []]) {
    const built = buildSubmission(input);
    assert.equal(built.document, null);
    assert.ok(built.errors.length > 0);
  }
  assert.equal(validateSubmission(null).valid, false);
});

test('canonical JSON has only required fields and original authoritative IDs', () => {
  const { input, doc } = document();
  assert.deepEqual(Object.keys(doc), ['schema_version', 'team_name', 'model', 'results']);
  assert.equal(doc.schema_version, '1.0');
  assert.deepEqual(doc.results.map(r => r.conversation_id), input.expectedDialogs.map(d => d.conversation_id));
  assert.deepEqual(doc.results[0].criteria.map(c => c.criterion_id), IDS);
  assert.deepEqual(Object.keys(doc.results[0]), ['conversation_id', 'status', 'criteria', 'score']);
  assert.deepEqual(Object.keys(doc.results[0].criteria[0]), ['criterion_id', 'value', 'rationale', 'evidence_turns']);
  assert.deepEqual(doc.results[0].score, { final_score: 100, critical_flag: false });
  assert.equal(doc.results[0].criteria[0].value, true);
  assert.equal(doc.results[0].criteria[7].value, false);
  assert.ok(!JSON.stringify(doc).includes('quote'));
  assert.ok(!JSON.stringify(doc).includes('transcript'));
  assert.ok(!JSON.stringify(doc).includes('audio_url'));
  assert.equal(validateSubmission(doc, input).valid, true);
});

test('DEV accepts exactly 60 chats plus five calls; PROD exactly ten chats', () => {
  assert.deepEqual(buildSubmission(fixture('dev')).errors, []);
  const wrongDev = fixture('dev'); wrongDev.expectedDialogs[64].channel = 'agent chat';
  assert.ok(buildSubmission(wrongDev).errors.some(e => e.includes('60 чатов')));
  const wrongProd = fixture(); wrongProd.expectedDialogs[0].channel = 'voice call';
  assert.ok(buildSubmission(wrongProd).errors.some(e => e.includes('10 чатов')));
  const wrongCount = fixture('dev'); wrongCount.expectedDialogs.pop(); wrongCount.entries.pop();
  assert.equal(buildSubmission(wrongCount).document, null);
});

test('canonical source criterion IDs work alongside raw internal answers', () => {
  const input = fixture();
  input.entries[0].evaluation.criteria.forEach((c, i) => { c.criterion_id = IDS[i]; });
  assert.deepEqual(buildSubmission(input).errors, []);
});

test('dialogue value seven contributes 10.5 weighted points, not seven', () => {
  const input = fixture(); input.entries[0].evaluation.criteria[5].answer = 7;
  const result = buildSubmission(input);
  assert.deepEqual(result.errors, []);
  assert.equal(result.document.results[0].score.final_score, 95.5);
  assert.equal(result.document.results[0].criteria[5].value, 7);
});

test('N/A redistributes weights and exact half-up rounds 75.625 to 75.63', () => {
  const input = fixture();
  const criteria = input.entries[0].evaluation.criteria;
  criteria[2].answer = 'na'; criteria[2].na_reason = 'Общий вопрос без защищённого действия.';
  criteria[3].answer = 10; criteria[5].answer = 7; criteria[6].answer = 'no';
  const built = buildSubmission(input);
  assert.deepEqual(built.errors, []);
  assert.equal(built.document.results[0].score.final_score, 75.63);
  assert.equal(built.document.results[0].criteria[2].value, null);
  assert.match(built.document.results[0].criteria[2].rationale, /N\/A:/);
});

test('zero stays zero, null stays N/A, and gross error does not zero the score', () => {
  const input = fixture(); const first = input.entries[0].evaluation;
  first.criteria[3].answer = 0; first.criteria[2].answer = null; first.criteria[7].answer = 'yes';
  const built = buildSubmission(input);
  assert.deepEqual(built.errors, []);
  assert.equal(built.document.results[0].criteria[3].value, 0);
  assert.equal(built.document.results[0].criteria[2].value, null);
  assert.deepEqual(built.document.results[0].score, { final_score: 75, critical_flag: true });
});

test('all roles count in evidence indices; ranges are inclusive, deduplicated and sorted', () => {
  const input = fixture();
  input.entries[0].evaluation.criteria[0].evidence = [{ turn: 3 }, { turn: 0 }, { turn: 3 }];
  input.entries[0].evaluation.criteria[0].checked_range = { from: 1, to: 3 };
  input.entries[0].dialog.transcript = [{ speaker: 'operator', text: 'Truncated copy must not be authoritative.' }];
  const built = buildSubmission(input);
  assert.deepEqual(built.errors, []);
  assert.deepEqual(built.document.results[0].criteria[0].evidence_turns, [1, 2, 3, 4]);
});

test('invalid evidence and checked ranges block export instead of dropping bad refs', () => {
  for (const mutate of [
    item => { item.evidence = [{ turn: -1 }]; },
    item => { item.evidence = [{ turn: 5 }]; },
    item => { item.evidence = [{ turn: '3' }]; },
    item => { item.checked_range = { from: 4, to: 2 }; },
    item => { item.checked_range = { from: 0, to: 5 }; },
    item => { item.evidence = null; },
    item => { item.evidence_turns = [0]; },
  ]) {
    const input = fixture(); mutate(input.entries[0].evaluation.criteria[0]);
    assert.equal(buildSubmission(input).document, null);
  }
});

test('empty evidence is permitted with a warning', () => {
  const input = fixture(); input.entries[0].evaluation.criteria[0].evidence = [];
  const built = buildSubmission(input);
  assert.deepEqual(built.errors, []);
  assert.deepEqual(built.document.results[0].criteria[0].evidence_turns, []);
  assert.ok(built.warnings.some(w => w.includes('нет ссылок')));
});

test('duplicate, missing and foreign result IDs block export', () => {
  for (const mutate of [
    input => { input.entries[1] = clone(input.entries[0]); },
    input => { input.entries.pop(); },
    input => { input.entries[0].dialog.conversation_id = 'foreign'; },
    input => { input.expectedDialogs[1] = clone(input.expectedDialogs[0]); },
    input => { input.entries[0].evaluation.conversation_id = 'another-dialog'; },
  ]) { const input = fixture(); mutate(input); assert.equal(buildSubmission(input).document, null); }
});

test('missing/extra/duplicate/unknown criteria and unresolved model errors block export', () => {
  for (const mutate of [
    cs => cs.pop(),
    cs => cs.push(clone(cs[0])),
    cs => { cs[1].criterion_id = 'contact'; },
    cs => { cs[0].criterion_id = 'unknown'; },
    cs => { cs[0].needs_review = true; },
    cs => { cs[0].problems = ['bad quote']; },
    cs => { cs[0].explanation = ' '; },
  ]) { const input = fixture(); mutate(input.entries[0].evaluation.criteria); assert.equal(buildSubmission(input).document, null); }
});

test('source values are strict except the explicit yes/no/na conversion', () => {
  for (const [index, value] of [[0, null], [4, null], [7, null], [5, null], [0, 1], [0, 'true'], [3, '10'], [3, true], [3, 7], [5, 5], [5, NaN], [5, Infinity]]) {
    const input = fixture(); input.entries[0].evaluation.criteria[index].answer = value;
    assert.equal(buildSubmission(input).document, null, `index ${index} must reject ${String(value)}`);
  }
});

test('explicit evaluation errors preserve original IDs and have no invented criteria/score', () => {
  const input = fixture();
  input.entries[0] = { dialog: input.entries[0].dialog, error: 'Сервис оценки не ответил.' };
  const built = buildSubmission(input);
  assert.deepEqual(built.errors, []);
  assert.deepEqual(built.document.results[0], { conversation_id: input.expectedDialogs[0].conversation_id, status: 'error', criteria: [], score: null, error: 'Сервис оценки не ответил.' });
  delete input.entries[0].error;
  assert.equal(buildSubmission(input).document, null);
});

test('demo flags, mock providers and educational models block submission', () => {
  for (const mutate of [
    entry => { entry.dialog.demo = true; },
    entry => { entry.evaluation.demo = true; },
    entry => { entry.evaluation.provider = 'mock'; },
    entry => { entry.evaluation.provider = 'demo'; },
    entry => { entry.evaluation.model = 'Учебный пример без AI'; },
    entry => { entry.evaluation.calls[0].model = 'mock'; },
  ]) {
    for (const failed of [false,true]) {
      const input = fixture(); mutate(input.entries[0]);
      if (failed) input.entries[0].error = 'Ошибка обработки.';
      assert.equal(buildSubmission(input).document, null);
    }
  }
});

test('compatible snapshots pass; changed weights/types/scales/N/A/gross mapping fail', () => {
  const valid = fixture(); valid.entries[0].evaluation.checklist = snapshot();
  assert.deepEqual(buildSubmission(valid).errors, []);
  for (const mutate of [
    s => { s.criteria[0].weight = 11; },
    s => { s.criteria[0].weight = '10'; },
    s => { s.criteria[0].answer_type = 'scale'; },
    s => { s.criteria[1].na_allowed = false; },
    s => { s.criteria[7].gross_error = false; },
    s => { s.criteria[3].scale.steps[0].value = 1; },
    s => { s.criteria[5].scale.max = 15; },
    s => { s.criteria.pop(); },
  ]) {
    const input = fixture(); input.entries[0].evaluation.checklist = snapshot(); mutate(input.entries[0].evaluation.checklist);
    assert.equal(buildSubmission(input).document, null);
  }
});

test('metadata names every observed actual model including fallback calls', () => {
  const input = fixture(); input.entries[0].evaluation.calls.push({ model: 'actual-model-beta' });
  assert.equal(buildSubmission(input).document, null);
  input.model.name += ' + actual-model-beta';
  const built = buildSubmission(input);
  assert.deepEqual(built.errors, []);
  assert.equal(built.document.model.mode, 'external_api');
  assert.equal(built.document.model.name, input.model.name);
  input.model.mode = 'cloud';
  assert.equal(buildSubmission(input).document, null);
});

test('reviewed source defaults to original and requires original evidence snapshot', () => {
  const input = fixture(), e = input.entries[0].evaluation;
  e.original_total = 100; e.total = 90;
  e.criteria[0].original_answer = 'yes'; e.criteria[0].answer = 'no'; e.criteria[0].review_reason = 'Пересмотрено.';
  assert.equal(buildSubmission(input).document, null);
  e.original_criteria = clone(e.criteria);
  e.original_criteria[0].answer = 'yes'; e.original_criteria[0].evidence = [{ turn: 0 }];
  const original = buildSubmission(input);
  assert.deepEqual(original.errors, []);
  assert.equal(original.document.results[0].criteria[0].value, true);
  assert.deepEqual(original.document.results[0].criteria[0].evidence_turns, [1]);
  assert.equal(original.document.results[0].score.final_score, 100);
  const final = buildSubmission({ ...input, source: 'final' });
  assert.deepEqual(final.errors, []);
  assert.equal(final.document.results[0].criteria[0].value, false);
  assert.equal(final.document.results[0].score.final_score, 90);
  assert.ok(final.warnings.some(w => w.includes('пересмотренная')));
});

test('review markers alone require original_criteria; no reconstructed evidence', () => {
  for (const mark of [
    e => { e.criteria[0].original_answer = 'yes'; },
    e => { e.criteria[0].review_reason = 'Решение.'; },
    e => { e.criteria[0].revised_evidence = [{ turn: 0 }]; },
    e => { e.criteria[0].original_evidence = [{ turn: 0 }]; },
    e => { e.appeals = [{ decision: { answer: 'no' } }]; },
  ]) { const input = fixture(); mark(input.entries[0].evaluation); assert.equal(buildSubmission(input).document, null); }
});

test('saved total and saved gross flag must agree; no silent score rewriting', () => {
  for (const value of [99, null, '100', NaN, 100.001]) {
    const input = fixture(); input.entries[0].evaluation.total = value;
    assert.equal(buildSubmission(input).document, null);
  }
  const good = fixture(); good.entries[0].evaluation.total = 100;
  assert.deepEqual(buildSubmission(good).errors, []);
  good.entries[0].evaluation.gross_error = true;
  assert.equal(buildSubmission(good).document, null);
});

test('strict document validator rejects wrong native types, out-of-range turns and extra fields', () => {
  const { input, doc } = document();
  for (const mutate of [
    d => { d.schema_version = 1; },
    d => { d.results[0].criteria[0].value = 'yes'; },
    d => { d.results[0].criteria[5].value = true; },
    d => { d.results[0].score.final_score = '100'; },
    d => { d.results[0].score.final_score = 99.999; },
    d => { d.results[0].score.final_score = Infinity; },
    d => { d.results[0].score.critical_flag = 'false'; },
    d => { d.results[0].score.critical_flag = true; },
    d => { d.results[0].criteria[0].evidence_turns = [0]; },
    d => { d.results[0].criteria[0].evidence_turns = [6]; },
    d => { d.results[0].criteria[0].evidence_turns = [1, 1]; },
    d => { d.results[0].criteria[0].evidence_turns = [4, 1]; },
    d => { d.results[0].criteria[0].quote = 'not allowed'; },
    d => { d.audio_url = 'not allowed'; },
    d => { d.results[0].criteria[0].criterion_id = 'c01'; },
  ]) { const changed = clone(doc); mutate(changed); assert.equal(validateSubmission(changed, input).valid, false); }
});

test('error row is strict and missing evaluation cannot be disguised as zero', () => {
  const input = fixture(); input.entries[0] = { dialog: input.entries[0].dialog, error: 'Недоступен сервис.' };
  const built = buildSubmission(input);
  for (const mutate of [
    r => { r.score = 0; },
    r => { r.criteria = [{ criterion_id: 'contact' }]; },
    r => { delete r.error; },
    r => { r.error = ''; },
  ]) { const d = clone(built.document); mutate(d.results[0]); assert.equal(validateSubmission(d, input).valid, false); }
});

test('signed URLs are redacted while standalone API tokens block without leaking in messages', () => {
  const input = fixture();
  input.entries[0].evaluation.criteria[0].explanation = 'Сбой по адресу https://example.invalid/path?sig=SUPERSECRET&group_id=DEV';
  input.entries[1] = { dialog: input.entries[1].dialog, error: 'Ошибка https://example.invalid/path?token=ANOTHERSECRET' };
  const built = buildSubmission(input);
  assert.deepEqual(built.errors, []);
  assert.ok(!JSON.stringify(built).includes('SUPERSECRET'));
  assert.ok(!JSON.stringify(built).includes('ANOTHERSECRET'));
  assert.ok(built.warnings.some(w => w.includes('адрес скрыт')));
  input.entries[0].evaluation.criteria[0].explanation = 'Authorization: Bearer abcdefSECRET';
  const blocked = buildSubmission(input);
  assert.equal(blocked.document, null);
  assert.ok(!JSON.stringify(blocked).includes('abcdefSECRET'));
  const { input: validInput, doc } = document();
  doc.results[0].criteria[0].rationale = 'https://example.invalid/?sig=DOCUMENTSECRET';
  const validation = validateSubmission(doc, validInput);
  assert.equal(validation.valid, false);
  assert.ok(!JSON.stringify(validation).includes('DOCUMENTSECRET'));
});

test('possible personal contacts and identifiers require review without echoing their content', () => {
  for (const text of ['Контакт: person@example.invalid', 'Номер: +7 (700) 000-00-00', 'Условный идентификатор: 000000000000']) {
    const input = fixture(); input.entries[0].evaluation.criteria[0].explanation = text;
    const built = buildSubmission(input);
    assert.deepEqual(built.errors, []);
    assert.ok(built.warnings.some(warning => warning.includes('обезличьте')));
    assert.ok(!JSON.stringify(built.warnings).includes(text));
  }
  const input = fixture();input.entries[0] = { dialog:input.entries[0].dialog,error:'Контакт: person@example.invalid' };
  assert.ok(buildSubmission(input).warnings.some(warning => warning.includes('обезличьте')));
});

test('builder and validator do not mutate inputs', () => {
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const input = fixture(), before = clone(input);
  const built = buildSubmission(freeze(input));
  assert.deepEqual(built.errors, []);
  const outputBefore = clone(built.document);
  assert.equal(validateSubmission(freeze(built.document), input).valid, true);
  assert.deepEqual(input, before);
  assert.deepEqual(built.document, outputBefore);
});
