import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { AnalyticsWorkspace } from '../react/analytics';
import { setLocale, type Locale } from '../react/i18n';
import type { DialogRecord, Evaluation } from '../react/types';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const { createRoot } = await import('react-dom/client');
const rows: DialogRecord[] = [{ conversation_id: 'synthetic-Ә-<x>', evaluation_id: 'e', language: 'RU', channel: 'agent chat', status: 'evaluated' }];
function evaluation(): Evaluation {
  return { id: 'e', conversation_id: rows[0].conversation_id, checklist_id: 'c', checklist_version: 1, provider: 'mock', total: 0,
    checklist: { id: 'c', version: 1, name: 'Checklist Ә & <img>', sections: [], criteria: [{ id: 'a', title: 'Критерий Ә & <script>', description: '', answer_type: 'binary', weight: 100 }] },
    criteria: [{ criterion_id: 'a', answer: 'no', points: 0, effective_weight: 100, explanation: 'PRIVATE EXPLANATION', evidence: [{ turn: 0, quote: 'PRIVATE QUOTE' }] }] };
}
async function mount(element: React.ReactNode) {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(element));
  return { container, render: async (next: React.ReactNode) => { await act(async () => root.render(next)); },
    close: async () => { await act(async () => root.unmount()); container.remove(); } };
}
async function choose(element: Element | null, value: string) {
  assert.ok(element); await act(async () => { const select = element as HTMLSelectElement; select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
}

test('analytics renders RU EN KK with exact0, translated labels, safe text and mock provenance on real API', async () => {
  const api = { demo: false, getEvaluation: async () => evaluation() }; const opened: string[] = [];
  for (const [locale, title, caption, notice] of [
    ['ru', 'Аналитика', 'Потери по критериям', 'Учебные результаты'],
    ['en', 'Analytics', 'Losses by criterion', 'Demo results'],
    ['kk', 'Аналитика', 'Критерийлер бойынша ұпай жоғалту', 'Оқу нәтижелері'],
  ] as const) {
    setLocale(locale);
    const view = await mount(<AnalyticsWorkspace api={api} rows={rows} onOpenDialog={id => opened.push(id)}/>);
    assert.equal(view.container.querySelector('h1')!.textContent, title);
    assert.ok(view.container.textContent!.includes(caption)); assert.ok(view.container.textContent!.includes(notice));
    assert.match(view.container.querySelector('[data-analytics-criterion=a]')!.textContent!, /100% \(1\/1\)/);
    assert.equal(view.container.querySelectorAll('script,img').length, 0);
    assert.ok(!view.container.textContent!.includes('PRIVATE'));
    const scores = [...view.container.querySelectorAll('.stat-value')].map(node => node.textContent);
    assert.deepEqual(scores, ['1', '0', '0']);
    const button = view.container.querySelector('.analytics-dialogs button') as HTMLButtonElement;
    await act(async () => button.click());
    await choose(view.container.querySelectorAll('select')[1], 'EN');
    assert.equal(view.container.querySelector('tbody'), null);
    await view.close();
  }
  assert.deepEqual(opened, Array(3).fill(rows[0].conversation_id)); setLocale('ru');
});

test('empty and partial read failure states remain visible, refresh retries without evaluating', async () => {
  setLocale('en'); let calls = 0; let shouldFail = true;
  const api = { demo: false, getEvaluation: async () => { calls++; if (shouldFail) throw Error('PRIVATE FAILURE'); return evaluation(); } };
  const view = await mount(<AnalyticsWorkspace api={api} rows={rows} onOpenDialog={() => {}}/>);
  assert.match(view.container.textContent!, /No eligible saved evaluations/);
  assert.match(view.container.textContent!, /read failure — 1/); assert.ok(!view.container.textContent!.includes('PRIVATE FAILURE'));
  shouldFail = false;
  await act(async () => (view.container.querySelector('.page-heading button') as HTMLButtonElement).click());
  assert.equal(calls, 2); assert.equal(view.container.querySelectorAll('tbody tr').length, 1);
  await view.render(<AnalyticsWorkspace api={api} rows={[]} onOpenDialog={() => {}}/>);
  assert.match(view.container.textContent!, /Loaded 0 of 0/); assert.match(view.container.textContent!, /No eligible saved evaluations/);
  await view.close(); setLocale('ru');
});

test('inactive workspace does not fetch; stale response cannot overwrite newer rows', async () => {
  let resolveOld!: (value: Evaluation) => void; let calls = 0;
  const api = { demo: false, getEvaluation: async (id: string) => { calls++; return id === 'e' ? new Promise<Evaluation>(resolve => { resolveOld = resolve; }) : { ...evaluation(), id, conversation_id: 'new' }; } };
  const view = await mount(<AnalyticsWorkspace api={api} rows={rows} active={false} onOpenDialog={() => {}}/>);
  assert.equal(calls, 0); assert.equal(view.container.textContent, '');
  await view.render(<AnalyticsWorkspace api={api} rows={rows} onOpenDialog={() => {}}/>);
  assert.match(view.container.textContent!, /Загружаем/);
  const next = [{ ...rows[0], conversation_id: 'new', evaluation_id: 'next', language: 'EN' }];
  await view.render(<AnalyticsWorkspace api={api} rows={next} onOpenDialog={() => {}}/>);
  await act(async () => resolveOld(evaluation()));
  assert.match(view.container.querySelector('.analytics-dialogs')!.textContent!, /new/);
  assert.ok(!view.container.querySelector('.analytics-dialogs')!.textContent!.includes('synthetic-'));
  await view.close();
});
