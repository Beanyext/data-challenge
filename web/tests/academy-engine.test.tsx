import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AWARD_IDS, LocalResponseSource, SKILLS, STORAGE_KEY, WEIGHTS, chooseResponse,
  classifyFreeText, completeSession, dailyMission, dayKey, defaultState, emotionName,
  evaluateSession, getXP, levelInfo, loadProgress, loadState, recommendMission,
  resetProgress, saveState, startSession, streak, updateEmotion, useHint,
} from '../react/academy/engine';
import { missions } from '../react/academy/missions';
import type { Action, AcademyState, Localized, Locale, Mission, Session, Skill } from '../react/academy/types';

const NOW = new Date('2026-11-08T09:00:00.000Z');
const locales: Locale[] = ['ru', 'kk', 'en'];
const l = (text: string): Localized => ({ ru: text, kk: text, en: text });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const mission = (id: string) => missions.find(item => item.id === id)!;
const source = new LocalResponseSource();
function perfect(item: Mission, starting?: Session): Session {
  let session = starting ?? startSession(item, 'story', NOW);
  for (let index = 0; session.status === 'active' && index <= item.maxTurns; index++) {
    session = chooseResponse(session, item, item.nodes[session.nodeId].idealActionId);
  }
  assert.equal(session.status, 'completed', `${item.id} must terminate`);
  return session;
}
function firstWrong(item: Mission): Session {
  const initial = startSession(item, 'story', NOW);
  const action = item.nodes[initial.nodeId].actions.find(action => action.id !== item.nodes[initial.nodeId].idealActionId && !action.critical)!;
  return chooseResponse(initial, item, action.id);
}
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}
function fixture(): Mission {
  const allEvents = ['goal', ...SKILLS];
  const action = (id: string, changes: Partial<Action> = {}): Action => ({
    id, text: l(id), tags: ['solution'], effects: { stress: -20, trust: 20 }, events: allEvents,
    errors: [], next: 'done', reaction: l('reaction'), ...changes,
  });
  return {
    id: 'fixture', version: 1, order: 1, title: l('fixture'), summary: l('fixture'), client: l('client'), objective: l('goal'),
    difficulty: 1, duration: 3, maxXP: 100, unlock: 0, start: 'start', initial: { stress: 66, trust: 40 }, maxTurns: 4,
    objectives: [{ id: 'goal', label: l('goal'), required: true }],
    checks: SKILLS.map(skill => ({ id: skill, event: skill, skill, points: 100, label: l(skill) })), knowledge: [l('demo')],
    nodes: {
      start: { id: 'start', title: l('start'), prompt: l('help'), hint: l('hint'), idealActionId: 'good', actions: [
        action('good', { tags: ['empathy', 'solution'] }),
        action('soft', { tags: ['empathy'], events: ['empathy'], next: 'failed', effects: { stress: -60, trust: 40 } }),
        action('critical', { tags: ['promise'], critical: true }),
        action('unsafe', { tags: ['unsafe'], critical: true }),
      ] },
      done: { id: 'done', title: l('done'), prompt: l('done'), hint: l('done'), idealActionId: '', actions: [], terminal: 'resolved' },
      failed: { id: 'failed', title: l('failed'), prompt: l('failed'), hint: l('failed'), idealActionId: '', actions: [], terminal: 'unresolved' },
    },
  };
}

