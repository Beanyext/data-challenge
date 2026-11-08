import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { act, type ReactNode } from 'react';
import { setLocale } from '../react/i18n';
import { missions } from '../react/academy/missions';
import { defaultState, startSession, chooseResponse, completeSession, WEIGHTS, SKILLS, STORAGE_KEY } from '../react/academy/engine';
import { AttemptComparison, ReviewTranscript, ScoreBreakdown, scoreContributions, orderAttempts, compareAttemptErrors } from '../react/academy/ReviewTools';
import type { Attempt, Mission, Session } from '../react/academy/types';

const login = missions.find(item => item.id === 'login')!;
const finish = (session: Session, mission: Mission): Session => {
  let current = session;
  while (current.status === 'active') current = chooseResponse(current, mission, mission.nodes[current.nodeId].idealActionId);
  return current;
};
const asAttempt = (session: Session, mission: Mission, minute = 0) => completeSession(defaultState(), session, mission, new Date(Date.UTC(2026, 10, 8, 10, minute))).history[0];
function fixture(mission: Mission, mode: 'perfect' | 'recover' | 'critical', minute = 0) {
  let session = startSession(mission, 'story', new Date(Date.UTC(2026, 10, 8, 9, minute)));
  let changed = false;
  while (session.status === 'active') {
    const node = mission.nodes[session.nodeId];
    const choice = !changed && mode === 'recover' ? node.actions.find(item => !item.critical && item.errors.length && item.next.endsWith('-repair')) : !changed && mode === 'critical' ? node.actions.find(item => item.critical) : undefined;
    if (choice) changed = true;
    session = chooseResponse(session, mission, choice?.id ?? node.idealActionId);
  }
  if (mode !== 'perfect') assert.ok(changed, `real ${mode} branch available`);
  return asAttempt(session, mission, minute);
}
function arithmeticFixtures() {
  const attempts: Attempt[] = [];
  for (const mission of missions) {
    let prefix = startSession(mission, 'story');
    while (prefix.status === 'active') {
      const node = mission.nodes[prefix.nodeId];
      for (const action of node.actions) {
        const after = chooseResponse(prefix, mission, action.id);
        attempts.push(asAttempt(finish(after, mission), mission));
        if (after.status === 'active') {
          for (const followup of mission.nodes[after.nodeId].actions) attempts.push(asAttempt(finish(chooseResponse(after, mission, followup.id), mission), mission));
        }
      }
      prefix = chooseResponse(prefix, mission, node.idealActionId);
    }
  }
  return attempts;
}

function mountDOM() {
  const dom = new JSDOM('<!doctype html><div class="academy"><div id="root"></div></div><button id="outside">Outside</button>', { url: 'http://localhost/?lang=ru#academy', pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLDetailsElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'Node', 'localStorage']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name as keyof Window] });
  }
  previous.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, writable: true, value: true });
  let reduced = true;
  const scrolls: { element: HTMLElement; options?: ScrollIntoViewOptions | boolean }[] = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function (options) { scrolls.push({ element: this, options }); };
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: reduced }) });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const q = <T extends Element = HTMLElement>(selector: string) => dom.window.document.querySelector<T>(selector)!;
  const qa = <T extends Element = HTMLElement>(selector: string) => [...dom.window.document.querySelectorAll<T>(selector)];
  async function render(node: ReactNode) { await act(async () => { root.render(node); }); }
  async function click(element: HTMLElement) { await act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 1 })); }); }
  async function select(element: HTMLSelectElement, value: string) { await act(async () => { element.value = value; element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); }
  async function close() {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; }
    setLocale('ru');
  }
  return { dom, q, qa, render, click, select, close, scrolls, reduceMotion(value: boolean) { reduced = value; } };
}

