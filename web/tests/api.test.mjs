import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../api.mjs';
import { createDemoApi } from '../demo.mjs';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

async function finish(api, job) {
  for (let i = 0; i < 5; i++) {
    const state = await api.getJob(job.id);
    if (state.status === 'completed') return state;
  }
  assert.fail('The demo job did not complete');
}

test('real adapter stores a checklist and reads the stored object through the contract', async t => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  const saved = [];
  let received;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/checklists');
    if (options.method === 'POST') {
      received = JSON.parse(options.body);
      const row = { ...received, id: 'from-server', version: 1 };
      saved.push(row);
      return Response.json(row);
    }
    return Response.json({ data: { checklists: saved } });
  };
  const api = createApi();
  const draft = { name: 'Проверка «диалога» & <пример>', criteria: [{ id: 'c1', title: 'Ясность' }] };
  const result = await api.saveChecklist(draft);
  assert.deepEqual(received, draft);
  assert.equal(result.id, 'from-server');
  assert.deepEqual(await api.listChecklists(), [result]);
});

test('real adapter preserves appeal writes and sends JSON decisions', async t => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  const appeals = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/decision')) {
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      Object.assign(appeals[0], { status: body.status, decision: body });
      return Response.json(appeals[0]);
    }
    assert.equal(url, 'http://localhost:8000/api/appeals');
    if (options.method === 'POST') appeals.push({ id: 'a1', ...JSON.parse(options.body), status: 'open' });
    return Response.json(options.method === 'POST' ? appeals.at(-1) : appeals);
  };
  const api = createApi({ baseUrl: 'http://localhost:8000/api/' });
  await api.createAppeal({ evaluation_id: 'e1', criterion_id: 'c01', comment: 'Учтите приветствие.' });
  assert.equal((await api.listAppeals())[0].comment, 'Учтите приветствие.');
  await api.decideAppeal('a1', { answer: 'yes', reason: 'Подтверждено репликой.', status: 'changed' });
  assert.equal((await api.listAppeals())[0].decision.answer, 'yes');
});

test('real adapter encodes record IDs and upload is multipart', async t => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ id: 'ok' });
  };
  const api = createApi();
  await api.getDialog('чат/1?name=тест');
  assert.equal(calls[0].url, '/api/dialogs/' + encodeURIComponent('чат/1?name=тест'));
  await api.uploadDialog(new Blob(['{}'], { type: 'application/json' }));
  assert.ok(calls[1].options.body instanceof FormData);
  assert.ok(calls[1].options.body.get('file') instanceof Blob);
  assert.equal(calls[1].options.headers['Content-Type'], undefined);
});

test('real API errors never switch to demo or disclose signed URLs', async t => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  globalThis.fetch = async () => Response.json({ detail: 'Ошибка GET https://example.invalid/run?sig=secret token=another' }, { status: 400 });
  const api = createApi();
  assert.equal(api.demo, false);
  await assert.rejects(api.listDialogs(), e => e instanceof ApiError && !e.message.includes('secret') && !e.message.includes('another') && !e.message.includes('https://'));
  globalThis.fetch = async () => Response.json({ detail: 'Ошибка {"sig": "quoted-secret"}' }, { status: 400 });
  await assert.rejects(api.listDialogs(), e => !e.message.includes('quoted-secret'));
  globalThis.fetch = async () => { throw new TypeError('Fetch failed at https://example.invalid/?sig=secret'); };
  await assert.rejects(api.listDialogs(), /Нет соединения/);
  assert.throws(() => createApi({ baseUrl: 'https://api.example.invalid?sig=secret' }), /подписи/);
});

test('real API distinguishes HTML, malformed lists and timeout', async t => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  globalThis.fetch = async () => new Response('<html>Not an API</html>');
  await assert.rejects(createApi().listDialogs(), /не JSON/);
  globalThis.fetch = async () => Response.json({ unexpected: true });
  await assert.rejects(createApi().listDialogs(), /формат списка/);
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  await assert.rejects(createApi({ timeout: 5 }).listDialogs(), /не ответил вовремя/);
});