test('broker catalogue has eight complete multilingual graphs with valid references and reachable endings', () => {
  assert.deepEqual(missions.map(item => item.id), ['login', 'order', 'losses', 'withdrawal', 'fee', 'dividends', 'security', 'boss']);
  const translated = (value: Localized) => locales.forEach(locale => assert.ok(typeof value[locale] === 'string' && value[locale].trim().length, `missing ${locale}`));
  for (const item of missions) {
    [item.title, item.summary, item.client, item.objective, ...item.knowledge].forEach(translated);
    assert.equal(item.maxXP, item.difficulty === 1 ? 100 : item.difficulty === 2 ? 150 : 200);
    assert.ok(item.nodes[item.start]);
    const seenActions = new Set<string>();
    const reachable = new Set<string>([item.start]);
    const pending = [item.start];
    while (pending.length) {
      const node = item.nodes[pending.shift()!];
      [node.title, node.prompt, node.hint].forEach(translated);
      if (node.terminal) { assert.equal(node.actions.length, 0); continue; }
      assert.ok(node.actions.length >= 3 && node.actions.length <= 4, `${item.id}/${node.id}`);
      assert.ok(node.actions.some(action => action.id === node.idealActionId));
      for (const action of node.actions) {
        assert.ok(!seenActions.has(action.id), `duplicate action ${action.id}`);
        seenActions.add(action.id);
        translated(action.text); translated(action.reaction);
        if (action.tenseReaction) translated(action.tenseReaction);
        action.errors.forEach(error => translated(error.explanation));
        for (const next of [action.next, action.transition?.next].filter(Boolean) as string[]) {
          assert.ok(item.nodes[next], `missing ${item.id}/${next}`);
          if (!reachable.has(next)) { reachable.add(next); pending.push(next); }
        }
      }
    }
    assert.equal(reachable.size, Object.keys(item.nodes).length, `${item.id}: unreachable node`);
    assert.ok([...reachable].some(id => item.nodes[id].terminal === 'resolved'));
    assert.ok([...reachable].some(id => item.nodes[id].terminal === 'unresolved'));
    item.objectives.forEach(goal => translated(goal.label));
    item.checks.forEach(check => translated(check.label));
    for (const skill of SKILLS) assert.equal(item.checks.filter(check => check.skill === skill).reduce((sum, check) => sum + check.points, 0), 100);
  }
});

test('every mission has a substantive 4–6 turn perfect path with all five skills and required goals', () => {
  for (const item of missions) {
    const session = perfect(item);
    const evaluation = evaluateSession(session, item);
    assert.ok(session.turns.length >= 4 && session.turns.length <= 6, item.id);
    assert.equal(evaluation.passed, true, item.id);
    assert.equal(evaluation.score, 100, item.id);
    assert.deepEqual(evaluation.skills, Object.fromEntries(SKILLS.map(skill => [skill, 100])));
    assert.equal(evaluation.missedGoals.length, 0);
    assert.equal(evaluation.missedChecks.length, 0);
    assert.equal(evaluation.errors.length, 0);
    assert.equal(item.nodes[session.nodeId].terminal, 'resolved');
  }
});

test('emotions are bounded independently and mood thresholds include both sides of each boundary', () => {
  assert.deepEqual(updateEmotion({ stress: 5, trust: 99 }, { stress: -20, trust: 20 }), { stress: 0, trust: 100 });
  assert.deepEqual(updateEmotion({ stress: 98, trust: 2 }, { stress: 20, trust: -20 }), { stress: 100, trust: 0 });
  for (const [value, name] of [[0, 'calm'], [25, 'calm'], [26, 'concerned'], [45, 'concerned'], [46, 'irritated'], [65, 'irritated'], [66, 'angry'], [85, 'angry'], [86, 'furious'], [100, 'furious']] as const) assert.equal(emotionName(value), name);
});

test('response validation is deterministic, rejects foreign actions, and makes duplicate clicks harmless', () => {
  const item = mission('login');
  const initial = startSession(item, 'story', NOW);
  const id = item.nodes[initial.nodeId].idealActionId;
  assert.deepEqual(chooseResponse(initial, item, id), source.choose(initial, item, id));
  const next = chooseResponse(initial, item, id);
  assert.equal(chooseResponse(next, item, id), next);
  assert.throws(() => chooseResponse(initial, item, 'invented-action'), /invalid_action/);
  assert.throws(() => chooseResponse(initial, mission('order'), id), /mission_mismatch/);
  assert.equal(initial.turns.length, 0);
  assert.deepEqual(initial.emotion, item.initial);
});

test('conditional transition uses emotion after the action; maxTurns stops a nonterminal graph', () => {
  const item = fixture();
  item.initial.stress = 85;
  item.nodes.start.actions[0].effects.stress = 5;
  item.nodes.start.actions[0].transition = { stressGte: 90, next: 'failed' };
  const high = chooseResponse(startSession(item, 'story', NOW), item, 'good');
  assert.equal(high.nodeId, 'failed');
  assert.equal(high.turns[0].tense, true);
  item.initial.stress = 84;
  assert.equal(chooseResponse(startSession(item, 'story', NOW), item, 'good').nodeId, 'done');
  const limited = fixture();
  limited.maxTurns = 1;
  limited.nodes.start.actions[0].next = 'again';
  limited.nodes.again = { ...limited.nodes.start, id: 'again' };
  const stopped = chooseResponse(startSession(limited, 'story', NOW), limited, 'good');
  assert.equal(stopped.status, 'completed');
  assert.equal(evaluateSession(stopped, limited).passed, false);
});

