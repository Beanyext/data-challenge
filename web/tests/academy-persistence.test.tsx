import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeProgress } from '../react/academy/persistence';
import { chooseResponse, completeSession, defaultState, getXP, loadState, saveState, startSession } from '../react/academy/engine';
import { missions } from '../react/academy/missions';
import type { AcademyState, Attempt, Session } from '../react/academy/types';

const state = (changes: Partial<AcademyState> = {}): AcademyState => ({
  version: 1, dataset: 'broker-v1', contributions: {}, best: {}, mastered: [], awards: {},
  completedDays: [], history: [], active: null, demoUnlocked: false, ...changes,
});
const attempt = (index: number, changes: Partial<Attempt> = {}): Attempt => ({
  id: `attempt-${String(index).padStart(3, '0')}`, missionId: 'login', mode: 'story',
  finishedAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
  score: 100, rawScore: 100, skills: { empathy: 100, accuracy: 100, safety: 100, resolution: 100, professionalism: 100 },
  passed: true, critical: false, completedGoals: [], missedGoals: [], passedChecks: [], missedChecks: [],
  errors: [], turns: [], hintedNodes: [], initial: { stress: 60, trust: 40 }, final: { stress: 0, trust: 100 },
  xpEarned: 0, newAwards: [], ...changes,
});
const session = (id: string): Session => ({
  id, missionId: 'login', mode: 'story', nodeId: 'welcome', emotion: { stress: 60, trust: 40 },
  events: [], turns: [], critical: false, hintedNodes: [], status: 'active', startedAt: '2026-11-08T10:00:00.000Z',
});
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => freezeDeep(item));
    Object.freeze(value);
  }
  return value;
}

test('progress merge takes mission maxima rather than adding repeated XP and unions ordered milestones', () => {
  const local = state({ contributions: { login: 90, fee: 150 }, best: { login: 90, fee: 100 }, mastered: ['login', 'fee'], completedDays: ['2026-11-08', '2026-11-06'] });
  const stored = state({ contributions: { login: 100, order: 100 }, best: { login: 100, order: 100 }, mastered: ['order', 'login'], completedDays: ['2026-11-07', '2026-11-08'] });
  const merged = mergeProgress(local, stored);
  assert.deepEqual(merged.contributions, { fee: 150, login: 100, order: 100 });
  assert.equal(Object.values(merged.contributions).reduce((sum, xp) => sum + xp, 0), 350);
  assert.deepEqual(merged.best, { fee: 100, login: 100, order: 100 });
  assert.deepEqual(merged.mastered, ['fee', 'login', 'order']);
  assert.deepEqual(merged.completedDays, ['2026-11-06', '2026-11-07', '2026-11-08']);
  assert.deepEqual(mergeProgress(merged, stored), merged, 'reprocessing the same stored snapshot is idempotent');
});

test('attempt union prefers stored IDs, keeps the newest 50 in chronological order, and breaks time ties by ID', () => {
  const local = state({ contributions: { login: 100 }, best: { login: 100 }, mastered: ['login'], history: Array.from({ length: 40 }, (_, index) => attempt(index)) });
  const canonical = attempt(20, { newAwards: ['first'], xpEarned: 100 });
  const stored = state({ contributions: { login: 100 }, best: { login: 100 }, mastered: ['login'], awards: { first: canonical.finishedAt }, history: Array.from({ length: 40 }, (_, index) => index + 20 === 20 ? canonical : attempt(index + 20)) });
  const merged = mergeProgress(local, stored);
  assert.equal(merged.history.length, 50);
  assert.equal(new Set(merged.history.map(item => item.id)).size, 50);
  assert.equal(merged.history[0].id, 'attempt-010');
  assert.equal(merged.history.at(-1)!.id, 'attempt-059');
  assert.equal(merged.history.find(item => item.id === canonical.id), canonical, 'persisted same-ID record is canonical');
  assert.deepEqual(mergeProgress(merged, stored), merged);
  const sameTime = '2026-11-08T10:00:00.000Z';
  const tied = mergeProgress(state({ history: [attempt(2, { id: 'b', finishedAt: sameTime })] }), state({ history: [attempt(1, { id: 'a', finishedAt: sameTime })] }));
  assert.deepEqual(tied.history.map(item => item.id), ['a', 'b']);
});