test('demo has six fictional records in all three languages with visible demo metadata', async () => {
  const api = createDemoApi({ storage: storage() });
  const dialogs = await api.listDialogs();
  assert.equal(dialogs.length, 6);
  assert.deepEqual([...new Set(dialogs.map(x => x.language))].sort(), ['EN', 'KZ', 'RU']);
  assert.ok(dialogs.some(x => x.channel === 'voice call'));
  assert.ok(dialogs.every(x => x.demo && x.conversation_id.startsWith('demo-')));
  assert.ok(dialogs.every(x => x.transcript.some(t => /вымыш|ойдан|fictional/.test(t.text))));
  const evaluation = await api.getEvaluation(dialogs[0].evaluation_id);
  assert.equal(evaluation.model, 'Учебный пример (без ИИ)');
  assert.equal(evaluation.cost_usd, 0);
  assert.equal(evaluation.original_total, evaluation.total);
});

test('demo preserves reviews and original scores through a new API instance', async () => {
  const saved = storage();
  let api = createDemoApi({ storage: saved });
  const dialog = (await api.listDialogs()).find(d => d.gross_error);
  const before = await api.getEvaluation(dialog.evaluation_id);
  const criterion = before.criteria.find(c => c.criterion_id === 'c07');
  assert.equal(criterion.answer, 'no');
  const appeal = await api.createAppeal({ evaluation_id: before.id, criterion_id: 'c07', comment: 'Проверить завершение «ещё раз» & <пример>.' });
  await assert.rejects(api.createAppeal({ evaluation_id: before.id, criterion_id: 'c07', comment: 'Повтор.' }), /уже есть/);
  const decision = await api.decideAppeal(appeal.id, { answer: 'yes', reason: 'Учебный пересмотр.', status: 'changed' });
  assert.equal(decision.status, 'changed');
  api = createDemoApi({ storage: saved });
  const after = await api.getEvaluation(before.id);
  assert.equal(after.original_total, before.total);
  assert.ok(after.total > before.total);
  assert.equal(after.criteria.find(c => c.criterion_id === 'c07').original_answer, 'no');
  assert.equal(after.gross_error, true, 'Gross-error flag is separate from weighted total');
  assert.equal((await api.listAppeals())[0].decision.reason, 'Учебный пересмотр.');
  await assert.rejects(api.decideAppeal(appeal.id, { answer: 'no', reason: 'Повтор.' }), /уже принято/);
});

test('demo checklist version is applied to a new job, previous evaluation retains snapshot', async () => {
  const saved = storage();
  let api = createDemoApi({ storage: saved });
  const dialog = (await api.listDialogs())[0];
  const original = await api.getEvaluation(dialog.evaluation_id);
  const checklist = (await api.listChecklists())[0];
  checklist.name = 'Новый критерий «точности»';
  checklist.criteria = [{ id: 'custom', section_id: 's1', title: 'Новый критерий', description: 'Учебное правило.', answer_type: 'scale', scale: { min: 0, max: 4, steps: [{ value: 0, label: 'Нет' }, { value: 4, label: 'Да' }] }, weight: 100, na_allowed: false, na_rule: null, gross_error: false }];
  const next = await api.saveChecklist(checklist);
  assert.equal(next.version, 2);
  const job = await api.evaluate([dialog.conversation_id], next.id);
  assert.equal(job.status, 'queued');
  const pending = await api.getJob(job.id);
  assert.equal(pending.status, 'running');
  assert.equal(pending.progress, 50);
  const done = await finish(api, pending);
  const updated = await api.getEvaluation(done.evaluation_ids[0]);
  assert.equal(updated.checklist_version, 2);
  assert.deepEqual(updated.criteria.map(c => c.criterion_id), ['custom']);
  assert.equal(updated.total, 100);
  assert.equal(updated.criteria[0].points, 100);
  assert.equal(updated.criteria[0].needs_review, true, 'Demo does not claim to evaluate arbitrary new criteria with AI');
  api = createDemoApi({ storage: saved });
  assert.equal((await api.getEvaluation(original.id)).checklist.version, 1);
  assert.equal((await api.getDialog(dialog.conversation_id)).evaluation_id, updated.id);
});

