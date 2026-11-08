import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { dayKey, defaultState } from '../react/academy/engine';
import { missions } from '../react/academy/missions';
import { setLocale } from '../react/i18n';
import { DRILL_SCENARIOS, getMicroDrill } from '../react/academy/microDrills';
import { DrillCollection, GuidedStartButton, MicroDrillButton, WeeklyPlan } from '../react/academy/LearningTools';
import { WEEKLY_PLAN_KEY, emptyWeeklyPlan, movePlannedMission, plannedCompletion, readWeeklyPlan, rememberWeeklyPlan, removePlannedMission, retryPendingWeeklyPlanSave, scheduleMission, shiftPlanDate, validPlanDate, weekDates, writeWeeklyPlan } from '../react/academy/weeklyPlan';
import type { Attempt, Locale } from '../react/academy/types';

const available = new Set(missions.map(mission => mission.id));
test('weekly calendar uses Qyzylorda dates across midnight, month/year and DST boundaries', () => {
  assert.equal(dayKey(new Date('2026-11-08T18:59:59Z')), '2026-11-08');
  assert.equal(dayKey(new Date('2026-11-08T19:00:00Z')), '2026-11-09');
  assert.deepEqual(weekDates('2026-11-08'), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  assert.equal(weekDates('2026-01-01')[0], '2025-12-29');
  assert.equal(shiftPlanDate('2024-02-28', 1), '2024-02-29');
  assert.equal(shiftPlanDate('2026-03-08', 1), '2026-03-09');
  const before = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.deepEqual(weekDates('2026-03-08'), ['2026-03-02','2026-03-03','2026-03-04','2026-03-05','2026-03-06','2026-03-07','2026-03-08']);
    assert.equal(dayKey(new Date('2026-03-08T19:00:00Z')), '2026-03-09');
  } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
  assert.equal(validPlanDate('2026-02-29'), false);
  assert.equal(validPlanDate('2026-2-8'), false);
});

test('planning deduplicates date and mission, permits other weeks and preserves locked saved entries', () => {
  const empty = emptyWeeklyPlan();
  assert.equal(scheduleMission(empty, '2026-11-09', 'boss', new Set(['login'])), empty);
  assert.equal(scheduleMission(empty, '2026-02-30', 'login', available), empty);
  const first = scheduleMission(empty, '2026-11-09', 'login', available);
  assert.equal(scheduleMission(first, '2026-11-09', 'login', available), first);
  const second = scheduleMission(first, '2026-11-16', 'login', available);
  assert.equal(second.entries.length, 2);
  const merged = movePlannedMission(second, '2026-11-09', '2026-11-16', 'login', available);
  assert.deepEqual(merged.entries, [{ date: '2026-11-16', missionId: 'login' }]);
  assert.equal(movePlannedMission(merged, '2026-11-16', '2026-11-17', 'login', new Set()), merged);
  const moved = movePlannedMission(merged, '2026-11-16', '2026-11-23', 'login', available);
  assert.deepEqual(moved.entries, [{ date: '2026-11-23', missionId: 'login' }]);
  assert.deepEqual(removePlannedMission(moved, '2026-11-23', 'login').entries, []);
  assert.deepEqual(first.entries, [{ date: '2026-11-09', missionId: 'login' }], 'input not mutated');
});

test('plan completion is derived only from matching actual attempt day and separates failure from pass', () => {
  const entry = { date: '2026-11-09', missionId: 'login' };
  const attempt = { missionId: 'login', finishedAt: '2026-11-08T19:01:00Z', passed: false };
  assert.deepEqual(plannedCompletion(entry, []), { status: 'planned', count: 0 });
  assert.deepEqual(plannedCompletion(entry, [attempt]), { status: 'completed', count: 1 });
  assert.deepEqual(plannedCompletion(entry, [attempt, { ...attempt, passed: true }]), { status: 'passed', count: 2 });
  assert.deepEqual(plannedCompletion(entry, [{ ...attempt, finishedAt: '2026-11-08T18:59:00Z' }, { ...attempt, missionId: 'boss' }, { ...attempt, finishedAt: 'invalid' }]), { status: 'planned', count: 0 });
});

