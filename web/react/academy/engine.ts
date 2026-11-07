import type { AcademyState, Attempt, Emotion, Evaluation, LevelInfo, Locale, Mission, Mode, ResponseSource, Session, Skill, Tag, Turn } from './types';
import { missions as bundledMissions } from './missions';

export const STORAGE_KEY = 'freedom-academy:broker:progress:v1';
const PREVIOUS_DATASET_KEY = 'freedom-academy:progress:v1';
export const SKILLS: Skill[] = ['empathy', 'accuracy', 'safety', 'resolution', 'professionalism'];
export const WEIGHTS: Record<Skill, number> = { empathy: 20, accuracy: 25, safety: 25, resolution: 20, professionalism: 10 };
export const AWARD_IDS = ['first', 'empathy', 'defender', 'flawless', 'professional', 'comeback'] as const;
const MODES: Mode[] = ['story', 'quick', 'daily', 'mistakes', 'boss'];
const DAY = 86_400_000;
const has = (object: object, key: string) => Object.hasOwn(object, key);
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const unique = <T,>(items: T[]) => [...new Set(items)];
function fail(code: string): never { throw new Error(code); }

export function defaultState(): AcademyState {
  return { version: 1, dataset: 'broker-v1', contributions: {}, best: {}, mastered: [], awards: {}, completedDays: [], history: [], active: null, demoUnlocked: false };
}
export function updateEmotion(emotion: Emotion, delta: Emotion): Emotion {
  return { stress: clamp(emotion.stress + delta.stress), trust: clamp(emotion.trust + delta.trust) };
}
export function emotionName(stress: number): 'calm' | 'concerned' | 'irritated' | 'angry' | 'furious' {
  const value = clamp(stress);
  return value <= 25 ? 'calm' : value <= 45 ? 'concerned' : value <= 65 ? 'irritated' : value <= 85 ? 'angry' : 'furious';
}
export function dayKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
const previousDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
export function dailyMission(missions: Mission[], now = new Date()): Mission | undefined {
  const ordered = [...missions].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  if (!ordered.length) return undefined;
  const day = Math.floor(Date.parse(`${dayKey(now)}T00:00:00Z`) / DAY);
  return ordered[((day % ordered.length) + ordered.length) % ordered.length];
}
export function streak(state: AcademyState, now = new Date()): number {
  const days = new Set(state.completedDays);
  let date = dayKey(now);
  if (!days.has(date)) date = previousDay(date);
  let count = 0;
  while (days.has(date)) { count++; date = previousDay(date); }
  return count;
}
export function getXP(state: AcademyState): number { return Object.values(state.contributions).reduce((sum, value) => sum + Math.max(0, value), 0); }
export function levelInfo(xp: number): LevelInfo {
  const total = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  const level = Math.min(20, 1 + Math.floor(total / 100));
  const maximum = level === 20;
  return { level, total, progress: maximum ? 100 : total % 100, remaining: maximum ? 0 : 100 - total % 100, rank: level < 4 ? 0 : level < 7 ? 1 : level < 11 ? 2 : level < 15 ? 3 : level < 20 ? 4 : 5, maximum };
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `attempt-${Date.now()}-${++sequence}`;
}
let sequence = 0;
function initialSession(mission: Mission, mode: Mode, id: string, startedAt: string): Session {
  if (!MODES.includes(mode) || !mission.nodes[mission.start] || mission.nodes[mission.start].terminal) fail('invalid_mission');
  return { id, missionId: mission.id, mode, nodeId: mission.start, emotion: updateEmotion(mission.initial, { stress: 0, trust: 0 }), events: [], turns: [], critical: false, hintedNodes: [], status: 'active', startedAt };
}
export function startSession(mission: Mission, mode: Mode, now = new Date()): Session {
  return initialSession(mission, mode, newId(), now.toISOString());
}
export function chooseResponse(session: Session, mission: Mission, actionId: string): Session {
  if (session.missionId !== mission.id) fail('mission_mismatch');
  if (session.status === 'completed') return session;
  if (session.turns.some(turn => turn.actionId === actionId)) return session;
  const node = mission.nodes[session.nodeId];
  const action = node?.actions.find(candidate => candidate.id === actionId);
  if (!node || node.terminal || !action || session.turns.some(turn => turn.nodeId === node.id && turn.actionId === action.id)) fail('invalid_action');
  if (!Number.isFinite(action.effects.stress) || !Number.isFinite(action.effects.trust)) fail('invalid_action_effect');
  const emotion = updateEmotion(session.emotion, action.effects);
  const nextNodeId = action.transition && emotion.stress >= action.transition.stressGte ? action.transition.next : action.next;
  const nextNode = mission.nodes[nextNodeId];
  if (!nextNode) fail('invalid_transition');
  const turn: Turn = { nodeId: node.id, actionId: action.id, nextNodeId, emotion, tense: emotion.stress >= 66 };
  const turns = [...session.turns, turn];
  return { ...session, nodeId: nextNodeId, emotion, events: unique([...session.events, ...action.events]), turns, critical: session.critical || Boolean(action.critical), status: nextNode.terminal || turns.length >= mission.maxTurns ? 'completed' : 'active' };
}
export function useHint(session: Session): Session {
  if (session.status !== 'active' || session.hintedNodes.includes(session.nodeId)) return session;
  return { ...session, hintedNodes: [...session.hintedNodes, session.nodeId] };
}
export class LocalResponseSource implements ResponseSource {
  readonly kind = 'local' as const;
  choose(session: Session, mission: Mission, actionId: string): Session { return chooseResponse(session, mission, actionId); }
}