test('wrong answers change emotion, branch into recovery, and preserve their explained penalty', () => {
  for (const item of missions) {
    const wrong = firstWrong(item);
    assert.notEqual(wrong.nodeId, perfect(item).turns[0].nextNodeId, item.id);
    assert.ok(wrong.emotion.stress >= item.initial.stress, item.id);
    if (wrong.status === 'active') {
      const recovered = perfect(item, wrong);
      const result = evaluateSession(recovered, item);
      assert.ok(result.errors.length > 0, item.id);
      assert.equal(result.errors[0].turn, 1);
      assert.ok(result.score < 100, item.id);
      assert.equal(result.passed, true, `${item.id} should allow recovery after a soft error`);
    }
  }
});

test('each stage can recover a soft error; dismissing that recovery ends an unsuccessful attempt', () => {
  for (const item of missions) {
    let prefix = startSession(item, 'story', NOW);
    while (prefix.status === 'active') {
      const node = item.nodes[prefix.nodeId];
      const soft = node.actions.find(action => action.id.endsWith(':soft'))!;
      assert.ok(soft, `${item.id}/${node.id} needs a recoverable alternative`);
      const branch = chooseResponse(prefix, item, soft.id);
      assert.equal(branch.status, 'active', `${item.id}/${node.id}: soft error should allow correction`);
      const recovered = perfect(item, branch);
      const result = evaluateSession(recovered, item);
      assert.equal(result.passed, true, `${item.id}/${node.id}`);
      assert.ok(result.score < 100);
      assert.ok(result.errors.some(error => error.actionId === soft.id));
      const recoveryNode = item.nodes[branch.nodeId];
      const dismiss = recoveryNode.actions.find(action => action.id.endsWith(':dismiss'))!;
      assert.ok(dismiss);
      const unresolved = chooseResponse(branch, item, dismiss.id);
      assert.equal(unresolved.status, 'completed');
      assert.equal(evaluateSession(unresolved, item).passed, false);
      prefix = chooseResponse(prefix, item, node.idealActionId);
    }
  }
});

test('all reachable critical choices fail with zero safety and cannot award XP', () => {
  let criticalCount = 0;
  for (const item of missions) {
    let session = startSession(item, 'story', NOW);
    while (session.status === 'active') {
      for (const action of item.nodes[session.nodeId].actions.filter(action => action.critical)) {
        criticalCount++;
        const failed = perfect(item, chooseResponse(session, item, action.id));
        const result = evaluateSession(failed, item);
        assert.equal(result.critical, true);
        assert.equal(result.passed, false);
        assert.equal(result.skills.safety, 0);
        assert.ok(result.score <= 49);
        assert.equal(getXP(completeSession(defaultState(), failed, item, NOW)), 0);
      }
      session = chooseResponse(session, item, item.nodes[session.nodeId].idealActionId);
    }
  }
  assert.ok(criticalCount >= 8, 'prepared broker safety and financial-communication choices must exist');
});

test('criterion events count once and errors have traceable one-time deductions before weighted rounding', () => {
  const item = fixture();
  const action = item.nodes.start.actions[0];
  action.events.push('accuracy', 'accuracy', 'goal');
  item.checks.push(clone(item.checks[0]));
  const error = { id: 'e1', skill: 'accuracy' as Skill, penalty: 20, explanation: l('Unverified information') };
  action.errors = [error, clone(error)];
  const result = evaluateSession(chooseResponse(startSession(item, 'story', NOW), item, 'good'), item);
  assert.equal(result.skills.accuracy, 80);
  assert.equal(result.skills.empathy, 100);
  assert.equal(result.score, 95);
  assert.equal(result.errors.length, 1);
  assert.equal(result.score, Math.round(SKILLS.reduce((sum, skill) => sum + result.skills[skill] * WEIGHTS[skill] / 100, 0)));
});

test('critical financial guarantee overrides otherwise perfect goals, score, calmness and trust', () => {
  const item = fixture();
  const session = chooseResponse(startSession(item, 'story', NOW), item, 'critical');
  const result = evaluateSession(session, item);
  assert.equal(result.rawScore, 75);
  assert.equal(result.score, 49);
  assert.equal(result.passed, false);
  assert.equal(result.skills.safety, 0);
  assert.equal(getXP(completeSession(defaultState(), session, item, NOW)), 0);
});

