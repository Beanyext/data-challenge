import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { missions } from '../react/academy/missions';
import { hintStructure } from '../react/academy/hint-content';
import { defaultState, startSession, chooseResponse, saveState, loadState, STORAGE_KEY } from '../react/academy/engine';

const scenario = process.env.CQA_ACADEMY_ENHANCEMENTS;
if (!scenario) {
  test('Every active and recovery stage has authored second-level guidance in all locales', () => {
    let count = 0;
    for (const mission of missions) for (const node of Object.values(mission.nodes)) {
      const structure = hintStructure(mission.id, node.id);
      if (!node.actions.length) { assert.equal(structure, undefined); continue; }
      count++;
      assert.ok(structure, `${mission.id}/${node.id}`);
      for (const locale of ['ru', 'kk', 'en'] as const) {
        assert.ok(node.hint[locale].trim().length > 20);
        assert.ok(structure[locale].trim().length > 20);
        assert.notEqual(structure[locale], node.actions.find(action => action.id === node.idealActionId)!.text[locale]);
      }
      assert.doesNotMatch(structure.en, /[А-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/u);
    }
    assert.equal(count, 68);
  });
  const run = promisify(execFile);
  for (const locale of ['ru', 'kk', 'en']) test(`Academy ${locale}: reading preview, staged hints and turn navigation preserve the actual session`, { timeout: 20000 }, async () => {
    const env = { ...process.env, CQA_ACADEMY_ENHANCEMENTS: locale };
    delete env.NODE_TEST_CONTEXT;
    try { await run(process.execPath, [fileURLToPath(import.meta.url)], { cwd: process.cwd(), env, timeout: 15000 }); }
    catch (error) { const failure = error as Error & { stdout?: string; stderr?: string }; assert.fail(`${failure.stdout || ''}\n${failure.stderr || failure.message}`); }
  });
} else {
  test(`isolated enhancements ${scenario}`, { timeout: 12000 }, async () => {
    const mission = missions[0];
    let session = startSession(mission, 'story');
    const wrong = mission.nodes[session.nodeId].actions.find(action => action.errors.length && !action.critical)!;
    session = chooseResponse(session, mission, wrong.id);
    assert.ok(session.nodeId.endsWith('-repair'));
    session = chooseResponse(session, mission, mission.nodes[session.nodeId].idealActionId);
    const state = { ...defaultState(), active: session };
    const errors: string[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error.message));
    const dom = new JSDOM(await readFile('web/index.html', 'utf8'), { url: `http://localhost:8000/?lang=${scenario}#academy/mission/login/story`, pretendToBeVisual: true, virtualConsole });
    const { window } = dom;
    const previous = new Map<string, PropertyDescriptor | undefined>();
    function expose(name: string, value: unknown) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); }
    for (const name of ['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'Node', 'Element', 'HTMLElement', 'HTMLDetailsElement', 'HTMLInputElement', 'FormData', 'Event', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle']) expose(name, window[name]);
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    expose('matchMedia', window.matchMedia);
    expose('requestAnimationFrame', window.requestAnimationFrame.bind(window));
    expose('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
    let requests = 0;
    expose('fetch', async () => { requests++; throw new Error('Unexpected network request'); });
    assert.ok(saveState(state, window.localStorage));
    const q = (selector: string) => window.document.querySelector<HTMLElement>(selector);
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    async function until(condition: () => unknown, label: string) { for (let i = 0; i < 180; i++) { if (condition()) return; await delay(10); } assert.fail(label); }
    let ui: { disposeUI(): void; canReloadAcademy(): boolean } | undefined;
    try {
      await import(pathToFileURL(path.resolve('web/app.mjs')).href);
      ui = await import(pathToFileURL(path.resolve('web/react-ui.js')).href);
      await until(() => q('[data-ac-node]'), 'saved session rendered');
      const snapshot = window.localStorage.getItem(STORAGE_KEY);
      const reading = q('[data-ac-reading]')!;
      reading.focus(); reading.click();
      await until(() => q('[data-ac-reading-preview]'), 'reading preview opened');
      q('input[value="large"]')!.click();
      await until(() => q('[data-ac-reading-preview="large"]'), 'larger draft displayed');
      assert.equal(q('[data-academy]')!.getAttribute('data-ac-reading-preset'), 'normal', 'preview has no effect on the training text');
      q('[data-ac-reading-apply]')!.click();
      await until(() => q('[data-academy]')!.getAttribute('data-ac-reading-preset') === 'large', 'explicit apply updates the preset');
      assert.equal(window.localStorage.getItem('freedom-academy:broker:reading:v1'), 'large');
      q('[data-ac-dialog-close]')!.click();
      await until(() => !q('.ac-feature-dialog'), 'reading dialog closed');
      assert.equal(window.document.activeElement, reading, 'dialog restores trigger focus');
      assert.equal(window.localStorage.getItem(STORAGE_KEY), snapshot, 'reading preference never writes progress');
      reading.click();
      await until(() => q('[data-ac-reading-reset]'), 'preference can be reopened');
      q('[data-ac-reading-reset]')!.click();
      await until(() => q('[data-academy]')!.getAttribute('data-ac-reading-preset') === 'normal', 'reset restores the actual original text preset');
      assert.equal(window.localStorage.getItem('freedom-academy:broker:reading:v1'), 'normal');
      const savedSetter = window.Storage.prototype.setItem;
      window.Storage.prototype.setItem = function (key, value) { if (key === 'freedom-academy:broker:reading:v1') throw new Error('Storage unavailable'); return savedSetter.call(this, key, value); };
      q('input[value="large"]')!.click();
      await until(() => q('[data-ac-reading-preview="large"]'), 'larger draft selected again');
      q('[data-ac-reading-apply]')!.click();
      await until(() => q('.ac-reading-warning'), 'failed preference save is explained');
      assert.equal(q('[data-academy]')!.getAttribute('data-ac-reading-preset'), 'large', 'preference remains usable in memory');
      assert.equal(window.localStorage.getItem(STORAGE_KEY), snapshot);
      window.Storage.prototype.setItem = savedSetter;
      q('[data-ac-reading-apply]')!.click();
      await until(() => !q('.ac-reading-warning'), 'retry saves the preference');
      q('[data-ac-dialog-close]')!.click();
      await until(() => !q('.ac-feature-dialog'), 'reading dialog closed after retry');

      const tour = q('[data-ac-guided-start]')!;
      tour.focus(); tour.click();
      await until(() => q('[data-tour-step="1"]'), 'optional introduction opened');
      q('.ac-learning-choice')!.click();
      await until(() => !(q('[data-ac-tour-next]') as HTMLButtonElement).disabled, 'demo response selected');
      q('[data-ac-tour-next]')!.click();
      await until(() => q('[data-tour-step="2"]'), 'introduction shows emotion change');
      assert.ok(q('.ac-learning-emotion'));
      q('[data-ac-tour-next]')!.click();
      await until(() => q('[data-tour-step="3"]'), 'third step shows review');
      q('[data-ac-tour-back]')!.click();
      await until(() => q('[data-tour-step="2"]'), 'tour can step back');
      q('[data-ac-tour-skip]')!.click();
      await until(() => !q('.ac-feature-dialog'), 'tour can be skipped');
      assert.equal(window.document.activeElement, tour);
      assert.equal(window.localStorage.getItem(STORAGE_KEY), snapshot, 'demo walkthrough never changes the active mission');

      q('[data-ac-timeline-turn="2"]')!.click();
      await until(() => q('[data-ac-chat-turn="2"].is-navigated'), 'repair occurrence selected');
      assert.equal(window.document.activeElement, q('[data-ac-chat-turn="2"]'));
      assert.ok(q('[data-ac-latest]'), 'return action remains available');
      q('[data-ac-timeline-turn="1"]')!.click();
      await until(() => q('[data-ac-chat-turn="1"].is-navigated'), 'first occurrence selected');
      assert.equal(window.localStorage.getItem(STORAGE_KEY), snapshot, 'timeline does not replay or alter turns');
      q('[data-ac-current]')!.click();
      await until(() => !q('.is-navigated'), 'return clears historical selection');
      assert.equal(window.document.activeElement, q('.ac-composer h3'));

      assert.equal(q('[data-ac-hint-level="2"]'), null);
      const hintButton = q('[data-ac-hint]')!;
      hintButton.focus(); hintButton.click();
      await until(() => q('[data-ac-hint-level="1"]'), 'principle shown');
      assert.equal(window.document.activeElement, hintButton, 'revealing a hint keeps keyboard focus on its control');
      assert.equal(q('[data-ac-hint-level="2"]'), null, 'structure requires another request');
      const hinted = loadState(window.localStorage);
      assert.deepEqual(hinted.active!.hintedNodes, [session.nodeId]);
      assert.deepEqual(hinted.history, state.history);
      assert.deepEqual(hinted.contributions, state.contributions);
      const afterHint = window.localStorage.getItem(STORAGE_KEY);
      const nextHint = q('[data-ac-hint-next]')!;
      nextHint.focus(); nextHint.click();
      await until(() => q('[data-ac-hint-level="2"]'), 'structure revealed');
      assert.ok(q('[data-ac-hint-level="2"]')!.textContent!.includes(hintStructure(mission.id, session.nodeId)![scenario as 'ru' | 'kk' | 'en']));
      assert.equal(window.localStorage.getItem(STORAGE_KEY), afterHint, 'second level does not record hint usage again');
      assert.equal(window.document.activeElement, nextHint);
      nextHint.click();
      await until(() => !q('[data-ac-hint-level="2"]'), 'structure can collapse');
      nextHint.click();
      await until(() => q('[data-ac-hint-level="2"]'), 'structure reopens on request');
      assert.equal(window.localStorage.getItem(STORAGE_KEY), afterHint, 'reopening never changes the attempt');
      assert.equal(loadState(window.localStorage).active!.turns.length, session.turns.length);
      if (scenario === 'ru') {
        window.location.hash = '#academy';
        await until(() => q('[data-ac-confirm]'), 'existing guard protects the active mission');
        q('.ac-confirm-accept')!.click();
        await until(() => q('.ac-week-disclosure'), 'dashboard contains optional weekly plan');
        const weekPanel = q('.ac-week-disclosure') as HTMLDetailsElement;
        assert.equal(weekPanel.open, false);
        weekPanel.querySelector('summary')!.click();
        const weekKey = 'freedom-academy:broker:weekly-plan:v1';
        const saved = window.localStorage.getItem(STORAGE_KEY);
        const setter = window.Storage.prototype.setItem;
        window.Storage.prototype.setItem = function (key, value) { if (key === weekKey) throw new Error('Storage quota'); return setter.call(this, key, value); };
        q('.ac-learning-schedule [type="submit"]')!.click();
        await until(() => q('.ac-learning-warning'), 'weekly write failure is visible');
        assert.equal(ui!.canReloadAcademy(), false, 'language reload guard also protects a memory-only plan');
        const beforeUnload = new window.Event('beforeunload', { cancelable: true });
        window.dispatchEvent(beforeUnload);
        assert.equal(beforeUnload.defaultPrevented, true, 'manual reload cannot silently discard the plan');
        assert.equal(window.localStorage.getItem(STORAGE_KEY), saved, 'planning never rewrites progress');
        window.Storage.prototype.setItem = setter;
        q('.ac-learning-warning button')!.click();
        await until(() => !q('.ac-learning-warning'), 'weekly save can be retried');
        assert.equal(ui!.canReloadAcademy(), true);
        assert.equal(JSON.parse(window.localStorage.getItem(weekKey)!).entries.length, 1);
        q('.ac-learning-schedule [type="submit"]')!.click();
        await delay(20);
        assert.equal(JSON.parse(window.localStorage.getItem(weekKey)!).entries.length, 1, 'UI prevents duplicate plan entries');
        assert.equal(window.localStorage.getItem(STORAGE_KEY), saved);
      }
      assert.equal(requests, 0, 'all tools remain offline');
      assert.deepEqual(errors, []);
    } finally { ui?.disposeUI(); window.close(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; } }
  });
}