export function evaluateSession(session: Session, mission: Mission): Evaluation {
  if (session.missionId !== mission.id || session.status !== 'completed') fail('unfinished_session');
  const verified = replay(session as unknown as JsonObject, mission);
  if (!verified || verified.status !== 'completed' || verified.nodeId !== session.nodeId || verified.critical !== session.critical || !same(verified.events, session.events) || !same(verified.emotion, session.emotion)) fail('invalid_session');
  const checks = [...new Map(mission.checks.map(check => [check.id, check])).values()];
  const events = new Set(session.events);
  const skills: Record<Skill, number> = { empathy: 0, accuracy: 0, safety: 0, resolution: 0, professionalism: 0 };
  const passedChecks: string[] = [], missedChecks: string[] = [];
  for (const check of checks) {
    if (events.has(check.event)) { skills[check.skill] += check.points; passedChecks.push(check.id); }
    else missedChecks.push(check.id);
  }
  const errors: Evaluation['errors'] = [];
  session.turns.forEach((turn, index) => {
    const action = mission.nodes[turn.nodeId]?.actions.find(action => action.id === turn.actionId);
    if (!action) fail('invalid_session');
    for (const error of new Map(action.errors.map(error => [error.id, error])).values()) {
      skills[error.skill] -= Math.max(0, error.penalty);
      errors.push({ turn: index + 1, nodeId: turn.nodeId, actionId: turn.actionId, errorId: error.id });
    }
  });
  for (const skill of SKILLS) skills[skill] = clamp(skills[skill]);
  if (session.critical) skills.safety = 0;
  const rawScore = Math.round(SKILLS.reduce((sum, skill) => sum + skills[skill] * WEIGHTS[skill] / 100, 0));
  const score = session.critical ? Math.min(49, rawScore) : rawScore;
  const completedGoals = mission.objectives.filter(goal => events.has(goal.id)).map(goal => goal.id);
  const missedGoals = mission.objectives.filter(goal => !events.has(goal.id)).map(goal => goal.id);
  const requiredMet = mission.objectives.every(goal => !goal.required || events.has(goal.id));
  const passed = score >= 70 && requiredMet && !session.critical && mission.nodes[session.nodeId]?.terminal === 'resolved';
  return { score, rawScore, skills, passed, critical: session.critical, completedGoals, missedGoals, passedChecks, missedChecks, errors };
}

