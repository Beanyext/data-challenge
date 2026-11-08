import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { linkedMessageCriteria, validCheckedRange } from '../react/message-analysis';
import { TranscriptWorkspace } from '../react/transcript';
import type { Checklist, CriterionResult, Evaluation } from '../react/types';

const checklist: Checklist = { id: 'cl', version: 1, name: 'Правила', sections: [], criteria: [{ id: 'c1', title: 'Ясность', description: 'Объяснить действие', answer_type: 'scale', weight: 10, scale: { max: 10, steps: [] } }] };
const criterion = (extra: Partial<CriterionResult> = {}): CriterionResult => ({ criterion_id: 'c1', answer: 5, explanation: 'Исходное замечание <пример> [2]', evidence: [{ turn: 1, quote: 'Синтетический ответ & пример' }], ...extra });
const evaluation = (criteria = [criterion()]): Evaluation => ({ id: 'ev', conversation_id: 'd1', checklist_id: 'cl', checklist_version: 1, total: 50, criteria });
const record = { conversation_id: 'd1', channel: 'agent chat', language: 'RU', transcript: [{ speaker: 'client', text: 'Синтетический вопрос' }, { speaker: 'operator', text: 'Синтетический ответ & пример' }, { speaker: 'bot', text: 'Ответ бота' }, { speaker: 'system', text: 'Контекст системы' }, { speaker: 'operator', text: 'Без ссылок' }] };

test('message matching separates direct evidence, one-based references and inclusive context', () => {
  const ev = evaluation([
    criterion({ criterion_id: 'late-evidence', explanation: '', evidence: [{ turn: 0, quote: 'Первое' }, { turn: 3, quote: 'Другое' }, { turn: 1, quote: 'Нужное' }], checked_range: { from: 0, to: 4 } }),
    criterion({ criterion_id: 'reference', explanation: 'См. [2]', evidence: [] }),
    criterion({ criterion_id: 'range', explanation: '', evidence: [], checked_range: { from: 1, to: 2 } }),
    criterion({ criterion_id: 'other', explanation: 'См. [1]', evidence: [{ turn: 2, quote: 'Ответ бота' }] }),
  ]);
  assert.deepEqual(linkedMessageCriteria(ev, 1, 5).map(link => [link.item.criterion_id, link.kind]), [['late-evidence', 'evidence'], ['reference', 'reference'], ['range', 'range']]);
  assert.equal(linkedMessageCriteria(ev, 2, 5).find(link => link.item.criterion_id === 'range')?.kind, 'range', 'range includes both endpoints');
  assert.equal(linkedMessageCriteria(ev, 0, 5).find(link => link.item.criterion_id === 'other')?.kind, 'reference', '[1] means index zero');
  for (const index of [-1, 5, 1.5, NaN]) assert.deepEqual(linkedMessageCriteria(ev, index, 5), []);
  assert.deepEqual(linkedMessageCriteria(null, 1, 5), []);
  assert.deepEqual(linkedMessageCriteria(ev, 0, 0), []);
  for (let run = 0; run < 3; run++) assert.deepEqual(linkedMessageCriteria(ev, 1, 5).map(link => link.kind), ['evidence', 'reference', 'range'], 'shared global regexp must not retain cursor state');
});

test('invalid ranges and out-of-bounds evidence never create a message link', () => {
  for (const range of [{ from: 4, to: 1 }, { from: -1, to: 3 }, { from: 0, to: 5 }, { from: 0.5, to: 3 }, { from: '0', to: 3 }]) {
    const item = criterion({ explanation: '', evidence: [{ turn: 50, quote: 'Вне диалога' }], checked_range: range as never });
    assert.equal(validCheckedRange(item, 5), null);
    assert.deepEqual(linkedMessageCriteria(evaluation([item]), 1, 5), []);
  }
});

async function withWorkspace(narrow: boolean, run: (document: Document, root: ReturnType<typeof createRoot>, win: Window, scrolled: HTMLElement[]) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/?demo=1#dialog/d1', pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, fetch: () => assert.fail('message navigation must not perform requests') })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  Object.defineProperty(dom.window, 'matchMedia', { value: (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' || narrow && query === '(max-width: 1099px)', addEventListener() {}, removeEventListener() {} }) });
  Object.defineProperty(dom.window, 'scrollY', { value: 0, configurable: true, writable: true });
  dom.window.scrollTo = ((options: ScrollToOptions) => { Object.defineProperty(dom.window, 'scrollY', { value: options.top || 0, configurable: true, writable: true }); }) as typeof dom.window.scrollTo;
  const scrolled: HTMLElement[] = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this); };
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(<TranscriptWorkspace record={record} evaluation={evaluation()} checklist={checklist} appeals={[]} demo/>));
    await run(dom.window.document, root, dom.window as unknown as Window, scrolled);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}

