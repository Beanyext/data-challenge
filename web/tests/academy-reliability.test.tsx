import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { missions } from '../react/academy/missions';
import { defaultState, startSession, chooseResponse, completeSession, saveState, loadState, STORAGE_KEY } from '../react/academy/engine';

// The production view caches local fallback state at module scope. A fresh process
// per scenario gives each test a genuinely independent browser/demo profile.
const scenario = process.env.CQA_ACADEMY_RELIABILITY_SCENARIO;
if (!scenario) {
  const run = promisify(execFile);
  for (const [id, title] of [
    ['final-navigation', 'Academy records a final answer before the visual delay and keeps it after navigation'],
    ['quota-language', 'Academy blocks a language reload when progress can only be kept in memory'],
    ['cross-tab', 'Academy preserves progress from another tab when changing a local demo setting'],
  ]) test(title, { timeout: 20000 }, async () => {
    const env = { ...process.env, CQA_ACADEMY_RELIABILITY_SCENARIO: id };
    delete env.NODE_TEST_CONTEXT;
    try { await run(process.execPath, [fileURLToPath(import.meta.url)], { cwd: process.cwd(), env, timeout: 15000 }); }
    catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      assert.fail(`${title}\n${failure.stdout || ''}\n${failure.stderr || failure.message}`);
    }
  });
} else {
  test(`isolated Academy ${scenario}`, { timeout: 12000 }, async () => {
    const navigationAttempts: string[] = [];
    const consoleErrors: string[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => {
      if (/Not implemented: navigation/.test(error.message)) navigationAttempts.push(error.message);
      else consoleErrors.push(error.message);
    });
    const dom = new JSDOM(await readFile('web/index.html', 'utf8'), {
      url: `http://localhost:8000/?lang=ru${scenario === 'cross-tab' ? '#academy' : '#academy/mission/login/story'}`, pretendToBeVisual: true, virtualConsole,
    });
    const { window } = dom;
    const previous = new Map<string, PropertyDescriptor | undefined>();
    function expose(name: string, value: unknown) {
      previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
    }
    for (const name of ['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'Node', 'Element', 'HTMLElement', 'HTMLDetailsElement', 'HTMLInputElement', 'FormData', 'Event', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle']) expose(name, window[name]);
    const nativeTimeout = globalThis.setTimeout;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    expose('setTimeout', (callback: (...args: unknown[]) => void, milliseconds?: number, ...args: unknown[]) => {
      const id = nativeTimeout(callback, milliseconds, ...args);
      timers.add(id);
      return id;
    });
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    // Baseline native confirms are accepted. Updated Academy themed dialogs are
    // not needed here: a committed completed attempt must no longer require a guard.
    window.confirm = () => true;
    expose('confirm', window.confirm);
    expose('matchMedia', window.matchMedia);
    expose('requestAnimationFrame', window.requestAnimationFrame.bind(window));
    expose('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
    let networkCalls = 0;
    expose('fetch', async () => { networkCalls++; throw new Error('Academy must not fetch'); });
    const q = (selector: string) => window.document.querySelector<HTMLElement>(selector);
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    async function until(condition: () => unknown, label: string) {
      for (let n = 0; n < 180; n++) { if (condition()) return; await delay(10); }
      assert.fail(label);
    }
    const login = missions.find(item => item.id === 'login')!;
    if (scenario === 'final-navigation') {
      let active = startSession(login, 'story');
      while (true) {
        const node = login.nodes[active.nodeId];
        const ideal = node.actions.find(action => action.id === node.idealActionId)!;
        if (login.nodes[ideal.next].terminal) break;
        active = chooseResponse(active, login, ideal.id);
      }
      assert.ok(saveState({ ...defaultState(), demoUnlocked: true, active }, window.localStorage));
    } else if (scenario === 'quota-language') {
      const originalSetItem = window.Storage.prototype.setItem;
      window.Storage.prototype.setItem = function (key, value) {
        if (this === window.localStorage && key === STORAGE_KEY) throw new window.DOMException('Test quota exceeded', 'QuotaExceededError');
        originalSetItem.call(this, key, value);
      };
    }
    let uiModule: { disposeUI(): void } | undefined;
    try {
      // Dynamic URLs execute the exact built application, not a surrogate view.
      await import(pathToFileURL(path.resolve('web/app.mjs')).href);
      uiModule = await import(pathToFileURL(path.resolve('web/react-ui.js')).href);
      await until(() => q('.academy'), 'Academy mounted');
      if (scenario === 'final-navigation') {
        await until(() => q('[data-ac-node]'), 'saved last stage restored');
        const nodeId = q('[data-ac-node]')!.getAttribute('data-ac-node')!;
        q(`[data-ac-choice="${login.nodes[nodeId].idealActionId}"]`)!.click();
        const immediately = loadState(window.localStorage);
        assert.equal(immediately.history.length, 1, 'last answer must persist its result synchronously, before typing animation');
        assert.equal(immediately.history[0].score, 100);
        assert.equal(immediately.contributions.login, login.maxXP);
        const attemptId = immediately.history[0].id;
        window.location.hash = '#academy';
        await until(() => q('[data-ac-reset]'), 'dashboard reached without waiting for the visual timer');
        await delay(800);
        assert.equal(window.location.hash, '#academy', 'unmounted visual timer must not navigate later');
        assert.equal(loadState(window.localStorage).history[0].id, attemptId);
        window.location.hash = '#academy/mission/order/story';
        await until(() => q('[data-ac-start]'), 'another mission briefing');
        q('[data-ac-start]')!.click();
        await until(() => q('[data-ac-node]'), 'another mission started');
        const resumed = loadState(window.localStorage);
        assert.equal(resumed.active?.missionId, 'order');
        assert.equal(resumed.history.length, 1);
        assert.equal(resumed.history[0].id, attemptId);
        assert.equal(resumed.contributions.login, login.maxXP);
      } else if (scenario === 'cross-tab') {
        // A second same-origin tab completes a mission after this view has
        // already cached its empty initial snapshot. Browsers send this event
        // to the other tab; JSDOM needs the event dispatched explicitly.
        let externalSession = startSession(login, 'story');
        while (externalSession.status === 'active') externalSession = chooseResponse(externalSession, login, login.nodes[externalSession.nodeId].idealActionId);
        const externalState = completeSession(defaultState(), externalSession, login);
        assert.ok(saveState(externalState, window.localStorage));
        window.dispatchEvent(new window.StorageEvent('storage', {
          key: STORAGE_KEY, oldValue: null, newValue: window.localStorage.getItem(STORAGE_KEY), storageArea: window.localStorage,
        }));
        await delay(60);
        assert.equal(loadState(window.localStorage).history.length, 1);
        q('[data-ac-demo-unlock]')!.click();
        await delay(40);
        const stored = loadState(window.localStorage);
        assert.equal(stored.demoUnlocked, true);
        assert.equal(stored.history.length, 1, 'an unrelated toggle must not overwrite a newer completed attempt');
        assert.equal(stored.history[0].id, externalSession.id);
        assert.equal(stored.contributions.login, login.maxXP);
        assert.deepEqual(stored.mastered, ['login']);
        window.dispatchEvent(new window.StorageEvent('storage', { key: null, newValue: null, storageArea: window.sessionStorage }));
        await delay(30);
        q('[data-ac-demo-unlock]')!.click();
        await delay(30);
        assert.equal(loadState(window.localStorage).history.length, 1, 'unrelated session storage clearing cannot reset Academy');
      } else if (scenario === 'quota-language') {
        await until(() => q('[data-ac-start]'), 'briefing shown');
        q('[data-ac-start]')!.click();
        await until(() => q('[data-ac-node]'), 'memory-only mission started');
        q(`[data-ac-choice="${login.nodes[login.start].idealActionId}"]`)!.click();
        await until(() => q('[data-ac-node]')?.getAttribute('data-ac-node') !== login.start, 'memory-only answer advances');
        const nodeId = q('[data-ac-node]')!.getAttribute('data-ac-node');
        const route = window.location.hash;
        assert.ok(q('.ac-storage-warning'));
        assert.equal(loadState(window.localStorage).active, null, 'quota prevents durable Academy state');
        q('.language-trigger')!.click();
        await until(() => q('[data-language="en"]'), 'language menu opened');
        q('[data-language="en"]')!.click();
        await delay(250);
        assert.equal(navigationAttempts.length, 0, 'language action must not call location.assign while Academy progress is unsaved');
        await until(() => !q('[data-language="en"]'), 'cancelled language reload closes its pending state');
        assert.equal((q('.language-trigger') as HTMLButtonElement).disabled, false);
        assert.ok(q('.toast.error'), 'cancelled reload explains how to preserve the training');
        assert.equal(window.location.hash, route);
        assert.equal(q('[data-ac-node]')!.getAttribute('data-ac-node'), nodeId);
        assert.equal(window.document.documentElement.lang, 'ru');
        const refresh = new window.Event('beforeunload', { cancelable: true });
        window.dispatchEvent(refresh);
        assert.equal(refresh.defaultPrevented, true, 'manual refresh also warns about memory-only progress');
      } else assert.fail(`unknown scenario ${scenario}`);
      assert.equal(networkCalls, 0);
      assert.deepEqual(consoleErrors, []);
    } finally {
      // Dispose the application toast timer before removing this isolated DOM.
      for (const timer of timers) clearTimeout(timer);
      uiModule?.disposeUI();
      dom.window.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
}