test('politeness and a calm customer do not substitute for required objectives or resolution', () => {
  const item = fixture();
  const session = chooseResponse(startSession(item, 'story', NOW), item, 'soft');
  assert.equal(emotionName(session.emotion.stress), 'calm');
  const result = evaluateSession(session, item);
  assert.equal(result.passed, false);
  assert.deepEqual(result.missedGoals, ['goal']);
  const missingGoal = fixture();
  missingGoal.nodes.start.actions[0].events = [...SKILLS];
  const notResolved = evaluateSession(chooseResponse(startSession(missingGoal, 'story', NOW), missingGoal, 'good'), missingGoal);
  assert.equal(notResolved.score, 100);
  assert.equal(notResolved.passed, false);
});

test('injected events or a cleared critical flag cannot forge a completed evaluation', () => {
  const item = fixture();
  const session = chooseResponse(startSession(item, 'story', NOW), item, 'critical');
  assert.throws(() => evaluateSession({ ...session, critical: false }, item), /invalid_session/);
  assert.throws(() => evaluateSession({ ...session, events: [...session.events, 'made-up'] }, item), /invalid_session/);
  assert.throws(() => evaluateSession(startSession(item, 'story', NOW), item), /unfinished_session/);
});

test('XP is only the improvement in a mission contribution; completion and replay do not farm rewards', () => {
  const item = mission('login');
  const recovered = perfect(item, firstWrong(item));
  let state = completeSession(defaultState(), recovered, item, NOW);
  const firstXP = Math.round(item.maxXP * state.history[0].score / 100);
  assert.equal(getXP(state), firstXP);
  assert.equal(state.history[0].xpEarned, firstXP);
  assert.equal(completeSession(state, recovered, item, NOW), state);
  const best = perfect(item);
  state = completeSession(state, best, item, NOW);
  assert.equal(getXP(state), item.maxXP);
  assert.equal(state.history.at(-1)!.xpEarned, item.maxXP - firstXP);
  state = completeSession(state, perfect(item), item, NOW);
  assert.equal(state.history.at(-1)!.xpEarned, 0);
  assert.equal(state.mastered.length, 1);
  assert.equal(getXP(state), item.maxXP);
  assert.deepEqual(state.history.at(-1)!.newAwards, []);
});

test('failed attempts preserve XP and levels while first completion and streak remain meaningful', () => {
  const item = mission('login');
  let state = completeSession(defaultState(), perfect(item), item, NOW);
  const initialXP = getXP(state);
  let bad = firstWrong(item);
  if (bad.status === 'active') {
    const node = item.nodes[bad.nodeId];
    bad = chooseResponse(bad, item, node.actions.find(action => action.id !== node.idealActionId)!.id);
  }
  assert.equal(evaluateSession(bad, item).passed, false);
  state = completeSession(state, bad, item, new Date('2026-11-09T09:00:00.000Z'));
  assert.equal(getXP(state), initialXP);
  assert.equal(levelInfo(getXP(state)).level, levelInfo(initialXP).level);
  assert.equal(state.history.at(-1)!.xpEarned, 0);
  assert.equal(streak(state, new Date('2026-11-09T09:00:00.000Z')), 2);
  const firstFailed = completeSession(defaultState(), bad, item, NOW);
  assert.ok(firstFailed.awards.first);
  assert.equal(firstFailed.mastered.length, 0);
});

test('awards enforce exact conditions and unlock once; hints affect flawless only', () => {
  let state = defaultState();
  for (const item of missions.slice(0, 5)) state = completeSession(state, perfect(item), item, NOW);
  assert.ok(state.awards.first && state.awards.flawless && state.awards.professional && state.awards.empathy);
  assert.equal(state.awards.defender, undefined);
  const security = mission('security');
  state = completeSession(state, perfect(security), security, NOW);
  assert.ok(state.awards.defender);
  const awardTimes = { ...state.awards };
  state = completeSession(state, perfect(security), security, NOW);
  assert.deepEqual(state.awards, awardTimes);
  assert.deepEqual(state.history.at(-1)!.newAwards, []);
  const login = mission('login');
  const hinted = perfect(login, useHint(startSession(login, 'story', NOW)));
  const withHint = completeSession(defaultState(), hinted, login, NOW);
  assert.equal(withHint.history[0].score, 100);
  assert.equal(withHint.awards.flawless, undefined);
  assert.equal(getXP(withHint), login.maxXP);
  assert.equal(useHint(hinted), hinted);
  const once = useHint(startSession(login, 'story', NOW));
  assert.equal(useHint(once), once);
  assert.ok(Object.keys(state.awards).every(id => AWARD_IDS.includes(id as typeof AWARD_IDS[number])));
});