export function completeSession(state: AcademyState, session: Session, mission: Mission, now = new Date()): AcademyState {
  if (state.history.some(attempt => attempt.id === session.id)) return state.active?.id === session.id ? { ...state, active: null } : state;
  const evaluation = evaluateSession(session, mission);
  const previouslyAwarded = has(state.contributions, mission.id) ? state.contributions[mission.id] : 0;
  const potentialXP = evaluation.passed ? Math.round(mission.maxXP * evaluation.score / 100) : 0;
  const xpEarned = Math.max(0, potentialXP - previouslyAwarded);
  const contributions = { ...state.contributions };
  if (evaluation.passed) contributions[mission.id] = Math.max(previouslyAwarded, potentialXP);
  const best = { ...state.best, [mission.id]: Math.max(has(state.best, mission.id) ? state.best[mission.id] : 0, evaluation.score) };
  const mastered = evaluation.passed ? unique([...state.mastered, mission.id]) : [...state.mastered];
  const awards = { ...state.awards }, newAwards: string[] = [];
  const finishedAt = now.toISOString();
  const unlock = (key: typeof AWARD_IDS[number], condition: boolean) => { if (condition && !has(awards, key)) { awards[key] = finishedAt; newAwards.push(key); } };
  unlock('first', true);
  unlock('empathy', evaluation.passed && mission.initial.stress >= 46 && mission.initial.stress - session.emotion.stress >= 25);
  unlock('defender', mission.id === 'security' && evaluation.passed && !evaluation.critical);
  unlock('flawless', evaluation.passed && evaluation.score === 100 && session.hintedNodes.length === 0);
  unlock('professional', mastered.length >= 5);
  unlock('comeback', has(state.best, mission.id) && evaluation.score - state.best[mission.id] >= 15);
  const attempt: Attempt = { ...evaluation, id: session.id, missionId: mission.id, mode: session.mode, finishedAt, turns: session.turns.map(turn => ({ ...turn, emotion: { ...turn.emotion } })), hintedNodes: [...session.hintedNodes], initial: { ...mission.initial }, final: { ...session.emotion }, xpEarned, newAwards };
  return { ...state, contributions, best, mastered, awards, completedDays: unique([...state.completedDays, dayKey(now)]).sort(), history: [...state.history, attempt].slice(-50), active: null };
}
export function recommendMission(state: AcademyState, missions: Mission[]): Mission | undefined {
  const available = [...missions].filter(mission => state.demoUnlocked || mission.unlock <= state.mastered.length).sort((a, b) => a.order - b.order);
  const latest = new Map<string, Attempt>();
  state.history.forEach(attempt => latest.set(attempt.missionId, attempt));
  const failed = available.filter(mission => latest.has(mission.id) && !latest.get(mission.id)!.passed);
  if (failed.length) return failed.sort((a, b) => {
    const priority = (id: string) => state.history.filter(attempt => attempt.missionId === id).reduce((sum, attempt) => sum + attempt.errors.length + attempt.missedGoals.length + (attempt.critical ? 3 : 0), 0);
    return priority(b.id) - priority(a.id) || a.order - b.order;
  })[0];
  return available.find(mission => !state.mastered.includes(mission.id)) || available.sort((a, b) => (state.best[a.id] ?? 0) - (state.best[b.id] ?? 0) || a.order - b.order)[0];
}

