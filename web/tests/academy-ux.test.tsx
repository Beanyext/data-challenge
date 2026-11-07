import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { missions } from '../react/academy/missions';
import { defaultState, startSession, chooseResponse, useHint, completeSession, saveState, loadState, STORAGE_KEY } from '../react/academy/engine';
import type { AcademyState, Mission, Session } from '../react/academy/types';

// These are DOM/state regressions against the built application. Injected scroll
// metrics exercise scroll policy; they do not validate real viewport geometry.
// Each subprocess gets its own module cache and isolated browser/demo profile.
const scenario = process.env.CQA_ACADEMY_UX_SCENARIO;
if (!scenario) {
  const run = promisify(execFile);
  for (const [id, title] of [
    ['conversation', 'Academy keeps the conversation first, explains a wrong answer and respects history reading'],
    ['results', 'Academy prioritizes critical feedback and explains a zero-XP replay without celebration'],
  ]) test(title, { timeout: 20000 }, async () => {
    const env = { ...process.env, CQA_ACADEMY_UX_SCENARIO: id };
    delete env.NODE_TEST_CONTEXT;
    try { await run(process.execPath, [fileURLToPath(import.meta.url)], { cwd: process.cwd(), env, timeout: 15000 }); }
    catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      assert.fail(`${title}\n${failure.stdout || ''}\n${failure.stderr || failure.message}`);
    }
  });
} else {
  test(`isolated Academy UX ${scenario}`, { timeout: 12000 }, async () => {
    const login = missions.find(item => item.id === 'login')!;
    const boss = missions.find(item => item.id === 'boss')!;
    let state: AcademyState = { ...defaultState(), demoUnlocked: true };
    let initialSession: Session | undefined;
    let replaySession: Session | undefined;
    let criticalAttemptId = '';
    let replayAttemptId = '';
    function perfect(mission: Mission, withHint = false) {
      let session = startSession(mission, 'story');
      if (withHint) session = useHint(session);
      while (session.status === 'active') session = chooseResponse(session, mission, mission.nodes[session.nodeId].idealActionId);
      return session;
    }
    if (scenario === 'conversation') {
      initialSession = startSession(login, 'story');
      initialSession = chooseResponse(initialSession, login, login.nodes[login.start].idealActionId);
      state.active = initialSession;
    } else {
      let session = startSession(boss, 'boss');
      let errorsChosen = 0;
      while (session.status === 'active') {
        const node = boss.nodes[session.nodeId];
        const critical = node.actions.find(action => action.critical);
        const soft = node.actions.find(action => !action.critical && action.errors.length && action.next.endsWith('-repair'));
        const action = errorsChosen >= 2 && critical ? critical : errorsChosen < 2 && soft ? soft : node.actions.find(action => action.id === node.idealActionId)!;
        if (action.errors.length) errorsChosen++;
        session = chooseResponse(session, boss, action.id);
      }
      state = completeSession(state, session, boss, new Date(Date.now() - 120000));
      const critical = state.history.at(-1)!;
      assert.equal(critical.critical, true, 'fixture follows a real critical branch');
      assert.equal(critical.passed, false);
      assert.ok(critical.errors.length > 2, 'fixture contains enough real errors to test progressive disclosure');
      criticalAttemptId = critical.id;
      state = completeSession(state, perfect(login, true), login, new Date(Date.now() - 60000));
      replaySession = startSession(login, 'story');
      while (true) {
        const next = chooseResponse(replaySession, login, login.nodes[replaySession.nodeId].idealActionId);
        if (next.status === 'completed') break;
        replaySession = next;
      }
      state.active = replaySession;
      const completedReplay = chooseResponse(replaySession, login, login.nodes[replaySession.nodeId].idealActionId);
      const replay = completeSession(state, completedReplay, login).history.at(-1)!;
      assert.equal(replay.score, 100);
      assert.equal(replay.xpEarned, 0, 'fixture is a real already-rewarded replay');
      assert.ok(replay.newAwards.includes('flawless'), 'zero-XP replay still legitimately opens a badge');
      replayAttemptId = replay.id;
    }
    const errors: string[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error.message));
    const hash = scenario === 'conversation' ? '#academy/mission/login/story' : `#academy/result/${criticalAttemptId}`;
    const dom = new JSDOM(await readFile('web/index.html', 'utf8'), { url: `http://localhost:8000/?lang=ru${hash}`, pretendToBeVisual: true, virtualConsole });
    const { window } = dom;
    const previous = new Map<string, PropertyDescriptor | undefined>();
    function expose(name: string, value: unknown) {
      previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
    }
    for (const name of ['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'Node', 'Element', 'HTMLElement', 'HTMLDetailsElement', 'HTMLInputElement', 'FormData', 'Event', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle']) expose(name, window[name]);
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    expose('matchMedia', window.matchMedia);
    expose('requestAnimationFrame', window.requestAnimationFrame.bind(window));
    expose('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
    let networkCalls = 0;
    expose('fetch', async () => { networkCalls++; throw new Error('Academy must not fetch'); });
    assert.ok(saveState(state, window.localStorage));
    const q = (selector: string) => window.document.querySelector<HTMLElement>(selector);
    const all = (selector: string) => [...window.document.querySelectorAll<HTMLElement>(selector)];
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const pointerClick = (element: HTMLElement) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    async function until(condition: () => unknown, label: string) {
      for (let n = 0; n < 180; n++) { if (condition()) return; await delay(10); }
      assert.fail(label);
    }
    let uiModule: { disposeUI(): void } | undefined;
    try {
      await import(pathToFileURL(path.resolve('web/app.mjs')).href);
      uiModule = await import(pathToFileURL(path.resolve('web/react-ui.js')).href);
      await until(() => q('.academy'), 'Academy mounted');
      if (scenario === 'conversation') {
        const before = initialSession!;
        await until(() => q('[data-ac-node]'), 'saved conversation restored');
        const grid = q('.ac-simulator-grid')!;
        assert.ok(grid.firstElementChild?.classList.contains('ac-chat'), 'chat precedes detailed panels in DOM reading order');
        for (const panel of [q('.ac-briefing')!, q('.ac-coach')!]) {
          assert.ok(q('.ac-chat')!.compareDocumentPosition(panel) & window.Node.DOCUMENT_POSITION_FOLLOWING);
          assert.ok(panel.querySelector('details:not([open])'), 'supplementary panel is a closed disclosure');
        }
        const log = q('.ac-chat-log')!;
        let height = 1400;
        const viewport = 320;
        let top = 120;
        Object.defineProperties(log, {
          scrollHeight: { configurable: true, get: () => height },
          clientHeight: { configurable: true, get: () => viewport },
          scrollTop: { configurable: true, get: () => top, set: value => { top = Math.max(0, Math.min(Number(value), height - viewport)); } },
        });
        log.focus();
        log.dispatchEvent(new window.Event('scroll'));
        await until(() => q('[data-ac-latest]'), 'reading history exposes jump-to-latest control');
        const node = login.nodes[before.nodeId];
        const bad = node.actions.find(action => !action.critical && action.errors.length && action.effects.stress > 0)!;
        const expected = chooseResponse(before, login, bad.id);
        assert.equal(expected.status, 'active');
        pointerClick(q(`[data-ac-choice="${bad.id}"]`)!);
        await until(() => q('.ac-choice.is-sent'), 'chosen answer has an explicit sent state');
        assert.ok(all('.ac-choice').every(button => (button as HTMLButtonElement).disabled), 'all choices lock during processing');
        await until(() => q('[data-ac-node]')!.getAttribute('data-ac-node') === expected.nodeId && !q('.ac-typing'), 'new stage displayed');
        assert.equal(top, 120, 'new turn does not pull a history reader to the bottom');
        assert.equal(window.document.activeElement, log, 'new turn does not steal keyboard focus');
        assert.ok(q('[data-ac-feedback]')!.textContent!.includes(bad.errors[0].explanation.ru));
        assert.equal(q('[data-ac-stress-delta]')!.textContent, `${before.emotion.stress} → ${expected.emotion.stress}`);
        const trustChange = expected.emotion.trust - before.emotion.trust;
        assert.equal(q('[data-ac-trust-delta]')!.textContent, `${trustChange > 0 ? '+' : '−'}${Math.abs(trustChange)}`);
        assert.deepEqual(loadState(window.localStorage).active?.emotion, expected.emotion, 'UI deltas agree with actual engine state');
        assert.ok(q('[data-ac-latest]'), 'latest-message action remains available after new content');
        q('[data-ac-latest]')!.click();
        await until(() => !q('[data-ac-latest]'), 'latest-message action clears after explicit jump');
        assert.equal(top, height - viewport, 'explicit jump reaches the bottom with browser-like clamping');
        height += 300;
        pointerClick(q(`[data-ac-choice="${login.nodes[expected.nodeId].idealActionId}"]`)!);
        await until(() => q('[data-ac-node]')!.getAttribute('data-ac-node') !== expected.nodeId && !q('.ac-typing'), 'recovery response displayed');
        assert.equal(top, height - viewport, 'a reader already at the bottom follows new content');
        assert.equal(window.document.activeElement, log);
        const keyboardNodeId = q('[data-ac-node]')!.getAttribute('data-ac-node')!;
        const keyboardChoice = q(`[data-ac-choice="${login.nodes[keyboardNodeId].idealActionId}"]`)!;
        keyboardChoice.focus();
        keyboardChoice.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
        await until(() => q('[data-ac-node]')!.getAttribute('data-ac-node') !== keyboardNodeId && !q('.ac-typing'), 'keyboard response advances');
        assert.equal(window.document.activeElement, q('.ac-composer h3'), 'keyboard users continue at the next response heading when already at the latest message');
        assert.equal(top, height - viewport);
        const awayNodeId = q('[data-ac-node]')!.getAttribute('data-ac-node')!;
        const awayAction = login.nodes[awayNodeId].actions.find(action => !action.critical && action.errors.length && action.next.endsWith('-repair'))!;
        assert.ok(awayAction, 'next stage has a recoverable response');
        log.scrollTop = 180;
        log.dispatchEvent(new window.Event('scroll'));
        const awayChoice = q(`[data-ac-choice="${awayAction.id}"]`)!;
        awayChoice.focus();
        awayChoice.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
        await until(() => q('[data-ac-node]')!.getAttribute('data-ac-node') !== awayNodeId && !q('.ac-typing'), 'keyboard history-reader response advances');
        assert.equal(top, 180, 'keyboard activation also respects a history reader’s scroll position');
        assert.notEqual(window.document.activeElement, q('.ac-composer h3'), 'no automatic heading focus when reading history');
        assert.ok(q('[data-ac-latest]'));
      } else {
        await until(() => q(`[data-ac-result="${criticalAttemptId}"]`), 'critical result displayed');
        const critical = state.history.find(attempt => attempt.id === criticalAttemptId)!;
        const criticalSource = critical.errors.find(item => boss.nodes[item.nodeId].actions.find(action => action.id === item.actionId)?.critical)!;
        const explanation = boss.nodes[criticalSource.nodeId].actions.find(action => action.id === criticalSource.actionId)!.errors.find(error => error.id === criticalSource.errorId)!.explanation.ru;
        assert.ok(q('.ac-critical')!.textContent!.includes(explanation), 'exact critical reason is visible near the result');
        assert.equal(q('.ac-critical')!.closest('details:not([open])'), null, 'critical reason is not hidden in a disclosure');
        assert.ok(q('.ac-result-summary')!.textContent!.includes('критическим нарушением'));
        assert.equal(all('.ac-skill-row').length, 5, 'all five criteria remain available');
        assert.equal(q('.ac-result.is-celebrating'), null);
        assert.equal(q('.ac-xp-award')!.textContent, '+0 XP');
        assert.equal(q('.ac-result-hero .ac-next-action .ac-primary')!.getAttribute('href'), '#academy/mission/boss/boss', 'failed attempt prioritizes its own replay');
        assert.equal(all('.ac-priority-feedback > .ac-feedback-item').length, 2, 'only two important errors are expanded initially');
        const more = q('.ac-priority-feedback > details') as HTMLDetailsElement;
        assert.ok(more && !more.open);
        assert.equal(more.querySelectorAll('.ac-feedback-item').length, critical.errors.length - 2);
        const transcript = q('[data-ac-history]') as HTMLDetailsElement;
        assert.equal(transcript.open, false, 'full transcript is opt-in');
        transcript.querySelector('summary')!.click();
        await until(() => transcript.open, 'transcript opens using native disclosure');
        const sent = [...transcript.querySelectorAll('.ac-message.is-operator p')].map(element => element.textContent);
        assert.deepEqual(sent, critical.turns.map(turn => boss.nodes[turn.nodeId].actions.find(action => action.id === turn.actionId)!.text.ru), 'history reconstructs exactly one localized response per recorded turn');
        // Finish the prepared replay through the actual UI so this exercises a
        // fresh reward/celebration decision, rather than only a historical view.
        window.location.hash = '#academy/mission/login/story';
        await until(() => q('[data-ac-node]')?.getAttribute('data-ac-node') === replaySession!.nodeId, 'last stage of a perfect replay resumes');
        pointerClick(q(`[data-ac-choice="${login.nodes[replaySession!.nodeId].idealActionId}"]`)!);
        const freshReplay = loadState(window.localStorage).history.at(-1)!;
        assert.equal(freshReplay.id, replayAttemptId);
        assert.equal(freshReplay.xpEarned, 0);
        assert.ok(freshReplay.newAwards.includes('flawless'));
        await until(() => q(`[data-ac-result="${replayAttemptId}"]`), 'zero-XP successful replay displayed');
        assert.equal(q('.ac-result.is-celebrating'), null);
        assert.equal(q('.ac-xp-award')!.textContent, '+0 XP');
        assert.ok(q('.ac-result-hero')!.textContent!.includes('Лучший результат уже учтён. Дополнительный XP начисляется за улучшение.'));
        assert.equal(all('.ac-result-hero .ac-next-action .ac-primary').length, 1, 'one next action is available above detailed feedback');
        assert.ok(q('.ac-result-hero .ac-next-action .ac-primary')!.getAttribute('href')!.startsWith('#academy/mission/'));
        const snapshot = window.localStorage.getItem(STORAGE_KEY);
        window.location.hash = `#academy/result/${criticalAttemptId}`;
        await until(() => q(`[data-ac-result="${criticalAttemptId}"]`), 'critical history reopens');
        window.location.hash = `#academy/result/${replayAttemptId}`;
        await until(() => q(`[data-ac-result="${replayAttemptId}"]`), 'replay history reopens');
        assert.equal(q('.ac-result.is-celebrating'), null, 'historical result never replays a celebration');
        assert.equal(window.localStorage.getItem(STORAGE_KEY), snapshot, 'reading results does not mutate progress or reward a replay');
      }
      assert.equal(networkCalls, 0);
      assert.deepEqual(errors, []);
    } finally {
      uiModule?.disposeUI();
      dom.window.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
}