test('comeback needs at least 15 points over a genuine previous best', () => {
  const item = fixture();
  let state = completeSession(defaultState(), chooseResponse(startSession(item, 'story', NOW), item, 'soft'), item, NOW);
  assert.equal(state.awards.comeback, undefined);
  state = completeSession(state, perfect(item), item, NOW);
  assert.ok(state.awards.comeback);
  assert.ok(state.history.at(-1)!.newAwards.includes('comeback'));
  const almost = fixture();
  almost.nodes.start.actions[0].errors = [{ id: 'minor', skill: 'accuracy', penalty: 40, explanation: l('minor') }];
  let narrow = completeSession(defaultState(), perfect(almost), almost, NOW);
  assert.equal(narrow.history[0].score, 90);
  narrow = completeSession(narrow, perfect(item), item, NOW);
  assert.equal(narrow.awards.comeback, undefined);
  const threshold = fixture();
  threshold.nodes.start.actions[0].errors = [{ id: 'missed-fact', skill: 'accuracy', penalty: 60, explanation: l('missed fact') }];
  let exactly = completeSession(defaultState(), perfect(threshold), threshold, NOW);
  assert.equal(exactly.history[0].score, 85);
  exactly = completeSession(exactly, perfect(item), item, NOW);
  assert.ok(exactly.awards.comeback);
});

test('empathy award requires both initial stress at least 46 and a reduction of at least 25', () => {
  for (const [initial, reduction, expected] of [[46, 25, true], [45, 25, false], [46, 24, false]] as const) {
    const item = fixture(); item.initial.stress = initial;
    item.nodes.start.actions[0].effects.stress = -reduction;
    const state = completeSession(defaultState(), perfect(item), item, NOW);
    assert.equal(Boolean(state.awards.empathy), expected, `${initial}/${reduction}`);
  }
});

test('history stays at 50 while contributions, mastery and best results survive older entries', () => {
  const item = mission('login');
  let state = defaultState();
  for (let count = 0; count < 55; count++) state = completeSession(state, perfect(item), item, NOW);
  assert.equal(state.history.length, 50);
  assert.equal(getXP(state), item.maxXP);
  assert.equal(state.best.login, 100);
  assert.deepEqual(state.mastered, ['login']);
  const storage = memoryStorage();
  assert.equal(saveState(state, storage), true);
  assert.deepEqual(loadState(storage), state);
});

test('level calculation starts at one, advances every 100 XP and has a clear maximum', () => {
  assert.deepEqual(levelInfo(0), { level: 1, total: 0, progress: 0, remaining: 100, rank: 0, maximum: false });
  assert.equal(levelInfo(99).level, 1);
  assert.equal(levelInfo(100).level, 2);
  assert.equal(levelInfo(150).remaining, 50);
  assert.deepEqual(levelInfo(1900), { level: 20, total: 1900, progress: 100, remaining: 0, rank: 5, maximum: true });
  assert.equal(levelInfo(10000).level, 20);
});

test('daily challenge is fixed within a local calendar day and uses the same XP contribution', () => {
  const first = new Date('2026-11-07T19:05:00.000Z');
  const last = new Date('2026-11-08T18:55:00.000Z');
  assert.equal(dayKey(first), '2026-11-08');
  assert.equal(dailyMission(missions, first)?.id, dailyMission([...missions].reverse(), last)?.id);
  assert.equal(dailyMission([], first), undefined);
  const item = dailyMission(missions, first)!;
  let state = completeSession(defaultState(), perfect(item, startSession(item, 'daily', first)), item, first);
  state = completeSession(state, perfect(item, startSession(item, 'daily', last)), item, last);
  assert.equal(state.history.at(-1)!.xpEarned, 0);
  assert.equal(getXP(state), item.maxXP);
  assert.deepEqual(state.completedDays, ['2026-11-08']);
});