test('weekly persistence validates version and content and accesses only its own key', () => {
  const values = new Map<string, string>([['freedom-academy:broker:progress:v1', 'unchanged-progress']]);
  const accessed: string[] = [];
  const storage = { getItem(key: string) { accessed.push(key); return values.get(key) ?? null; }, setItem(key: string, value: string) { accessed.push(key); values.set(key, value); } };
  const plan = scheduleMission(emptyWeeklyPlan(), '2026-11-09', 'boss', available);
  assert.equal(writeWeeklyPlan({ ...plan, history: ['private'], identity: 'operator' } as typeof plan, storage), true);
  assert.deepEqual(readWeeklyPlan(storage).plan, plan);
  assert.equal(values.get('freedom-academy:broker:progress:v1'), 'unchanged-progress');
  assert.ok(accessed.every(key => key === WEEKLY_PLAN_KEY));
  assert.equal(values.get(WEEKLY_PLAN_KEY)?.includes('identity'), false);
  assert.equal(values.get(WEEKLY_PLAN_KEY)?.includes('history'), false);
  values.set(WEEKLY_PLAN_KEY, '{broken'); assert.equal(readWeeklyPlan(storage).warning, 'corrupt');
  values.set(WEEKLY_PLAN_KEY, '{"version":2,"entries":[]}'); assert.equal(readWeeklyPlan(storage).warning, 'incompatible');
  values.set(WEEKLY_PLAN_KEY, '{"version":1,"entries":[{"date":"2026-02-30","missionId":"login"}]}'); assert.equal(readWeeklyPlan(storage).warning, 'corrupt');
  values.set(WEEKLY_PLAN_KEY, '{"version":1,"entries":[{"date":"2026-11-09","missionId":"unknown"}]}'); assert.equal(readWeeklyPlan(storage).warning, 'corrupt');
  assert.equal(readWeeklyPlan({ getItem() { throw new Error('denied'); } }).warning, 'unavailable');
  assert.equal(writeWeeklyPlan(plan, { setItem() { throw new Error('quota'); } }), false);
});

test('eight isolated drills have three translated choices, one correct and real error-skill mappings', () => {
  assert.deepEqual(DRILL_SCENARIOS.map(item => item.missionId), ['login','order','losses','withdrawal','fee','dividends','security','boss']);
  const snapshot = JSON.stringify(missions);
  for (const mission of missions) {
    const errors = Object.values(mission.nodes).flatMap(node => node.actions.flatMap(action => action.errors));
    for (const error of [undefined, ...errors]) {
      const drill = getMicroDrill(mission.id, error?.id)!;
      assert.equal(drill.choices.length, 3); assert.equal(drill.choices.filter(choice => choice.correct).length, 1);
      if (error) assert.equal(drill.skill, error.skill);
      for (const locale of ['ru','kk','en'] as Locale[]) {
        assert.ok(drill.context[locale].length > 80);
        for (const choice of drill.choices) { assert.ok(choice.text[locale].length > 10); assert.ok(choice.explanation[locale].length > 25); }
      }
    }
  }
  assert.equal(getMicroDrill('unknown'), undefined);
  assert.equal(JSON.stringify(missions), snapshot);
});