test('late exact evidence wins over earlier references and ranges without replacing the evaluation', async () => {
  const ev = evaluation([
    criterion({ criterion_id: 'range', explanation: 'Проверялся участок', evidence: [], checked_range: { from: 0, to: 4 } }),
    criterion({ criterion_id: 'reference', explanation: 'Упоминание [2]', evidence: [] }),
    criterion({ criterion_id: 'exact:with spaces/first', evidence: [{ turn: 0, quote: 'Контекст' }, { turn: 88, quote: '<script>bad</script>' }, { turn: 1, quote: 'Нужная цитата <пример> & текст' }] }),
    criterion({ criterion_id: 'second-exact' }),
  ]);
  const before = structuredClone(ev);
  await withWorkspace(false, async (document, root, win, scrolled) => {
    await act(async () => root.render(<TranscriptWorkspace record={record} evaluation={ev} checklist={checklist} appeals={[]} demo/>));
    const groups = document.getElementById('criteria-map');
    const transcript = document.getElementById('transcript')!;
    transcript.scrollTop = 42;
    const range = document.getElementById('criterion-range')!;
    await act(async () => range.querySelector<HTMLButtonElement>('.result-row')!.click());
    const calculation = range.querySelector<HTMLDetailsElement>('.result-calculation')!;
    calculation.open = true;
    const button = document.querySelector<HTMLButtonElement>('[data-inspect-turn="1"]')!;
    assert.equal(document.querySelectorAll('.turn-inspect-button').length, 2);
    assert.equal(document.querySelector('.turn-client button, .turn-bot button, .turn-system button'), null);
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.hasAttribute('data-turn'), false, 'navigation must not trigger audio/evidence actions');
    assert.equal(button.hasAttribute('aria-expanded'), false, 'message is a navigation control');
    await act(async () => button.click());
    const target = document.getElementById('criterion-exact:with spaces/first')!;
    const quote = target.querySelector<HTMLElement>('[data-evidence-turn="1"]')!;
    const reason = target.querySelector<HTMLElement>('.result-reason')!;
    assert.equal(document.querySelector('.result-criterion.evidence-selected'), target);
    assert.equal(target.querySelector('.result-row')!.getAttribute('aria-expanded'), 'true');
    assert.equal(target.querySelector<HTMLElement>('.result-criterion-details')!.hidden, false);
    assert.equal(quote.closest<HTMLDetailsElement>('details')!.open, true, 'matching later quote is revealed');
    assert.equal(document.activeElement, reason);
    assert.equal(scrolled.at(-1), reason, 'navigation keeps the rationale above the quote in view');
    assert.match(quote.textContent!, /Нужная цитата <пример> & текст/);
    assert.equal(document.querySelector('[data-turn="88"], script'), null);
    assert.equal(document.querySelector('.turn.highlight')!.id, 'turn-1');
    assert.equal(document.getElementById('criteria-map'), groups, 'existing evaluation stays mounted');
    assert.equal(range.querySelector('.result-row')!.getAttribute('aria-expanded'), 'true');
    assert.equal(calculation.open, true, 'unrelated disclosure state is preserved');
    assert.equal(document.getElementById('transcript'), transcript);
    assert.equal(transcript.scrollTop, 42);
    assert.equal(document.querySelector('#message-inspector, dialog, [role="dialog"]'), null);
    const scrollCount = scrolled.length;
    await act(async () => button.click());
    assert.equal(scrolled.length, scrollCount + 1, 'repeated click scrolls again');
    assert.equal(scrolled.at(-1), reason);
    assert.equal(target.querySelector('.result-row')!.getAttribute('aria-expanded'), 'true');
    assert.equal(document.querySelectorAll('.result-criterion.evidence-selected').length, 1);
    assert.equal(win.location.hash, '#dialog/d1');
    assert.deepEqual(ev, before, 'navigation cannot change answers, evidence or scores');
  });
});

