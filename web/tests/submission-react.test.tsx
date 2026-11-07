import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { SubmissionWorkspace, prepareSubmissionInput, readSubmissionJson, localizeSubmissionFeedback } from '../react/submission';
import { setLocale } from '../react/i18n';
import type { Api } from '../react/types';

const jsonFile = (name: string, value: unknown, raw = false) => {
  const bytes = new TextEncoder().encode(raw ? String(value) : JSON.stringify(value));
  return { name, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer };
};
const fixture = (dataset: 'prod' | 'dev' = 'prod') => {
  const records = Array.from({ length: dataset === 'prod' ? 10 : 65 }, (_, index) => ({ conversation_id: `${dataset}-react-${index + 1}`, channel: dataset === 'dev' && index >= 60 ? 'voice call' : 'agent chat', transcript: [{ speaker: 'bot', text: 'Fictional bot.' }, { speaker: 'client', text: 'Fictional question.' }, { speaker: 'operator', text: 'Fictional reply.' }] }));
  const evaluations = records.map(record => ({ conversation_id: record.conversation_id, provider: 'anthropic', model: 'qa-evaluation-alpha', criteria: ['yes', 'yes', 'yes', 20, 'yes', 10, 'yes', 'no'].map((answer, index) => ({ criterion_id: `c${String(index + 1).padStart(2, '0')}`, answer, explanation: 'Fictional rationale.', evidence: [{ turn: 2, quote: 'Fictional reply.' }] })) }));
  return { records, evaluations, dataset: { dataset_group_id: dataset.toUpperCase(), total_records: records.length, records } };
};
const baseFields = { dataset: 'prod' as const, teamName: 'seeusoon', mode: '' as const, modelName: '', source: 'original' as const, input: 'files' as const };
const inertApi = { demo: true } as Api;
const prepare = (data = fixture()) => prepareSubmissionInput({ fields: baseFields, datasetFile: jsonFile('source.json', data.dataset), evaluationFiles: [jsonFile('evaluations.json', { evaluations: data.evaluations })], api: inertApi });

test('React export reads UTF-8/BOM and never echoes malformed JSON or credentials', async () => {
  assert.deepEqual(await readSubmissionJson(jsonFile('bom.json', '\uFEFF{"value":1}', true)), { value: 1 });
  await assert.rejects(() => readSubmissionJson(null), /20 МБ/);
  await assert.rejects(() => readSubmissionJson(jsonFile('bad.json', '{"private":"https://example.invalid/?sig=fake-secret"', true)), error => error instanceof Error && !error.message.includes('fake-secret') && /UTF-8/.test(error.message));
  await assert.rejects(() => readSubmissionJson({ name: 'bad-utf8.json', size: 3, arrayBuffer: async () => new Uint8Array([0xff, 0xff, 0xff]).buffer }), /UTF-8/);
});

test('actual React preparation path exports canonical PROD and complete DEV without invoking API', async () => {
  const data = fixture(), output = await prepare(data);
  assert.deepEqual(output.errors, []); assert.ok(output.document);
  assert.equal(output.document.results.length, 10); assert.equal(output.document.team_name, 'seeusoon');
  assert.deepEqual(output.document.model, { mode: 'external_api', name: 'qa-evaluation-alpha' });
  const first = output.document.results[0] as any;
  assert.equal(first.criteria[0].criterion_id, 'contact'); assert.equal(first.criteria[0].value, true);
  assert.deepEqual(first.criteria[0].evidence_turns, [3]); assert.deepEqual(first.score, { final_score: 100, critical_flag: false });
  assert.ok(!JSON.stringify(output.document).includes('quote'));
  const dev = fixture('dev');
  const devOutput = await prepareSubmissionInput({ fields: { ...baseFields, dataset: 'dev' }, datasetFile: jsonFile('source.json', dev.dataset), evaluationFiles: [jsonFile('evaluations.json', dev.evaluations)], api: inertApi });
  assert.deepEqual(devOutput.errors, []); assert.equal(devOutput.document?.results.length, 65);
});

test('missing IDs, explicit errors and mock failures remain distinct in the React preparation path', async () => {
  const missing = fixture(); missing.evaluations.pop();
  const absent = await prepare(missing); assert.equal(absent.document, null); assert.ok(absent.errors.length > 0);
  const failed = fixture();
  (failed.evaluations as any[])[0] = { conversation_id: failed.records[0].conversation_id, provider:'anthropic', model:'qa-evaluation-alpha', error: 'Fictional processing failure.' };
  const errorOutput = await prepare(failed); assert.deepEqual(errorOutput.errors, []); assert.equal(errorOutput.document?.results.length, 10);
  assert.deepEqual(errorOutput.document?.results[0].criteria, []); assert.equal(errorOutput.document?.results[0].score, null); assert.equal(errorOutput.document?.results[0].status, 'error');
  Object.assign(failed.evaluations[0], { demo: true, provider: 'mock', model: 'mock' });
  assert.equal((await prepare(failed)).document, null);
});

test('server collection reads saved results and keeps one failed read among ten IDs', async () => {
  const data = fixture(), reads: string[] = [];
  const api = { demo: false, listDialogs: async () => { reads.push('list'); return data.records.map(record => ({ ...record, evaluation_id: record.conversation_id, status: 'completed' })); }, getDialog: async () => { assert.fail('unneeded detail request'); }, getEvaluation: async (id: string) => { reads.push(id); if (id === data.records[2].conversation_id) throw Error('https://private.invalid/?sig=fake-secret'); return data.evaluations.find(evaluation => evaluation.conversation_id === id); } } as unknown as Api;
  const result = await prepareSubmissionInput({ fields: { ...baseFields, input: 'server' }, datasetFile: jsonFile('source.json', data.dataset), evaluationFiles: [], api });
  assert.deepEqual(result.errors, []); assert.equal(reads.length, 11); assert.equal(result.document?.results.length, 10);
  assert.equal(result.document?.results[2].status, 'error'); assert.equal(result.document?.results[2].score, null);
  assert.ok(!JSON.stringify(result).includes('fake-secret'));
});