test('Review arithmetic uses actual saved criteria, rounding and the existing critical cap without changing attempts', async () => {
  const attempts = arithmeticFixtures();
  const fractional = attempts.find(attempt => !Number.isInteger(scoreContributions(attempt).sum));
  const capped = attempts.find(attempt => attempt.critical && attempt.rawScore > 49);
  const uncappedCritical = attempts.find(attempt => attempt.critical && attempt.rawScore < 49);
  assert.ok(fractional, 'real prepared mission branches exercise fractional weighting');
  assert.ok(capped, 'real critical branch reaches the existing cap');
  assert.ok(uncappedCritical, 'critical cap must not raise a low score to 49');
  const cases = [fixture(login, 'perfect'), fractional, capped, uncappedCritical];
  const before = JSON.stringify(cases);
  const ui = mountDOM();
  ui.dom.window.localStorage.setItem(STORAGE_KEY, 'unchanged real-progress sentinel');
  try {
    for (const locale of ['ru', 'kk', 'en'] as const) {
      setLocale(locale);
      for (const attempt of cases) {
        await ui.render(<ScoreBreakdown attempt={attempt}/>);
        const weighted = SKILLS.reduce((sum, skill) => sum + attempt.skills[skill] * WEIGHTS[skill] / 100, 0);
        assert.equal(Number(ui.q('[data-ac-weighted-sum]').getAttribute('data-ac-weighted-sum')), weighted);
        assert.equal(Number(ui.q('[data-ac-rounded-score]').getAttribute('data-ac-rounded-score')), Math.round(weighted));
        assert.equal(Number(ui.q('[data-ac-final-score]').getAttribute('data-ac-final-score')), attempt.score);
        assert.equal(attempt.score, attempt.critical ? Math.min(49, Math.round(weighted)) : Math.round(weighted));
        assert.equal(ui.qa('[data-ac-contribution]').length, 5);
        const sumWidths = ui.qa<HTMLElement>('.ac-breakdown-segment').reduce((sum, element) => sum + parseFloat(element.style.width), 0);
        assert.ok(Math.abs(sumWidths - weighted) < 1e-10, 'composite widths correspond to the 100-point scale');
        const detail = ui.q<HTMLDetailsElement>('[data-ac-contribution]');
        const wasOpen = detail.open;
        await ui.click(detail.querySelector('summary')!);
        assert.equal(detail.open, !wasOpen, 'native disclosure is interactive');
        if (attempt.critical) {
          assert.equal(attempt.skills.safety, 0);
          assert.ok(ui.q('[data-ac-score-cap]').textContent?.includes(`min(${attempt.rawScore}, 49) = ${attempt.score}`));
        } else assert.equal(ui.q('[data-ac-score-cap]'), null);
      }
    }
    assert.equal(JSON.stringify(cases), before, 'review does not reevaluate or mutate saved attempts');
    assert.equal(ui.dom.window.localStorage.getItem(STORAGE_KEY), 'unchanged real-progress sentinel');
  } finally { await ui.close(); }
});

test('Comparison requires different attempts from one mission and reports saved differences and critical status', async () => {
  const critical = fixture(login, 'critical', 0);
  const earlier = fixture(login, 'recover', 1);
  const repeated = fixture(login, 'recover', 2);
  const perfect = fixture(login, 'perfect', 3);
  const otherMission = fixture(missions.find(item => item.id === 'order')!, 'perfect', 4);
  const history = [perfect, otherMission, repeated, critical, earlier];
  const before = JSON.stringify(history);
  const ui = mountDOM();
  try {
    await ui.render(<AttemptComparison history={[]}/>);
    assert.ok(ui.q('[data-ac-compare-empty]'));
    assert.equal(ui.qa('[data-ac-compare-skill]').length, 0, 'empty history contains no made-up criteria');
    await ui.render(<AttemptComparison history={[earlier]}/>);
    assert.ok(ui.q('[data-ac-compare-empty]'));
    await ui.render(<AttemptComparison history={history}/>);
    const a = ui.q<HTMLSelectElement>('[data-ac-compare-attempt="0"]');
    const b = ui.q<HTMLSelectElement>('[data-ac-compare-attempt="1"]');
    await ui.select(a, critical.id);
    await ui.select(b, perfect.id);
    assert.equal(ui.q('[data-ac-compare-summary="earlier"]').getAttribute('data-ac-attempt-id'), critical.id);
    assert.equal(ui.q('[data-ac-compare-summary="later"]').getAttribute('data-ac-attempt-id'), perfect.id);
    assert.ok(ui.q('[data-ac-compare-summary="earlier"]').textContent?.includes('Есть критическое нарушение'));
    assert.equal(Number(ui.q('[data-ac-score-delta]').textContent), perfect.score - critical.score);
    assert.ok(perfect.score - critical.score > 0);
    assert.ok(ui.q('.ac-compare-critical').textContent, 'positive difference retains the critical warning');
    assert.equal(ui.qa('[data-ac-compare-skill]').length, 5);
    for (const skill of SKILLS) assert.equal(Number(ui.q(`[data-ac-compare-skill="${skill}"] [data-ac-skill-delta]`).textContent), perfect.skills[skill] - critical.skills[skill]);
    assert.equal([...a.options].find(option => option.value === perfect.id)?.disabled, true, 'same attempt cannot be selected twice');
    assert.equal([...a.options].some(option => option.value === otherMission.id), false, 'another mission cannot enter the pair');
    await ui.select(a, earlier.id);
    await ui.select(b, repeated.id);
    assert.deepEqual(compareAttemptErrors(earlier, repeated).repeated, [...new Set(earlier.errors.map(error => error.errorId))]);
    assert.ok(ui.q('[data-ac-compare-errors="repeated"]').textContent?.includes('(1)'));
    await ui.select(b, perfect.id);
    assert.equal(ui.q('[data-ac-compare-errors="repeated"] li'), null);
    assert.equal(ui.qa('[data-ac-compare-errors="absent"] li').length, new Set(earlier.errors.map(error => error.errorId)).size);
    assert.equal(ui.qa('[data-ac-compare-goal]').length, login.objectives.length);
    await ui.select(ui.q<HTMLSelectElement>('[data-ac-compare-mission]'), otherMission.missionId);
    assert.ok(ui.q('[data-ac-compare-empty]'), 'a mission with one attempt stays insufficient');
    assert.equal(ui.qa('[data-ac-compare-summary]').length, 0);
    assert.equal(JSON.stringify(history), before, 'sorting and selection never mutate the history');
    const sameTimeA = fixture(login, 'perfect', 5), sameTimeB = fixture(login, 'perfect', 5);
    assert.deepEqual(orderAttempts([sameTimeA, sameTimeB]).map(item => item.id), [sameTimeA.id, sameTimeB.id].sort((a, b) => a.localeCompare(b)), 'matching timestamps use stable ID order');
  } finally { await ui.close(); }
});