test('streak tolerates an unfinished current day and breaks after a full missed day', () => {
  const state = { ...defaultState(), completedDays: ['2026-11-06', '2026-11-07', '2026-11-08'] };
  assert.equal(streak(state, new Date('2026-11-08T10:00:00.000Z')), 3);
  assert.equal(streak(state, new Date('2026-11-09T10:00:00.000Z')), 3);
  assert.equal(streak(state, new Date('2026-11-10T10:00:00.000Z')), 0);
  assert.equal(streak(defaultState(), NOW), 0);
});

test('recommendations respect unlocking and select a failed mission for deliberate practice', () => {
  assert.equal(recommendMission(defaultState(), missions)?.id, 'login');
  const item = mission('login');
  let session = firstWrong(item);
  if (session.status === 'active') session = chooseResponse(session, item, item.nodes[session.nodeId].actions.find(action => action.id !== item.nodes[session.nodeId].idealActionId)!.id);
  const state = completeSession(defaultState(), session, item, NOW);
  assert.equal(recommendMission(state, missions)?.id, item.id);
  assert.equal(recommendMission(defaultState(), []), undefined);
});

test('all prepared choices classify identically in RU, KK and EN without language-specific state', () => {
  for (const item of missions) {
    let session = startSession(item, 'story', NOW);
    while (session.status === 'active') {
      for (const action of item.nodes[session.nodeId].actions) for (const locale of locales) {
        assert.deepEqual(classifyFreeText(action.text[locale], session, item, locale), { actionId: action.id, reason: 'matched' }, `${item.id}/${action.id}/${locale}`);
      }
      session = chooseResponse(session, item, item.nodes[session.nodeId].idealActionId);
    }
  }
});

test('unknown, ambiguous, punctuation-only and overlong free replies leave the session untouched', () => {
  const item = fixture();
  item.nodes.start.actions.push({ ...item.nodes.start.actions[1], id: 'another-soft', text: l('other') });
  const session = startSession(item, 'story', NOW);
  const before = clone(session);
  for (const input of ['', '!!!', 'unrelated words about the weather', 'x'.repeat(3001)]) assert.equal(classifyFreeText(input, session, item, 'en').reason, 'unknown');
  assert.equal(classifyFreeText('Понимаю ваши переживания', session, item, 'ru').reason, 'ambiguous');
  assert.deepEqual(session, before);
});

test('empathy alone cannot complete a real mission or replace its clarification and solution stages', () => {
  for (const item of missions) for (const locale of locales) {
    let session = startSession(item, 'story', NOW);
    const input = { ru: 'Понимаю ваши переживания', kk: 'Сіздің уайымыңызды түсінемін', en: 'I understand your concern' }[locale];
    for (let index = 0; index < item.maxTurns && session.status === 'active'; index++) {
      const response = classifyFreeText(input, session, item, locale);
      if (!response.actionId) break;
      session = chooseResponse(session, item, response.actionId);
    }
    if (session.status === 'completed') assert.equal(evaluateSession(session, item).passed, false, `${item.id}/${locale}`);
    else assert.ok(session.events.length < item.objectives.length + item.checks.length, `${item.id}/${locale}`);
  }
});

test('unsafe requests and financial promises cannot be masked by empathy or a proposed check', () => {
  const item = fixture();
  const session = startSession(item, 'story', NOW);
  const dangerous: [Locale, string, string][] = [
    ['ru', 'Понимаю. Отправьте мне пароль, я проверю.', 'unsafe'],
    ['ru', 'Понимаю, пришлите SMS-код.', 'unsafe'],
    ['ru', 'Понимаю, гарантирую доходность.', 'critical'],
    ['ru', 'Понимаю, инвестиции без риска.', 'critical'],
    ['ru', 'Понимаю, рисков нет, проверю обращение.', 'critical'],
    ['ru', 'Понимаю, риски исключены.', 'critical'],
    ['ru', 'Понимаю, акции обязательно вырастут.', 'critical'],
    ['ru', 'Понимаю, точно компенсируем убытки.', 'critical'],
    ['ru', 'Понимаю, купите эти акции.', 'unsafe'],
    ['ru', 'Понимаю, купите ABC.', 'unsafe'],
    ['en', 'I understand, send me your password and I will check.', 'unsafe'],
    ['en', 'I understand, I guarantee investment returns.', 'critical'],
    ['en', 'I understand, this investment has no risk.', 'critical'],
    ['en', 'I understand, this has zero risk.', 'critical'],
    ['en', 'I understand, the shares will definitely rise.', 'critical'],
    ['en', 'I understand, buy this stock.', 'unsafe'],
    ['en', 'I understand, buy ABC.', 'unsafe'],
    ['kk', 'Түсінемін. Құпиясөзді жіберіңіз.', 'unsafe'],
    ['kk', 'Түсінемін. Кіріске кепілдік беремін.', 'critical'],
    ['kk', 'Түсінемін. Тәуекел жоқ.', 'critical'],
    ['kk', 'Түсінемін. Акцияны сатып алыңыз.', 'unsafe'],
  ];
  for (const [locale, input, expected] of dangerous) {
    const response = classifyFreeText(input, session, item, locale);
    assert.equal(response.actionId, expected, input);
    const result = evaluateSession(chooseResponse(session, item, response.actionId!), item);
    assert.equal(result.passed, false, input);
    assert.equal(result.skills.safety, 0, input);
    assert.equal(getXP(completeSession(defaultState(), chooseResponse(session, item, response.actionId!), item, NOW)), 0);
  }
});