test('export diagnostics translate static validation details and numeric result positions', () => {
  try {
    setLocale('en'); assert.equal(localizeSubmissionFeedback('Результат 1, contact: нет ссылок на реплики.'), 'Result 1, contact: no message references.');
    setLocale('kk'); assert.ok(localizeSubmissionFeedback('Результат 2: mock/demo-оценка запрещена для сдачи.').includes('тапсыруға болмайды'));
  } finally { setLocale('ru'); }
});

test('SSR export markup has real forms and blocks demo server without injecting supplied team text', () => {
  const html = renderToStaticMarkup(<SubmissionWorkspace api={inertApi} demo={false} teamName={'Team <img src=x>'} notify={() => {}} active/>);
  assert.match(html, /submission-form/); assert.match(html, /submission-dataset-file/); assert.match(html, /Team &lt;img/); assert.doesNotMatch(html, /<img/);
  assert.match(html, /учебный API/); assert.match(html, /disabled/);
  assert.equal(renderToStaticMarkup(<SubmissionWorkspace api={inertApi} demo teamName="seeusoon" notify={() => {}} active={false}/>), '');
});

test('controlled export retains prepared output across navigation and rechecks one-click text edits', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="test-root"></div></body></html>', { url: 'http://localhost/#submission' });
  const globals = ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : key === 'window' ? dom.window : (dom.window as any)[key] });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('test-root')!);
  const render = (active: boolean) => <SubmissionWorkspace api={inertApi} demo teamName="seeusoon" notify={() => {}} active={active}/>;
  const select = async (name: string, value: string) => { await act(async () => { const input = dom.window.document.querySelector<HTMLSelectElement>(`select[name=${name}]`)!; input.value = value; input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); };
  const upload = async (id: string, file: unknown) => { await act(async () => { const input = dom.window.document.getElementById(id)!; Object.defineProperty(input, 'files', { configurable: true, value: [file] }); input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); };
  const submit = async () => { await act(async () => { dom.window.document.getElementById('submission-form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 15)); }); };
  try {
    await act(async () => root.render(render(true)));
    await select('dataset', 'prod'); const data = fixture();
    await upload('submission-dataset-file', jsonFile('source.json', data.dataset)); await upload('submission-evaluation-files', jsonFile('evaluations.json', data.evaluations));
    await submit(); assert.ok(dom.window.document.querySelector('[data-submission-action=download]'));
    await act(async () => root.render(render(false))); assert.equal(dom.window.document.querySelector('#submission-page'), null);
    await act(async () => root.render(render(true))); assert.ok(dom.window.document.querySelector('[data-submission-action=download]')); assert.ok(dom.window.document.body.textContent?.includes('source.json'));
    await act(async () => { const input = dom.window.document.querySelector<HTMLInputElement>('input[name=teamName]')!; Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'seeusoon revised'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    assert.equal(dom.window.document.querySelector('[data-submission-action=download]'), null);
    await submit(); assert.ok(dom.window.document.querySelector('[data-submission-action=download]')); assert.ok(dom.window.document.querySelector('#submission-result')?.textContent?.includes('seeusoon revised'));
    const failed = fixture(); (failed.evaluations as any[])[0] = { conversation_id:failed.records[0].conversation_id, provider:'anthropic', model:'qa-evaluation-alpha', error:'Fictional failure.' };
    await upload('submission-evaluation-files', jsonFile('errors.json', failed.evaluations)); await submit();
    assert.equal(dom.window.document.querySelector<HTMLButtonElement>('[data-submission-action=download]')?.disabled, true);
    await act(async () => dom.window.document.querySelector<HTMLInputElement>('#submission-acknowledge')!.click());
    assert.equal(dom.window.document.querySelector<HTMLButtonElement>('[data-submission-action=download]')?.disabled, false);
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const rows = data.records.map(record => ({ ...record, status:'completed', evaluation_id:record.conversation_id }));
    const savedApi = { demo:false, listDialogs:async()=>rows, getDialog:async()=>assert.fail('no detail needed'), getEvaluation:async(id:string)=>data.evaluations.find(item=>item.conversation_id===id) } as unknown as Api;
    const delayedApi = { ...savedApi, listDialogs:async()=>{await gate;return rows;} };
    await act(async () => root.render(<SubmissionWorkspace api={delayedApi} demo={false} teamName="seeusoon" notify={() => {}} active/>));
    await select('input', 'server'); await submit();
    assert.equal(dom.window.document.querySelector('fieldset')?.disabled, true);
    await act(async () => root.render(<SubmissionWorkspace api={savedApi} demo={false} teamName="seeusoon" notify={() => {}} active/>));
    await act(async () => { release(); await new Promise(resolve => setTimeout(resolve,15)); });
    assert.equal(dom.window.document.querySelector('[data-submission-action=download]'), null, 'old API results must not become downloadable');
    await submit(); assert.ok(dom.window.document.querySelector('[data-submission-action=download]'), 'a new check against the new connection must still work');
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const key of globals) { const descriptor = descriptors.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
  }
});