test('demo N/A excludes weights; all N/A yields null instead of a fabricated score', async () => {
  const api = createDemoApi({ storage: storage() });
  const dialog = (await api.listDialogs())[0];
  const result = await api.getEvaluation(dialog.evaluation_id);
  assert.equal(result.total, 85.38);
  assert.equal(result.criteria.find(c => c.criterion_id === 'c03').effective_weight, 0);
  assert.ok(Math.abs(result.criteria.reduce((s, c) => s + (c.points || 0), 0) - result.total) < 0.01);
  const checklist = (await api.listChecklists())[0];
  checklist.criteria = checklist.criteria.filter(c => c.id === 'c03');
  const saved = await api.saveChecklist(checklist);
  const done = await finish(api, await api.evaluate([dialog.conversation_id], saved.id));
  assert.equal((await api.getEvaluation(done.evaluation_ids[0])).total, null);
});

test('demo validates empty input, new upload, duplicate upload and quote characters', async () => {
  const saved = storage();
  const api = createDemoApi({ storage: saved });
  await assert.rejects(api.importDialogs(''), /group_id/);
  await assert.rejects(api.evaluate([], 'freedom-chat'), /Выберите/);
  await assert.rejects(api.uploadDialog({ size: 0, text: async () => '' }), /JSON/);
  const record = { conversation_id: 'учебный/пример & 1', channel: 'agent chat', language: 'RU', transcript: [{ timestamp: '00:00', speaker: 'operator', text: 'Учебная строка <script>alert(1)</script> & «кавычки»' }] };
  const file = { size: 1000, text: async () => JSON.stringify(record) };
  await api.uploadDialog(file);
  const fresh = createDemoApi({ storage: saved });
  assert.equal((await fresh.getDialog(record.conversation_id)).transcript[0].text, record.transcript[0].text);
  await assert.rejects(api.uploadDialog(file), /уже загружен/);
});

test('health feeds the evaluation estimate; demo reports a free run without price history', async t => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  const calls = [];
  globalThis.fetch = async url => { calls.push(url); return Response.json({ ok: true, provider: 'mock', model: 'mock', estimate: { based_on: 0, cost_per_dialog_usd: null, seconds_per_dialog: null, workers: 5 } }); };
  assert.equal((await createApi().getHealth()).provider, 'mock');
  assert.deepEqual(calls, ['/api/health']);
  const demo = await createDemoApi({ storage: storage() }).getHealth();
  assert.equal(demo.provider, 'demo');
  assert.equal(demo.estimate.cost_per_dialog_usd, null);
});

test('demo rows and appeals carry call length, display time, version and the disputed fragment', async () => {
  const api = createDemoApi({ storage: storage() });
  const rows = await api.listDialogs();
  const voice = rows.find(d => d.channel === 'voice call');
  assert.equal(voice.duration_seconds, 20);
  assert.equal(voice.transcript[1].display_time, '00:02');
  assert.ok(rows.filter(d => d.evaluation_id).every(d => d.checklist_id === 'freedom-chat' && d.checklist_version === 1));
  assert.match(rows.find(d => d.gross_error).gross_error_reason, /вне компании/);
  const evaluation = await api.getEvaluation(rows[0].evaluation_id);
  assert.match(evaluation.criteria.find(c => c.criterion_id === 'c01').explanation, /Основание — реплика \[5\]\./);
  await api.createAppeal({ evaluation_id: evaluation.id, criterion_id: 'c04', comment: 'Проверить.' });
  const [appeal] = await api.listAppeals();
  assert.equal(appeal.criterion.criterion_id, 'c04');
  assert.equal(appeal.total, evaluation.total);
  assert.ok(appeal.fragment.some(turn => turn.turn === appeal.criterion.evidence[0].turn));
  assert.equal((await api.listDialogs())[0].open_appeals, 1);
});

test('demo audio is a generated local signal with turn offsets, not a customer recording', async () => {
  const api = createDemoApi({ storage: storage() });
  const voice = (await api.listDialogs()).find(d => d.channel === 'voice call');
  const audio = await api.getAudio(voice.conversation_id);
  assert.ok(audio.url.startsWith('data:audio/wav;base64,UklGR'));
  assert.equal(audio.turn_offsets[4], 8);
  assert.match(audio.label, /не запись/);
  const bytes = Uint8Array.from(atob(audio.url.split(',')[1]), c => c.charCodeAt(0));
  assert.equal(new DataView(bytes.buffer).getUint32(24, true), 8000);
  await assert.rejects(api.getAudio('demo-ru-001'), /нет записи/);
});
