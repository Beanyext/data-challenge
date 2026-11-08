import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { setLocale } from '../react/i18n';
import { MissionDiscovery, SkillInsights, filterMissions, missionsForMode, recommendForSkill, skillAverage, skillEvidence } from '../react/academy/Discovery';
import { chooseResponse, completeSession, dailyMission, defaultState, getXP, startSession } from '../react/academy/engine';
import { missions, SKILLS, skillNames } from '../react/academy/missions';
import { isMissionAvailable } from '../react/academy/feature-ui';
import type { AcademyState, Locale, Mission, Session } from '../react/academy/types';

const NOW = new Date('2026-11-08T09:00:00.000Z');
const mission = (id: string) => missions.find(item => item.id === id)!;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const ids = (items: Mission[]) => items.map(item => item.id);
function finish(item: Mission, wrong: 'none' | 'first' | 'all' = 'none', now = NOW): Session {
  let session = startSession(item, 'story', now);
  let injected = false;
  for (let count = 0; session.status === 'active' && count <= item.maxTurns; count++) {
    const node = item.nodes[session.nodeId];
    const soft = node.actions.find(action => action.id.endsWith(':soft'));
    const chooseWrong = soft && (wrong === 'all' || (wrong === 'first' && !injected));
    if (chooseWrong) injected = true;
    session = chooseResponse(session, item, chooseWrong ? soft.id : node.idealActionId);
  }
  assert.equal(session.status, 'completed');
  return session;
}
function append(state: AcademyState, item: Mission, wrong: 'none' | 'first' | 'all' = 'none', index = 0): AcademyState {
  const now = new Date(NOW.getTime() + index * 60_000);
  return completeSession(state, finish(item, wrong, now), item, now);
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
const parsed = (markup: string) => new JSDOM(markup).window.document;

test('mode datasets retain the existing selection, including locked daily/boss and individual-error frequencies', () => {
  const empty = defaultState();
  assert.deepEqual(ids(missionsForMode(empty, 'story')), ids(missions));
  assert.deepEqual(ids(missionsForMode(empty, 'quick')), ['login']);
  assert.deepEqual(ids(missionsForMode(empty, 'boss')), ['boss']);
  assert.deepEqual(ids(missionsForMode(empty, 'mistakes')), ['login']);
  const lockedDay = Array.from({ length: 16 }, (_, index) => new Date(NOW.getTime() + index * 86_400_000))
    .find(date => !isMissionAvailable(empty, dailyMission(missions, date)!))!;
  assert.ok(lockedDay);
  assert.deepEqual(ids(missionsForMode(empty, 'daily', lockedDay)), [dailyMission(missions, lockedDay)!.id]);
  let state = append(empty, mission('login'), 'first');
  state = append(state, mission('login'), 'first', 1);
  state = append(state, mission('order'), 'all', 2);
  assert.ok(state.history.at(-1)!.errors.length > 2, 'different order errors outnumber login errors in total');
  assert.deepEqual(ids(missionsForMode(state, 'mistakes')), ['login'], 'one repeated error outranks several distinct errors');
  const before = clone(state);
  deepFreeze(state);
  for (const mode of ['story', 'quick', 'daily', 'mistakes', 'boss'] as const) missionsForMode(state, mode, NOW);
  assert.deepEqual(state, before);
});

test('localized title, focus skill and difficulty filters combine without altering access or the mode dataset', () => {
  const state = defaultState();
  const source = missionsForMode(state, 'story');
  for (const locale of ['ru', 'kk', 'en'] as Locale[]) {
    const query = `  ${mission('login').title[locale].toLocaleUpperCase(locale)}  `;
    assert.deepEqual(ids(filterMissions(source, { query, skill: 'safety', difficulty: '1' }, locale)), ['login']);
    assert.deepEqual(filterMissions(source, { query, skill: 'accuracy', difficulty: '1' }, locale), []);
  }
  const filtered = filterMissions(source, { query: '', skill: 'accuracy', difficulty: '2' }, 'ru');
  assert.deepEqual(ids(filtered), ['fee', 'dividends']);
  assert.ok(filtered.every(item => !isMissionAvailable(state, item)), 'matching closed missions remain closed');
  const quick = missionsForMode(state, 'quick');
  assert.deepEqual(filterMissions(quick, { query: '', skill: 'empathy', difficulty: 'all' }, 'en'), []);
  assert.deepEqual(ids(filterMissions(quick, { query: '', skill: 'all', difficulty: 'all' }, 'en')), ['login']);
  assert.deepEqual(ids(source), ids(missions));
  assert.deepEqual(state, defaultState());
});

test('story route reflects actual completed-count access, current session mode and demo without fabricated mastery', () => {
  setLocale('ru');
  const state = append(defaultState(), mission('order'));
  state.active = startSession(mission('login'), 'quick', NOW);
  const before = clone(state);
  deepFreeze(state);
  const document = parsed(renderToStaticMarkup(<MissionDiscovery state={state} onDemo={() => { throw new Error('render must not update state'); }}/>));
  assert.equal(document.querySelectorAll('[data-ac-story-path] > li').length, 8);
  assert.equal(document.querySelector('[data-ac-mission="login"]')?.getAttribute('data-ac-status'), 'current');
  assert.equal(document.querySelector('[data-ac-mission="login"]')?.getAttribute('href'), '#academy/mission/login/quick');
  assert.equal(document.querySelector('[data-ac-mission="order"]')?.getAttribute('data-ac-status'), 'mastered');
  assert.equal(document.querySelector('[data-ac-mission="losses"]')?.getAttribute('data-ac-status'), 'available', 'mastered order opens threshold 1 without forcing login first');
  assert.equal(document.querySelector('[data-ac-mission="boss"]')?.getAttribute('data-ac-status'), 'locked');
  assert.ok(document.querySelector('[data-ac-mission="boss"] [data-ac-unlock]')!.textContent!.includes(`1/${mission('boss').unlock}`));
  assert.deepEqual(state, before);
  const demo = { ...defaultState(), demoUnlocked: true };
  const demoDocument = parsed(renderToStaticMarkup(<MissionDiscovery state={demo} onDemo={() => {}}/>));
  assert.equal(demoDocument.querySelectorAll('[data-ac-status="locked"], [data-ac-status="mastered"], .is-complete').length, 0);
  assert.equal(demoDocument.querySelectorAll('[data-ac-demo-access]').length, missions.filter(item => item.unlock > 0).length);
  assert.equal(demo.mastered.length, 0);
  assert.equal(getXP(demo), 0);
});

test('skill details retain the exact average and resolve only saved error IDs to available recommendations', () => {
  let state = append(defaultState(), mission('login'), 'first');
  state = append(state, mission('order'), 'all', 1);
  state = append(state, mission('login'), 'none', 2);
  const before = clone(state);
  deepFreeze(state);
  for (const skill of SKILLS) {
    assert.equal(skillAverage(defaultState(), skill), null);
    assert.equal(skillAverage(state, skill), Math.round(state.history.reduce((total, attempt) => total + attempt.skills[skill], 0) / state.history.length));
    const evidence = skillEvidence(state, skill);
    for (const item of evidence) {
      assert.equal(item.error.skill, skill);
      assert.ok(item.attempt.errors.some(error => error.errorId === item.error.id && error.nodeId === item.nodeId && error.actionId === item.actionId && error.turn === item.turn));
      assert.ok(item.mission.nodes[item.nodeId].actions.some(action => action.id === item.actionId && action.errors.some(error => error.id === item.error.id)));
    }
    assert.ok(isMissionAvailable(state, recommendForSkill(state, skill)!));
  }
  const security = mission('security');
  let failedSession = startSession(security, 'story', NOW);
  failedSession = chooseResponse(failedSession, security, security.nodes[failedSession.nodeId].actions.find(action => action.id.endsWith(':soft'))!.id);
  failedSession = chooseResponse(failedSession, security, security.nodes[failedSession.nodeId].actions.find(action => action.id.endsWith(':dismiss'))!.id);
  const lockedHistory = completeSession(defaultState(), failedSession, security, NOW);
  assert.equal(lockedHistory.mastered.includes('security'), false, 'fixture must keep security locked after failed attempt');
  for (const skill of SKILLS) assert.ok(isMissionAvailable(lockedHistory, recommendForSkill(lockedHistory, skill)!));
  assert.deepEqual(state, before);
});

test('all three languages display honest empty skills and five actual sample-based averages', () => {
  const state = append(defaultState(), mission('login'), 'first');
  for (const locale of ['ru', 'kk', 'en'] as Locale[]) {
    setLocale(locale);
    const empty = parsed(renderToStaticMarkup(<SkillInsights state={defaultState()}/>));
    assert.ok(empty.querySelector('[data-ac-skills-empty]'));
    assert.equal(empty.querySelectorAll('[data-ac-skill-average], [data-ac-error-evidence]').length, 0);
    const document = parsed(renderToStaticMarkup(<SkillInsights state={state}/>));
    assert.equal(document.querySelectorAll('[data-ac-skill]').length, 5);
    for (const skill of SKILLS) {
      const button = document.querySelector(`[data-ac-skill="${skill}"]`)!;
      assert.ok(button.textContent!.includes(skillNames[skill][locale]));
      assert.equal(button.getAttribute('data-ac-skill-average'), String(state.history[0].skills[skill]));
      assert.equal(button.tagName, 'BUTTON');
      assert.equal(button.getAttribute('aria-expanded'), 'false');
    }
    const map = parsed(renderToStaticMarkup(<MissionDiscovery state={state} onDemo={() => {}}/>));
    assert.ok(map.querySelector('[data-ac-mission="login"]')!.textContent!.includes(mission('login').title[locale]));
  }
  setLocale('ru');
});

test('interactive search/reset stays in the selected mode; skill disclosure and demo do not write progress', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://academy.test/#academy/map', pretendToBeVisual: true });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Event', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[name] });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const document = dom.window.document;
  dom.window.localStorage.setItem('freedom-academy:broker:progress:v1', 'untouched-progress');
  dom.window.localStorage.setItem('auth-sentinel', 'untouched-auth');
  const state = append(defaultState(), mission('login'), 'first');
  const before = clone(state);
  const demoChanges: boolean[] = [];
  const click = async (selector: string) => { const element = document.querySelector<HTMLElement>(selector); assert.ok(element, selector); await act(async () => { element.click(); }); };
  const value = async (selector: string, input: string) => {
    const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, input);
    await act(async () => { element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
  };
  try {
    setLocale('en');
    await act(async () => { root.render(<><MissionDiscovery state={state} onDemo={value => demoChanges.push(value)} extraMistakes={<div data-extra-mistakes>Extra practice</div>}/><SkillInsights state={state}/></>); });
    assert.equal(document.querySelectorAll('[data-ac-mission]').length, 8);
    await value('[data-ac-mission-search]', mission('login').title.en);
    await value('[data-ac-skill-filter]', 'safety');
    await value('[data-ac-difficulty-filter]', '1');
    assert.equal(document.querySelectorAll('[data-ac-mission]').length, 1);
    assert.equal(document.querySelector('[data-ac-mission]')?.getAttribute('data-ac-mission'), 'login');
    assert.match(document.querySelector('[data-ac-results-count]')!.textContent!, /1 \/ 8/);
    await click('[data-ac-mode="boss"]');
    assert.ok(document.querySelector('[data-ac-no-missions]'));
    await click('[data-ac-empty-reset]');
    assert.equal(document.querySelectorAll('[data-ac-mission]').length, 1);
    assert.equal(document.querySelector('[data-ac-mission]')?.getAttribute('data-ac-mission'), 'boss');
    assert.equal(document.querySelector('[data-ac-mission]')?.getAttribute('data-ac-status'), 'locked');
    assert.equal(document.querySelector('[data-ac-mode="boss"]')?.getAttribute('aria-pressed'), 'true');
    assert.equal(document.querySelector('[data-extra-mistakes]'), null);
    await click('[data-ac-mode="mistakes"]');
    assert.ok(document.querySelector('[data-extra-mistakes]'));
    await click('[data-ac-mode="quick"]');
    assert.equal(document.querySelector('[data-extra-mistakes]'), null);
    await value('[data-ac-mission-search]', 'no such mission');
    await click('[data-ac-filter-reset]');
    assert.equal(document.querySelectorAll('[data-ac-mission]').length, 1);
    assert.equal(document.querySelector('[data-ac-mission]')?.getAttribute('data-ac-mission'), 'login');
    await click('[data-ac-demo-unlock]');
    assert.deepEqual(demoChanges, [true]);
    const exampleSkill = SKILLS.find(skill => skillEvidence(state, skill).length)!;
    const button = document.querySelector<HTMLButtonElement>(`[data-ac-skill="${exampleSkill}"]`)!;
    button.focus();
    await click(`[data-ac-skill="${exampleSkill}"]`);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
    assert.ok(panel);
    assert.equal(panel.querySelectorAll('[data-ac-error-evidence]').length, skillEvidence(state, exampleSkill).length);
    assert.equal(panel.querySelector('[data-ac-error-evidence] a')?.getAttribute('href'), `#academy/result/${encodeURIComponent(state.history[0].id)}`);
    assert.ok(panel.querySelector('[data-ac-skill-practice]'));
    assert.equal(document.activeElement, button);
    await click(`[data-ac-skill="${exampleSkill}"]`);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelector('[data-ac-skill-detail]'), null);
    assert.deepEqual(state, before);
    assert.equal(dom.window.localStorage.getItem('freedom-academy:broker:progress:v1'), 'untouched-progress');
    assert.equal(dom.window.localStorage.getItem('auth-sentinel'), 'untouched-auth');
    assert.equal(dom.window.localStorage.length, 2);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const name of names) { const descriptor = previous.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as any)[name]; }
    setLocale('ru');
  }
});