const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/ё/g, 'е').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const words = (text: string) => text.replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
const positive: Record<Locale, Partial<Record<Tag, RegExp>>> = {
  ru: { empathy: /понимаю|сожалею|извините|неудобств/, clarify: /уточн|подскажите|какой|когда|что видите/, solution: /проверим|проверю|предлагаю|откройте|следующий шаг|обращени|заявк/, avoid: /не знаю|не моя проблема|ничем не могу|разбирайтесь сами/ },
  en: { empathy: /\bunderstand\b|\bsorry\b|apologi|inconvenience/, clarify: /\bclarify\b|\bwhich\b|\bwhen\b|\bwhat do you see\b|\bcould you tell\b/, solution: /\bcheck\b|\bopen\b|next step|\bsuggest\b|\brequest\b|\breview\b/, avoid: /don'?t know|not my problem|nothing i can do|deal with it/ },
  kk: { empathy: /түсінем|кешірім|өкініш|ыңғайсыз/, clarify: /нақтыла|айтыңыз|қай кезде|қандай|не көріп/, solution: /тексер|ашыңыз|келесі қадам|ұсынам|өтініш/, avoid: /білмеймін|менің мәселем емес|көмектесе алмаймын|өзіңіз шешіңіз/ },
};
function riskyTags(text: string): Tag[] {
  const tags = new Set<Tag>();
  const clauses = text.split(/[.!?;,\n]+|(?:^|\s)(?:но|but|бірақ)(?:\s|$)/);
  for (const original of clauses) {
    // Remove only the negated verb, not its whole sentence: a second unsafe
    // instruction in the same sentence must still be detected.
    const clause = original
      .replace(/(?:не|никому не)\s+(?:сообщ\S*|отправ\S*|переда\S*|называ\S*|прос\S*|запраш\S*|давайте|пишите|покуп\S*|прода\S*|приобрет\S*)/gu, ' ')
      .replace(/\b(?:do not|don'?t|never)\s+(?:send|tell|share|give|provide|ask|buy|sell)\b/g, ' ')
      .replace(/жібермең\S*|айтпаңыз|бермең\S*|сұрамай\S*|сатып алмаңыз|сатпаңыз/gu, ' ')
      .replace(/(?:не\s+(?:(?:могу|можем|буду|будем|следует|стоит|нужно)\s+)?|нельзя\s+)(?:гарантир\S*|обещ\S*)|(?:гаранти\S*\s+нет)|(?:без\s+гаранти\S*)|не\s+(?:является|считается)\s+гаранти\S*|(?:без\s+риска|риска\s+нет|никакого\s+риска)\s+не\s+(?:бывает|существует)/gu, ' ')
      .replace(/\b(?:cannot|can't|do not|don't|never)\s+(?:be\s+)?(?:guarantee(?:d)?|promise)\b|\b(?:not|never)\s+guaranteed\b|\bno\s+guarantee(?:d|s)?\b/g, ' ')
      .replace(/кепілдік бермей\S*|кепілдік берілмей\S*|кепілдендірілмей\S*|кепілдік жоқ/gu, ' ');
    {
      const secret = /парол|құпиясөз|\bpassword\b|\bpin\b|\bcvv\b|\bcvc\b|\botp\b|sms.?код|смс.?код|код.{0,18}(?:смс|sms|подтвержд)|(?:секретн\S*|резервн\S*)\s+(?:код|ключ)|verification code|security code|sms code|recovery code|private key|secret key|растау код|бір реттік код|құпия кілт/.test(clause);
      const asking = /сообщ|отправ|пришл|переда|назов|напиш|дикту|дайте|предостав|\bsend\b|\btell\b|\bshare\b|\bgive\b|\bprovide\b|жібер|айтың|беріңіз|хабарла/.test(clause);
      if (secret && asking) tags.add('unsafe');
      const guarantees = /гарантир|обещаю|обещаем|точно (?:вернем|возместим|компенсируем|заработаете|получите доход)|(?:акци\S*|бумаг\S*|актив\S*|стоимост\S*|цен\S*).{0,20}(?:точно|обязательно|непременно)\s+(?:выраст\S*|подним\S*|восстанов\S*|подорож\S*|расти)|(?:без\s+риска|риска?\s+нет|рисков\s+нет|никакого\s+риска|риски\s+(?:отсутствуют|исключены))|\bguarantee(?:d)?\b|\bpromise\b|\b(?:risk[ -]free|riskless|no (?:investment )?risk|zero risk)\b|\b(?:definitely|certainly|surely)\s+(?:rise|grow|recover|refund|compensate|go up)\b|\bwill\s+(?:compensate|refund)\b|кепілдік берем|кепілдендір|тәуекел жоқ|тәуекелсіз|міндетті түрде (?:өседі|көтеріледі|өтейміз|қайтарамыз|табыс)/.test(clause);
      if (guarantees) tags.add('promise');
      const personalizedTrade = /(?:^|\s)(?:купи(?:те)?|покупай(?:те)?|продай(?:те)?|продавай(?:те)?|приобретите|советую купить|советую продать|рекомендую купить|рекомендую продать)\s+\S|держите.{0,45}(?:акци|бумаг|актив|облигац)|\b(?:buy|sell|hold)\s+\S|\b(?:recommend|advise)\b.{0,20}\b(?:buying|selling|holding)\b|(?:сатып алыңыз|сатыңыз|ұстаңыз)/.test(clause);
      if (personalizedTrade) tags.add('unsafe');
    }
    if (/идиот|дурак|заткни|сам виноват|отстан|\bstupid\b|\bidiot\b|shut up|your fault|ақымақ|өзің кінәлі/.test(clause)) tags.add('rude');
  }
  return [...tags];
}
export function classifyFreeText(text: string, session: Session, mission: Mission, locale: Locale): { actionId?: string; reason: 'matched' | 'unknown' | 'ambiguous' } {
  if (session.status !== 'active' || session.missionId !== mission.id || text.length > 3000 || !positive[locale]) return { reason: 'unknown' };
  const actions = mission.nodes[session.nodeId]?.actions || [];
  const input = normalize(text);
  if (!input || !/\p{L}/u.test(input)) return { reason: 'unknown' };
  const exact = actions.filter(action => words(normalize(action.text[locale])) === words(input));
  if (exact.length === 1) return { actionId: exact[0].id, reason: 'matched' };
  const risky = riskyTags(input);
  if (risky.length) {
    const financialRisk = risky.some(tag => tag === 'unsafe' || tag === 'promise');
    const candidates = actions.filter(action => (!financialRisk || action.critical) && risky.every(tag => action.tags.includes(tag)));
    return candidates.length === 1 ? { actionId: candidates[0].id, reason: 'matched' } : { reason: candidates.length ? 'ambiguous' : 'unknown' };
  }
  const tags = (Object.entries(positive[locale]) as [Tag, RegExp][]).filter(([, pattern]) => pattern.test(input)).map(([tag]) => tag);
  // A safe refusal is not a request for secrets; unsupported negation falls back to explicit choices.
  if (/\bnot\b|don't|cannot|can't|\bnever\b|(?:^|\s)не\s|емес|меңіз|маңыз/.test(input) && !tags.includes('avoid')) return { reason: 'unknown' };
  if (!tags.length) return { reason: 'unknown' };
  // Match all required intents, rather than rewarding a single empathy word
  // for an answer that also requires clarification or a concrete next step.
  const candidates = actions.filter(action => !action.critical && action.tags.length > 0 && action.tags.every(tag => tags.includes(tag)) && tags.every(tag => action.tags.includes(tag)));
  return candidates.length === 1 ? { actionId: candidates[0].id, reason: 'matched' } : { reason: candidates.length ? 'ambiguous' : 'unknown' };
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const bounded = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const textId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 180 && !['__proto__', 'constructor', 'prototype'].includes(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const dateKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function stringList(value: unknown, max: number): string[] | null { return Array.isArray(value) && value.length <= max && value.every(textId) && new Set(value).size === value.length ? [...value] : null; }
function readEmotion(value: unknown): Emotion | null { return object(value) && bounded(value.stress, 0, 100) && bounded(value.trust, 0, 100) ? { stress: value.stress, trust: value.trust } : null; }
function replay(value: JsonObject, mission: Mission): Session | null {
  if (!textId(value.id) || !MODES.includes(value.mode as Mode) || !timestamp(value.startedAt) || !Array.isArray(value.turns) || value.turns.length > mission.maxTurns) return null;
  let session = initialSession(mission, value.mode as Mode, value.id, value.startedAt);
  try {
    for (const raw of value.turns) {
      if (!object(raw) || session.status !== 'active' || raw.nodeId !== session.nodeId || !textId(raw.actionId)) return null;
      const previousCount = session.turns.length;
      session = chooseResponse(session, mission, raw.actionId);
      if (session.turns.length !== previousCount + 1) return null;
      const actual = session.turns.at(-1)!;
      const emotion = readEmotion(raw.emotion);
      if (!emotion || raw.nextNodeId !== actual.nextNodeId || raw.tense !== actual.tense || !same(emotion, actual.emotion)) return null;
    }
    const hints = stringList(value.hintedNodes, mission.maxTurns + 1);
    const visited = new Set([mission.start, session.nodeId, ...session.turns.map(turn => turn.nodeId)]);
    if (!hints || hints.some(id => !visited.has(id) || !mission.nodes[id] || mission.nodes[id].terminal)) return null;
    return { ...session, hintedNodes: hints };
  } catch { return null; }
}
function readSession(value: unknown, missions: Mission[]): Session | null {
  if (!object(value)) return null;
  const mission = missions.find(mission => mission.id === value.missionId);
  if (!mission) return null;
  const session = replay(value, mission);
  if (!session || session.nodeId !== value.nodeId || session.status !== value.status || session.critical !== value.critical || !same(session.emotion, readEmotion(value.emotion)) || !same(session.events, value.events)) return null;
  return session;
}
function readAttempt(value: unknown, missions: Mission[]): Attempt | null {
  if (!object(value) || !timestamp(value.finishedAt)) return null;
  const mission = missions.find(mission => mission.id === value.missionId);
  if (!mission || !bounded(value.xpEarned, 0, mission.maxXP)) return null;
  const session = replay({ ...value, startedAt: value.finishedAt }, mission);
  if (!session || session.status !== 'completed') return null;
  const evaluation = evaluateSession(session, mission);
  for (const key of ['score', 'rawScore', 'skills', 'passed', 'critical', 'completedGoals', 'missedGoals', 'passedChecks', 'missedChecks', 'errors'] as const) if (!same(value[key], evaluation[key])) return null;
  const newAwards = stringList(value.newAwards, AWARD_IDS.length);
  if (!newAwards || newAwards.some(key => !AWARD_IDS.includes(key as typeof AWARD_IDS[number])) || !same(readEmotion(value.initial), mission.initial) || !same(readEmotion(value.final), session.emotion) || value.xpEarned > (evaluation.passed ? Math.round(mission.maxXP * evaluation.score / 100) : 0)) return null;
  return { ...evaluation, id: session.id, missionId: mission.id, mode: session.mode, finishedAt: value.finishedAt, turns: session.turns, hintedNodes: session.hintedNodes, initial: { ...mission.initial }, final: session.emotion, xpEarned: value.xpEarned, newAwards };
}
function readProgress(value: unknown, missions: Mission[] = bundledMissions): AcademyState | null {
  if (!object(value) || value.version !== 1 || value.dataset !== 'broker-v1' || typeof value.demoUnlocked !== 'boolean' || !object(value.contributions) || !object(value.best) || !object(value.awards) || !Array.isArray(value.history) || value.history.length > 50) return null;
  const byId = new Map(missions.map(mission => [mission.id, mission]));
  const mastered = stringList(value.mastered, missions.length), completedDays = stringList(value.completedDays, 36600);
  if (!mastered || mastered.some(id => !byId.has(id)) || !completedDays || !completedDays.every(dateKey)) return null;
  const contributions: Record<string, number> = {}, best: Record<string, number> = {}, awards: Record<string, string> = {};
  for (const [id, score] of Object.entries(value.best)) { if (!byId.has(id) || !bounded(score, 0, 100)) return null; best[id] = score; }
  for (const [id, xp] of Object.entries(value.contributions)) { const mission = byId.get(id); if (!mission || !bounded(xp, Math.round(mission.maxXP * .7), Math.round(mission.maxXP * (best[id] ?? 0) / 100)) || !mastered.includes(id) || (best[id] ?? 0) < 70) return null; contributions[id] = xp; }
  if (mastered.some(id => !has(contributions, id) || contributions[id] <= 0)) return null;
  for (const [id, time] of Object.entries(value.awards)) { if (!AWARD_IDS.includes(id as typeof AWARD_IDS[number]) || !timestamp(time)) return null; awards[id] = time; }
  const history = value.history.map(raw => readAttempt(raw, missions));
  if (history.some(attempt => !attempt) || new Set(history.map(attempt => attempt!.id)).size !== history.length) return null;
  const active = value.active === null ? null : readSession(value.active, missions);
  if (value.active !== null && !active) return null;
  for (const attempt of history as Attempt[]) if ((best[attempt.missionId] ?? -1) < attempt.score || attempt.passed && !mastered.includes(attempt.missionId) || attempt.newAwards.some(key => !has(awards, key)) || !completedDays.includes(dayKey(new Date(attempt.finishedAt)))) return null;
  for (const mission of missions) if ((history as Attempt[]).filter(attempt => attempt.missionId === mission.id).reduce((sum, attempt) => sum + attempt.xpEarned, 0) > (contributions[mission.id] ?? 0)) return null;
  return { version: 1, dataset: 'broker-v1', contributions, best, mastered, awards, completedDays: completedDays.sort(), history: history as Attempt[], active, demoUnlocked: value.demoUnlocked };
}
export function loadProgress(storage?: Pick<Storage, 'getItem'>): { state: AcademyState; warning?: 'unavailable' | 'corrupt' | 'incompatible' } {
  let raw: string | null;
  try {
    const source = storage ?? localStorage;
    raw = source.getItem(STORAGE_KEY);
    if (raw === null && source.getItem(PREVIOUS_DATASET_KEY) !== null) return { state: defaultState(), warning: 'incompatible' };
  } catch { return { state: defaultState(), warning: 'unavailable' }; }
  if (raw === null) return { state: defaultState() };
  try {
    if (raw.length > 5_000_000) return { state: defaultState(), warning: 'corrupt' };
    const parsed: unknown = JSON.parse(raw);
    if (object(parsed) && (parsed.version !== 1 || parsed.dataset !== 'broker-v1')) return { state: defaultState(), warning: 'incompatible' };
    const state = readProgress(parsed);
    return state ? { state } : { state: defaultState(), warning: 'corrupt' };
  } catch { return { state: defaultState(), warning: 'corrupt' }; }
}
export function loadState(storage?: Pick<Storage, 'getItem'>): AcademyState { return loadProgress(storage).state; }
export function saveState(state: AcademyState, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    const sanitized = readProgress(state);
    if (!sanitized) return false;
    (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(sanitized));
    return true;
  } catch { return false; }
}
export function resetProgress(storage?: Pick<Storage, 'removeItem'>): boolean {
  try { (storage ?? localStorage).removeItem(STORAGE_KEY); return true; } catch { return false; }
}