test('tour, drills and weekly UI are optional, localized and isolated from progress', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://local.test/?lang=ru', pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const expose = (key: string, value: unknown) => { if (!previous.has(key)) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); };
  for (const key of ['window','document','navigator','localStorage','HTMLElement','HTMLDialogElement','Event','MouseEvent','Node']) expose(key, (dom.window as any)[key]);
  expose('IS_REACT_ACT_ENVIRONMENT', true);
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; this.querySelector<HTMLButtonElement>('button')?.focus(); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let network = 0;
  expose('fetch', () => { network++; throw new Error('no network'); });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const query = <T extends HTMLElement = HTMLElement>(selector: string) => dom.window.document.querySelector<T>(selector)!;
  const click = async (selector: string) => { await act(async () => query(selector).click()); };
  const state = defaultState();
  const beforeState = JSON.stringify(state);
  const progressKey = 'freedom-academy:broker:progress:v1';
  dom.window.localStorage.setItem(progressKey, beforeState);
  try {
    setLocale('ru');
    await act(async () => root.render(<div className="academy"><GuidedStartButton /><MicroDrillButton missionId="login" /></div>));
    assert.equal(query('dialog'), null, 'no auto-open');
    query('[data-ac-guided-start]').focus(); await click('[data-ac-guided-start]');
    assert.equal(query('[data-tour-step]')?.dataset.tourStep, '1');
    assert.equal(query<HTMLButtonElement>('[data-ac-tour-next]').disabled, true);
    await click('.ac-learning-choice'); await click('[data-ac-tour-next]'); assert.equal(query('[data-tour-step]').dataset.tourStep, '2');
    await click('[data-ac-tour-back]'); assert.equal(query('[data-tour-step]').dataset.tourStep, '1');
    await click('[data-ac-tour-next]'); await click('[data-ac-tour-next]'); assert.equal(query('[data-tour-step]').dataset.tourStep, '3');
    assert.equal(query('[data-ac-tour-next]'), null, 'exactly three steps');
    await click('[data-ac-tour-repeat]'); assert.equal(query('[data-tour-step]').dataset.tourStep, '1');
    await click('[data-ac-tour-skip]'); assert.equal(query('dialog'), null);
    assert.equal(dom.window.document.activeElement, query('[data-ac-guided-start]'), 'focus returns to opener');
    query('[data-ac-micro-drill]').focus(); await click('[data-ac-micro-drill]');
    assert.equal(dom.window.document.querySelectorAll('.ac-learning-choice').length, 3);
    await click('.ac-learning-choice'); assert.ok(query('.ac-learning-feedback.needs-work'));
    assert.match(query('.ac-learning-feedback').textContent!, /Пример подходящего ответа/);
    await click('.ac-learning-drill > .ac-button'); assert.equal(query('.ac-learning-feedback'), null);
    await act(async () => query('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })));
    assert.equal(query('dialog'), null); assert.equal(dom.window.document.activeElement, query('[data-ac-micro-drill]'));
    for (const locale of ['kk','en'] as Locale[]) {
      setLocale(locale); await act(async () => root.render(<div className="academy"><GuidedStartButton /><MicroDrillButton missionId="security" /></div>));
      assert.match(query('[data-ac-guided-start]').textContent!, locale === 'en' ? /How training works/ : /Жаттығу қалай өтеді/);
      await click('[data-ac-micro-drill]'); assert.match(query('.ac-learning-context').textContent!, locale === 'en' ? /login|sign-in|access/i : /кіру|қолжетімділік/i);
      await click('[data-ac-dialog-close]');
    }
    setLocale('ru');
    const week = weekDates();
    rememberWeeklyPlan({ version: 1, entries: [{ date: week[0], missionId: 'login' }, { date: week[0], missionId: 'boss' }] });
    const finished = `${week[0]}T08:00:00Z`;
    const plannedState = { ...state, history: [{ missionId: 'login', finishedAt: finished, passed: false, errors: [] } as unknown as Attempt] };
    await act(async () => root.render(<div className="academy"><WeeklyPlan state={plannedState} /></div>));
    assert.equal(dom.window.document.querySelectorAll('.ac-learning-day').length, 7);
    assert.ok(query('.ac-learning-plan-item.is-completed')); assert.match(query('.ac-learning-plan-item.is-completed').textContent!, /нужна доработка/);
    assert.equal(dom.window.document.querySelectorAll('.ac-learning-plan-item.is-planned a').length, 0, 'locked saved mission cannot start');
    assert.equal(dom.window.document.querySelectorAll('input[type="checkbox"]').length, 0, 'no manual completion');
    await act(async () => root.render(<div className="academy"><WeeklyPlan state={{ ...plannedState, history: [{ ...plannedState.history[0], passed: true }] }} /></div>));
    assert.ok(query('.ac-learning-plan-item.is-passed'));
    await act(async () => root.render(<div className="academy"><DrillCollection state={state} /></div>));
    assert.match(query('.ac-learning-section').textContent!, /пока нет ошибок/);
    assert.equal(dom.window.localStorage.getItem(progressKey), beforeState);
    assert.equal(JSON.stringify(state), beforeState);
    assert.equal(network, 0);
    const memoryPlan = scheduleMission(emptyWeeklyPlan(), week[0], 'login', available);
    expose('localStorage', { getItem() { return null; }, setItem() { throw new Error('quota'); } });
    assert.equal(rememberWeeklyPlan(memoryPlan).warning, 'unavailable');
    assert.equal(retryPendingWeeklyPlanSave(), false);
    Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, writable: true, configurable: true });
    assert.equal(retryPendingWeeklyPlanSave(), true);
    assert.deepEqual(readWeeklyPlan(dom.window.localStorage).plan, memoryPlan);
  } finally {
    await act(async () => root.unmount()); setLocale('ru'); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
  }
});