test('references beat ranges and equal-priority targets follow result order on narrow screens too', async () => {
  const ev = evaluation([
    criterion({ criterion_id: 'range', explanation: '', evidence: [], checked_range: { from: 1, to: 4 } }),
    criterion({ criterion_id: 'first-reference', explanation: 'Первое обоснование [2]', evidence: [] }),
    criterion({ criterion_id: 'second-reference', explanation: 'Второе обоснование [2]', evidence: [] }),
  ]);
  await withWorkspace(true, async (document, root, _win, scrolled) => {
    await act(async () => root.render(<TranscriptWorkspace record={record} evaluation={ev} checklist={checklist} appeals={[]} demo/>));
    await act(async () => document.querySelector<HTMLButtonElement>('[data-inspect-turn="1"]')!.click());
    const reference = document.getElementById('criterion-first-reference')!;
    assert.equal(document.querySelector('.result-criterion.evidence-selected'), reference);
    assert.equal(scrolled.at(-1), reference.querySelector('.result-reason'));
    assert.equal(document.activeElement, scrolled.at(-1));
    await act(async () => document.querySelector<HTMLButtonElement>('[data-inspect-turn="4"]')!.click());
    const range = document.getElementById('criterion-range')!;
    assert.equal(document.querySelector('.result-criterion.evidence-selected'), range);
    assert.equal(range.querySelector('.result-row')!.getAttribute('aria-expanded'), 'true');
    assert.ok(range.contains(scrolled.at(-1)!));
    assert.equal(document.querySelector('.turn.highlight')!.id, 'turn-4');
    assert.equal(document.querySelectorAll('.result-criterion.evidence-selected').length, 1);
    assert.equal(document.querySelectorAll('#transcript .turn').length, record.transcript.length);
    assert.equal(document.querySelector('#message-inspector, dialog, [role="dialog"]'), null);
  });
});

test('unlinked messages report inline status and a different dialog clears it', async () => {
  await withWorkspace(false, async (document, root, _win, scrolled) => {
    const groups = document.getElementById('criteria-map');
    await act(async () => document.querySelector<HTMLButtonElement>('[data-inspect-turn="4"]')!.click());
    const notice = document.querySelector('.message-navigation-note')!;
    assert.ok(notice);
    assert.equal(notice.getAttribute('role'), 'status');
    assert.ok(notice.textContent!.trim());
    assert.equal(scrolled.length, 0, 'no arbitrary criterion is chosen');
    assert.equal(document.getElementById('criteria-map'), groups);
    assert.equal(document.querySelector('#message-inspector, dialog, [role="dialog"]'), null);
    await act(async () => document.querySelector<HTMLButtonElement>('[data-inspect-turn="1"]')!.click());
    assert.equal(document.querySelector('.message-navigation-note'), null, 'a linked message clears the notice');
    assert.ok(document.querySelector('.result-criterion.evidence-selected'));
    await act(async () => document.querySelector<HTMLButtonElement>('[data-inspect-turn="4"]')!.click());
    await act(async () => root.render(<TranscriptWorkspace record={{ ...record, conversation_id: 'd2' }} evaluation={null} checklist={checklist} appeals={[]} demo/>));
    assert.equal(document.querySelector('.message-navigation-note'), null);
  });
});

test('empty transcript stays empty and an unevaluated call loads no audio or evaluation', async () => {
  const document = new JSDOM(renderToStaticMarkup(<TranscriptWorkspace record={{ ...record, transcript: [] }} evaluation={null} appeals={[]} demo/>)).window.document;
  assert.equal(document.querySelectorAll('.turn').length, 0);
  assert.equal(document.querySelector('.message-navigation-note, #message-inspector'), null);
  await withWorkspace(false, async (document, root, _win, scrolled) => {
    await act(async () => root.render(<TranscriptWorkspace record={{ ...record, channel: 'voice call' }} evaluation={null} appeals={[]} demo/>));
    await act(async () => document.querySelector<HTMLButtonElement>('[data-inspect-turn="1"]')!.click());
    const notice = document.querySelector('.message-navigation-note')!;
    assert.equal(notice.getAttribute('role'), 'status');
    assert.ok(notice.textContent!.trim());
    assert.ok(document.querySelector('#audio-block [data-action="audio"]'), 'audio action remains explicit');
    assert.equal(document.querySelector('#call-audio, #message-inspector, dialog'), null);
    assert.equal(document.querySelector('#evaluation-panel .result-criterion'), null);
    assert.equal(scrolled.length, 0);
  });
});