test('Completed conversation jumps only on explicit review or timeline actions and retains exact turn feedback', async () => {
  // JSDOM verifies navigation/focus policy, not actual viewport geometry.
  const attempt = fixture(login, 'recover');
  const error = attempt.errors[0];
  const source = login.nodes[error.nodeId];
  const chosen = source.actions.find(action => action.id === error.actionId)!;
  const ideal = source.actions.find(action => action.id === source.idealActionId)!;
  const explanation = chosen.errors.find(item => item.id === error.errorId)!;
  const before = JSON.stringify(attempt);
  const ui = mountDOM();
  try {
    await ui.render(<ReviewTranscript attempt={attempt} mission={login}/>);
    assert.equal(ui.q<HTMLDetailsElement>('[data-ac-history]').open, false);
    assert.equal(ui.scrolls.length, 0);
    assert.equal(ui.qa('[data-ac-review-stage]').length, attempt.turns.length, 'timeline shows only recorded turns, including repair branches');
    assert.ok(ui.qa('[data-ac-node-id]').some(element => element.getAttribute('data-ac-node-id')?.endsWith('-repair')));
    await ui.click(ui.q<HTMLDetailsElement>('[data-ac-history]').querySelector('summary')!);
    await ui.click(ui.q<HTMLDetailsElement>(`[data-ac-inline-review="${error.turn}"]`).querySelector('summary')!);
    assert.equal(ui.scrolls.length, 0, 'ordinary disclosure reading does not auto-scroll');
    const outside = ui.q<HTMLButtonElement>('#outside');
    outside.focus();
    await ui.render(<ReviewTranscript attempt={attempt} mission={login}/>);
    assert.equal(ui.dom.window.document.activeElement, outside, 'ordinary render does not steal focus');
    await ui.render(<ReviewTranscript attempt={attempt} mission={login} target={{ turn: error.turn, revision: 1 }}/>);
    assert.equal(ui.q<HTMLDetailsElement>('[data-ac-history]').open, true);
    assert.equal(ui.q<HTMLDetailsElement>(`[data-ac-inline-review="${error.turn}"]`).open, true);
    const reply = ui.q<HTMLElement>(`[data-ac-review-turn="${error.turn}"] .ac-review-reply`);
    assert.equal(ui.dom.window.document.activeElement, reply);
    assert.equal(ui.scrolls.length, 1);
    assert.deepEqual(ui.scrolls[0].options, { behavior: 'auto', block: 'center' }, 'reduced motion uses an immediate jump');
    assert.ok(reply.textContent?.includes(chosen.text.ru));
    const review = ui.q(`[data-ac-inline-review="${error.turn}"]`);
    assert.ok(review.textContent?.includes(explanation.explanation.ru));
    assert.ok(review.textContent?.includes(ideal.text.ru));
    outside.focus();
    for (const locale of ['kk', 'en', 'ru'] as const) {
      setLocale(locale);
      await ui.render(<ReviewTranscript attempt={attempt} mission={login} target={{ turn: error.turn, revision: 1 }}/>);
      assert.equal(ui.scrolls.length, 1, 'language rerender is not navigation');
      assert.equal(ui.dom.window.document.activeElement, outside);
      assert.ok(review.textContent?.includes(explanation.explanation[locale]));
      assert.ok(reply.textContent?.includes(chosen.text[locale]));
    }
    ui.reduceMotion(false);
    await ui.render(<ReviewTranscript attempt={attempt} mission={login} target={{ turn: error.turn, revision: 2 }}/>);
    assert.equal(ui.scrolls.length, 2, 'new revision allows another explicit jump to the same turn');
    assert.deepEqual(ui.scrolls.at(-1)?.options, { behavior: 'smooth', block: 'center' });
    await ui.click(ui.q('[data-ac-review-stage="2"]'));
    assert.equal(ui.q('[data-ac-review-stage="2"]').getAttribute('aria-current'), 'step');
    assert.equal(ui.dom.window.document.activeElement, ui.q('[data-ac-review-turn="2"] .ac-review-reply'));
    await ui.click(ui.q('[data-ac-review-latest]'));
    assert.equal(ui.dom.window.document.activeElement, ui.q(`[data-ac-review-turn="${attempt.turns.length}"] .ac-review-reply`));
    const count = ui.scrolls.length;
    await ui.render(<ReviewTranscript attempt={attempt} mission={login} target={{ turn: attempt.turns.length + 1, revision: 3 }}/>);
    assert.equal(ui.scrolls.length, count, 'future turns cannot become navigation targets');
    assert.equal(JSON.stringify(attempt), before);
    assert.equal(ui.dom.window.localStorage.getItem(STORAGE_KEY), null, 'review controls never write progress');
  } finally { await ui.close(); }
});
