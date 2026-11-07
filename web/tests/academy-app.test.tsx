import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { missions } from '../react/academy/missions';

test('Academy: eight complete UI missions, local rewards, route guard and no network calls', { timeout: 120000 }, async () => {
  const locale = process.env.CQA_ACADEMY_LOCALE || 'ru';
  const html = await readFile('web/index.html', 'utf8');
  const dom = new JSDOM(html, { url: `http://localhost:8000/?lang=${locale}#academy`, pretendToBeVisual: true });
  const { window } = dom;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  function expose(name: string, value: unknown) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
  for (const name of ['window','document','navigator','location','history','localStorage','sessionStorage','Node','Element','HTMLElement','HTMLDetailsElement','HTMLInputElement','FormData','Event','MouseEvent','KeyboardEvent','MutationObserver','getComputedStyle']) expose(name, window[name]);
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  let consent = true;
  window.confirm = () => consent;
  expose('confirm', window.confirm);
  expose('matchMedia', window.matchMedia);
  expose('requestAnimationFrame', window.requestAnimationFrame.bind(window));
  expose('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
  let networkCalls = 0;
  expose('fetch', async () => { networkCalls++; throw new Error('Academy must not fetch'); });
  const q = (selector: string) => window.document.querySelector<HTMLElement>(selector);
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function until(condition: () => unknown, label: string) {
    for (let n = 0; n < 160; n++) { if (condition()) return; await delay(15); }
    assert.fail(label);
  }
  const key = 'freedom-academy:broker:progress:v1';
  const stored = () => JSON.parse(window.localStorage.getItem(key) || 'null');
  let uiModule: { disposeUI(): void; ui: { academy(props: unknown): void } } | undefined;
  try {
    await import('../app.mjs');
    uiModule = await import('../react-ui.js');
    await until(() => q('.academy'), 'dashboard mounted');
    assert.ok(q('[data-nav="academy"]'));
    assert.equal(networkCalls, 0);
    assert.equal(window.document.documentElement.lang, locale);
    const demoToggle = q('[data-ac-demo-unlock]');
    assert.ok(demoToggle, 'jury demonstration toggle');
    demoToggle.click();
    await until(() => stored()?.demoUnlocked, 'demo unlock persists');
    assert.deepEqual(stored().contributions, {}, 'unlock gives no XP');

    const first = missions[0];
    window.location.hash = `academy/mission/${first.id}/story`;
    await until(() => q('[data-ac-start]'), 'first briefing');
    q('[data-ac-start]')!.click();
    await until(() => q('[data-ac-node]'), 'first conversation');
    const bad = first.nodes[first.start].actions.find(action => !action.critical && action.effects.stress > 0)!;
    q(`[data-ac-choice="${bad.id}"]`)!.click();
    await until(() => q('[data-ac-node]')?.getAttribute('data-ac-node') !== first.start, 'wrong answer branches');
    assert.ok(stored().active.emotion.stress > first.initial.stress, 'wrong answer increases stress');
    while (!window.location.hash.startsWith('#academy/result/')) {
      const nodeId = q('[data-ac-node]')!.getAttribute('data-ac-node')!;
      q(`[data-ac-choice="${first.nodes[nodeId].idealActionId}"]`)!.click();
      await until(() => window.location.hash.startsWith('#academy/result/') || q('[data-ac-node]')?.getAttribute('data-ac-node') !== nodeId, 'corrected answer continues');
    }
    await until(() => q('.ac-result'), 'recovered attempt has result');
    assert.ok(stored().history.at(-1).score < 100);
    assert.ok(q('.ac-feedback-item'), 'error is explained even after correction');
    const initialContribution = stored().contributions[first.id];
    assert.ok(initialContribution > 0 && initialContribution < first.maxXP);

    for (const mission of missions) {
      window.location.hash = `academy/mission/${mission.id}/story`;
      await until(() => q('[data-ac-start]'), `briefing ${mission.id}`);
      q('[data-ac-start]')!.click();
      await until(() => q('[data-ac-node]'), `session ${mission.id}`);
      let turnCount = 0;
      while (!window.location.hash.startsWith('#academy/result/')) {
        const nodeId = q('[data-ac-node]')?.getAttribute('data-ac-node');
        assert.ok(nodeId, `current node ${mission.id}`);
        const node = mission.nodes[nodeId];
        assert.ok(node && !node.terminal);
        const button = q(`[data-ac-choice="${node.idealActionId}"]`);
        assert.ok(button, `answer ${mission.id}/${nodeId}`);
        button.click();
        button.click(); // A double click must only consume one action.
        turnCount++;
        await until(() => window.location.hash.startsWith('#academy/result/') || q('[data-ac-node]')?.getAttribute('data-ac-node') !== nodeId, `next node ${mission.id}/${nodeId}`);
        assert.ok(turnCount <= mission.maxTurns);
      }
      await until(() => q('.ac-result'), `result ${mission.id}`);
      const result = stored().history.at(-1);
      assert.equal(result.missionId, mission.id);
      assert.equal(result.turns.length, turnCount);
      assert.equal(result.score, 100);
      assert.equal(result.passed, true);
      assert.equal(stored().contributions[mission.id], mission.maxXP);
      if (mission.id === first.id) assert.equal(result.xpEarned, mission.maxXP - initialContribution, 'replay only rewards improvement');
      const snapshot = window.localStorage.getItem(key);
      uiModule!.ui.academy({ resultId: result.id });
      await delay(40);
      assert.equal(window.localStorage.getItem(key), snapshot, 'result remount cannot award twice');
    }
    assert.equal(stored().mastered.length, 8);
    assert.equal(networkCalls, 0, 'all eight missions use only local assets and rules');

    window.location.hash = 'academy/mission/login/story';
    await until(() => q('[data-ac-start]'), 'replay briefing');
    q('[data-ac-start]')!.click();
    await until(() => q('[data-ac-node]'), 'replay active');
    window.location.hash = 'academy';
    await until(() => q('[data-ac-confirm]'), 'navigation asks in themed dialog');
    q('.ac-confirm-cancel')!.click();
    await until(() => window.location.hash.includes('academy/mission/login'), 'cancel restores accepted route');
    assert.match(window.location.hash, /academy\/mission\/login/, 'cancelled navigation preserves route');
    assert.ok(q('[data-ac-node]'));
    window.location.hash = 'academy/mission/not-found';
    await until(() => q('[data-ac-confirm]'), 'second navigation asks again');
    q('.ac-confirm-accept')!.click();
    await until(() => q('.ac-empty'), 'unknown mission gives friendly state');
    assert.equal(networkCalls, 0);
    window.localStorage.setItem('unrelated-setting', 'keep');
    window.location.hash = 'academy';
    await until(() => q('[data-ac-reset]'), 'reset on dashboard');
    q('[data-ac-reset]')!.click();
    await until(() => q('[data-ac-confirm]'), 'reset requires explicit confirmation');
    assert.ok(stored().history.length > 0, 'opening confirmation leaves all progress intact');
    q('.ac-confirm-accept')!.click();
    await delay(40);
    assert.equal(window.localStorage.getItem('unrelated-setting'), 'keep');
    assert.equal(stored()?.history.length ?? 0, 0);
  } finally {
    uiModule?.disposeUI();
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