test('narrow tabs preserve mounted results, disclosure state and each pane position', async () => {
  await withWorkspace(true, async (document, _root, win) => {
    const transcriptPanel = document.getElementById('transcript-panel')!;
    const evaluationPanel = document.getElementById('evaluation-panel')!;
    const transcript = document.getElementById('transcript')!;
    const dialogTab = document.getElementById('workspace-tab-dialog') as HTMLButtonElement;
    const evaluationTab = document.getElementById('workspace-tab-evaluation') as HTMLButtonElement;
    assert.equal(document.querySelector<HTMLElement>('[role="tablist"]')!.hidden, false);
    assert.equal(transcriptPanel.hidden, false);
    assert.equal(evaluationPanel.hidden, true);
    assert.equal(dialogTab.tabIndex, 0);
    assert.equal(evaluationTab.tabIndex, -1);
    Object.defineProperty(win, 'scrollY', { value: 320, configurable: true, writable: true });
    transcript.scrollTop = 71;
    await act(async () => document.querySelector<HTMLButtonElement>('[data-inspect-turn="1"]')!.click());
    assert.equal(transcriptPanel.hidden, true);
    assert.equal(evaluationPanel.hidden, false);
    assert.equal(evaluationTab.getAttribute('aria-selected'), 'true');
    const criterion = document.querySelector<HTMLElement>('.result-criterion')!;
    const calculation = criterion.querySelector<HTMLDetailsElement>('.result-calculation')!;
    calculation.open = true;
    Object.defineProperty(win, 'scrollY', { value: 640, configurable: true, writable: true });
    evaluationPanel.scrollTop = 29;
    await act(async () => dialogTab.click());
    assert.equal(win.scrollY, 320);
    assert.equal(transcript.scrollTop, 71);
    await act(async () => evaluationTab.click());
    assert.equal(win.scrollY, 640);
    assert.equal(evaluationPanel.scrollTop, 29);
    assert.equal(document.querySelector('.result-criterion'), criterion);
    assert.equal(calculation.open, true);
    assert.equal(criterion.querySelector('.result-row')!.getAttribute('aria-expanded'), 'true');
    assert.equal(document.getElementById('transcript'), transcript);
  });
});

test('reverse evidence navigation reveals the transcript before delegated handlers and no-match stays inline', async () => {
  await withWorkspace(true, async (document) => {
    const transcriptPanel = document.getElementById('transcript-panel')!;
    const evaluationPanel = document.getElementById('evaluation-panel')!;
    await act(async () => document.querySelector<HTMLButtonElement>('[data-inspect-turn="1"]')!.click());
    const evidence = document.querySelector<HTMLButtonElement>('.result-criterion .evidence-link[data-turn="1"]')!;
    assert.equal(evaluationPanel.hidden, false, 'control: evaluation is visible before the reverse jump');
    let delegated = 0;
    const listener = (event: Event) => {
      if (event.target !== evidence) return;
      delegated++;
      assert.equal(transcriptPanel.hidden, false, 'legacy document handler must see a visible target');
      assert.equal(evaluationPanel.hidden, true);
      document.getElementById('turn-1')!.focus({ preventScroll: true });
    };
    document.addEventListener('click', listener);
    try { await act(async () => evidence.click()); } finally { document.removeEventListener('click', listener); }
    assert.equal(delegated, 1);
    assert.equal(document.activeElement!.id, 'turn-1');
    await act(async () => document.querySelector<HTMLButtonElement>('[data-inspect-turn="4"]')!.click());
    assert.equal(transcriptPanel.hidden, false);
    assert.equal(evaluationPanel.hidden, true);
    assert.ok(document.querySelector('.message-navigation-note'));
    assert.equal(document.querySelector('[role="dialog"], #message-inspector'), null);
  });
});

test('tabs support arrows, Home and End while desktop keeps both panels available', async () => {
  await withWorkspace(true, async (document) => {
    const dialogTab = document.getElementById('workspace-tab-dialog') as HTMLButtonElement;
    const evaluationTab = document.getElementById('workspace-tab-evaluation') as HTMLButtonElement;
    const press = async (button: HTMLButtonElement, key: string) => act(async () => {
      button.dispatchEvent(new document.defaultView!.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
    dialogTab.focus();
    await press(dialogTab, 'ArrowRight');
    assert.equal(document.activeElement, evaluationTab);
    assert.equal(evaluationTab.getAttribute('aria-selected'), 'true');
    await press(evaluationTab, 'Home');
    assert.equal(document.activeElement, dialogTab);
    await press(dialogTab, 'End');
    assert.equal(document.activeElement, evaluationTab);
    await press(evaluationTab, 'ArrowLeft');
    assert.equal(document.activeElement, dialogTab);
    assert.equal(dialogTab.getAttribute('aria-selected'), 'true');
  });
  await withWorkspace(false, async (document) => {
    assert.equal(document.querySelector<HTMLElement>('[role="tablist"]')!.hidden, true);
    assert.equal(document.getElementById('transcript-panel')!.hidden, false);
    assert.equal(document.getElementById('evaluation-panel')!.hidden, false);
    await act(async () => document.querySelector<HTMLButtonElement>('[data-inspect-turn="1"]')!.click());
    assert.equal(document.getElementById('transcript-panel')!.hidden, false);
    assert.equal(document.getElementById('evaluation-panel')!.hidden, false);
  });
});