test('safe negative formulations never become secret requests or investment guarantees', () => {
  const item = fixture();
  const session = startSession(item, 'story', NOW);
  const safe: [Locale, string][] = [
    ['ru', 'Не сообщайте пароль. Понимаю ваши переживания.'],
    ['ru', 'Доходность не гарантирована. Предлагаю проверить обращение.'],
    ['ru', 'Я не могу гарантировать компенсацию. Понимаю.'],
    ['ru', 'Нельзя гарантировать доходность.'],
    ['ru', 'Не покупайте эти акции по моему совету.'],
    ['en', 'Do not send your password. I understand.'],
    ['en', 'Investment returns are not guaranteed.'],
    ['en', 'I cannot guarantee compensation.'],
    ['en', 'Do not buy this stock on my advice.'],
    ['kk', 'Құпиясөзді жібермеңіз.'],
    ['kk', 'Кіріске кепілдік берілмейді.'],
    ['kk', 'Акцияны сатып алмаңыз.'],
  ];
  for (const [locale, input] of safe) {
    const result = classifyFreeText(input, session, item, locale);
    const action = item.nodes.start.actions.find(action => action.id === result.actionId);
    assert.ok(!action?.critical, input);
  }
  assert.equal(classifyFreeText('Не сообщайте пароль, но пришлите мне SMS-код.', session, item, 'ru').actionId, 'unsafe');
  assert.equal(classifyFreeText('I cannot guarantee returns, but I promise compensation.', session, item, 'en').actionId, 'critical');
});

test('risky text without a corresponding critical choice stays unknown instead of choosing a helpful answer', () => {
  const item = fixture();
  item.nodes.start.actions = item.nodes.start.actions.filter(action => !action.critical);
  const session = startSession(item, 'story', NOW);
  for (const [locale, input] of [['ru', 'Понимаю, гарантирую доходность и проверю обращение.'], ['en', 'I understand and will check, buy this stock.'], ['kk', 'Түсінемін, құпиясөзді жіберіңіз, тексеремін.']] as [Locale, string][]) assert.equal(classifyFreeText(input, session, item, locale).reason, 'unknown');
});

test('progress saves stable graph IDs, restores an active session, and strips unknown and free-text fields', () => {
  const item = mission('login');
  let active = useHint(startSession(item, 'story', NOW));
  active = chooseResponse(active, item, item.nodes[active.nodeId].idealActionId);
  const state = { ...defaultState(), active };
  const withPrivateText = { ...state, draft: 'SECRET FREE TEXT', active: { ...active, rawText: 'SECRET FREE TEXT', turns: active.turns.map(turn => ({ ...turn, rawText: 'SECRET FREE TEXT' })) } };
  const storage = memoryStorage();
  assert.equal(saveState(withPrivateText, storage), true);
  assert.ok(!storage.getItem(STORAGE_KEY)!.includes('SECRET FREE TEXT'));
  assert.deepEqual(loadProgress(storage), { state });
  const restored = loadState(storage).active!;
  assert.deepEqual(evaluateSession(perfect(item, restored), item), evaluateSession(perfect(item, active), item));
});

test('completed progress round-trips without repeated XP or achievement celebration', () => {
  const item = mission('security');
  const session = perfect(item);
  const state = completeSession(defaultState(), session, item, NOW);
  const storage = memoryStorage();
  assert.equal(saveState(state, storage), true);
  const restored = loadState(storage);
  assert.equal(getXP(restored), item.maxXP);
  assert.equal(completeSession(restored, session, item, NOW), restored);
  assert.equal(restored.active, null);
});