test('merge keeps earliest valid awards and local preferences without mutating frozen inputs', () => {
  const early = '2026-11-06T10:00:00.000Z', late = '2026-11-08T10:00:00.000Z';
  const local = freezeDeep(state({ active: session('local-session'), demoUnlocked: true, history: [attempt(2), attempt(1)], mastered: ['order', 'login'], completedDays: ['2026-11-08', '2026-11-07'], awards: { first: late, empathy: early, defender: 'invalid', flawless: 'invalid' } }));
  const stored = freezeDeep(state({ active: session('other-tab-session'), demoUnlocked: false, history: [attempt(3)], mastered: ['fee'], completedDays: ['2026-11-06'], awards: { first: early, empathy: late, defender: late, flawless: 'also invalid', professional: early } }));
  const localBefore = JSON.stringify(local), storedBefore = JSON.stringify(stored);
  const merged = mergeProgress(local, stored);
  assert.deepEqual(merged.awards, { defender: late, empathy: early, first: early, professional: early });
  assert.deepEqual(mergeProgress(merged, stored).awards, merged.awards);
  assert.equal(merged.active, local.active);
  assert.equal(merged.demoUnlocked, true);
  assert.equal(mergeProgress(state(), stored).active, null, 'a local cleared session must not be resurrected');
  assert.equal(JSON.stringify(local), localBefore);
  assert.equal(JSON.stringify(stored), storedBefore);
  assert.notEqual(merged.history, local.history);
  assert.notEqual(merged.mastered, local.mastered);
  assert.notEqual(merged.contributions, local.contributions);
  assert.notEqual(merged.best, stored.best);
});

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function completedLogin(withErrors: boolean, finishedAt: string): AcademyState {
  const login = missions.find(item => item.id === 'login')!;
  let active = startSession(login, 'story', new Date(finishedAt));
  while (active.status === 'active') {
    const node = login.nodes[active.nodeId];
    const action = withErrors && ['clarify', 'plan'].includes(node.id) ? node.actions.find(item => item.id.endsWith(':hard'))!.id : node.idealActionId;
    active = chooseResponse(active, login, action);
  }
  return completeSession(defaultState(), active, login, new Date(finishedAt));
}

test('independent valid profiles reconcile duplicate XP and only retain a better local result delta', () => {
  for (const storedWithErrors of [false, true]) {
    const local = freezeDeep(completedLogin(false, '2026-11-08T12:00:00.000Z'));
    const stored = freezeDeep(completedLogin(storedWithErrors, '2026-11-08T11:00:00.000Z'));
    const localBefore = JSON.stringify(local), storedBefore = JSON.stringify(stored);
    assert.equal(saveState(local, memoryStorage()), true, 'local offline profile is independently valid');
    assert.equal(saveState(stored, memoryStorage()), true, 'persisted profile is independently valid');
    assert.equal(local.history[0].score, 100);
    assert.equal(stored.history[0].score, storedWithErrors ? 90 : 100);
    const merged = mergeProgress(local, stored);
    const storage = memoryStorage();
    assert.equal(saveState(merged, storage), true, 'merged history must pass the existing persistence validator');
    assert.equal(getXP(merged), 100, 'one mission contribution cannot become 200 XP');
    assert.equal(merged.history.length, 2, 'both real attempts remain in the review history');
    const canonical = merged.history.find(item => item.id === stored.history[0].id)!;
    const recovered = merged.history.find(item => item.id === local.history[0].id)!;
    assert.equal(canonical, stored.history[0], 'stored canonical award is unchanged');
    assert.equal(canonical.xpEarned, storedWithErrors ? 90 : 100);
    assert.equal(recovered.xpEarned, storedWithErrors ? 10 : 0, 'local award is only the unaccounted contribution');
    const { xpEarned: _beforeAward, ...beforeResult } = local.history[0];
    const { xpEarned: _afterAward, ...afterResult } = recovered;
    assert.deepEqual(afterResult, beforeResult, 'scores, dialogue, IDs and feedback are never reevaluated or rewritten');
    assert.deepEqual(loadState(storage), merged);
    assert.deepEqual(mergeProgress(merged, stored), merged, 'ledger reconciliation is idempotent');
    assert.equal(JSON.stringify(local), localBefore);
    assert.equal(JSON.stringify(stored), storedBefore);
  }
});