test('a refresh during the final client reaction safely restores and finalizes the completed active graph', () => {
  const item = mission('login');
  const session = perfect(item);
  const storage = memoryStorage();
  assert.equal(saveState({ ...defaultState(), active: session }, storage), true);
  const restored = loadState(storage);
  assert.equal(restored.active?.status, 'completed');
  const completed = completeSession(restored, restored.active!, item, NOW);
  assert.equal(completed.active, null);
  assert.equal(completed.history[0].id, session.id);
  assert.equal(getXP(completed), item.maxXP);
  const duplicateActive = completeSession({ ...completed, active: session }, session, item, NOW);
  assert.equal(duplicateActive.active, null);
  assert.equal(duplicateActive.history.length, 1);
  assert.equal(getXP(duplicateActive), item.maxXP);
});

test('missing, unavailable, quota-exceeded and malformed storage are handled without throwing', () => {
  assert.deepEqual(loadProgress(memoryStorage()), { state: defaultState() });
  assert.equal(loadProgress({ getItem: () => { throw new Error('blocked'); } }).warning, 'unavailable');
  assert.equal(saveState(defaultState(), { setItem: () => { throw new Error('quota'); } }), false);
  assert.equal(resetProgress({ removeItem: () => { throw new Error('blocked'); } }), false);
  assert.equal(loadProgress(memoryStorage({ [STORAGE_KEY]: '{bad json' })).warning, 'corrupt');
  assert.equal(loadProgress(memoryStorage({ [STORAGE_KEY]: '[]' })).warning, 'corrupt');
  assert.equal(loadProgress(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ ...defaultState(), version: 2 }) })).warning, 'incompatible');
});

test('nested corruption, invalid bounds, unknown IDs and forged replay data cannot be loaded', () => {
  const item = mission('login');
  const valid = completeSession(defaultState(), perfect(item), item, NOW);
  const corruptions: ((state: AcademyState) => void)[] = [
    state => { state.contributions.login = 9999; },
    state => { state.contributions.login = -1; },
    state => { state.best.login = 101; },
    state => { state.history[0].skills.accuracy = '100' as unknown as number; },
    state => { state.history[0].turns[0].emotion.stress = 101; },
    state => { state.history[0].turns[0].actionId = 'unknown'; },
    state => { state.history[0].turns[0].nextNodeId = item.start; },
    state => { state.history[0].xpEarned = 101; },
    state => { state.history[0].missedGoals = ['invented']; },
    state => { state.awards.unknown = NOW.toISOString(); },
    state => { state.completedDays = ['2026-02-31']; },
    state => { state.mastered.push('nonexistent'); },
    state => { state.history.push(clone(state.history[0])); },
    state => { state.active = { ...startSession(item, 'story', NOW), events: ['forged-event'] }; },
    state => { state.active = { ...startSession(item, 'story', NOW), hintedNodes: ['unknown-node'] }; },
  ];
  for (const mutate of corruptions) {
    const state = clone(valid); mutate(state);
    const result = loadProgress(memoryStorage({ [STORAGE_KEY]: JSON.stringify(state) }));
    assert.equal(result.warning, 'corrupt');
    assert.deepEqual(result.state, defaultState());
    assert.equal(saveState(state, memoryStorage()), false);
  }
});

test('old bank progress is isolated, explicitly identified and never imported or cleared with broker reset', () => {
  const oldKey = 'freedom-academy:progress:v1';
  const oldBank = JSON.stringify({ version: 1, contributions: { login: 100, fraud: 200 }, mastered: ['login', 'fraud'] });
  const storage = memoryStorage({ [oldKey]: oldBank, auth: 'existing-auth', settings: 'existing-settings' });
  assert.deepEqual(loadProgress(storage), { state: defaultState(), warning: 'incompatible' });
  assert.equal(getXP(loadState(storage)), 0);
  assert.equal(saveState(defaultState(), storage), true);
  assert.deepEqual(loadProgress(storage), { state: defaultState() });
  assert.equal(resetProgress(storage), true);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(storage.getItem(oldKey), oldBank);
  assert.equal(storage.getItem('auth'), 'existing-auth');
  assert.equal(storage.getItem('settings'), 'existing-settings');
  assert.equal(loadProgress(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ ...defaultState(), dataset: 'bank-v1' }) })).warning, 'incompatible');
});
