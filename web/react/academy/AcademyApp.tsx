import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '../shared';
import { getLocale } from '../i18n';
import { a } from './copy';
import { AcademyConfirm, confirmAcademy } from './AcademyConfirm';
import { missions, SKILLS, skillNames, rankNames, achievementNames, modeNames } from './missions';
import { STORAGE_KEY, loadProgress, saveState, resetProgress, defaultState, startSession, LocalResponseSource, useHint as markHintUsed, completeSession, getXP, levelInfo, dayKey, dailyMission, streak, recommendMission, emotionName, updateEmotion, classifyFreeText } from './engine';
import { mergeProgress } from './persistence';
import { tr } from './feature-ui';
import { ReadingPreferences, useReadingPreset } from './ReadingPreferences';
import { SteppedHint } from './SteppedHint';
import { MissionDiscovery, SkillInsights } from './Discovery';
import { GuidedStartButton, MicroDrillButton, DrillCollection, WeeklyPlan } from './LearningTools';
import { retryPendingWeeklyPlanSave } from './weeklyPlan';
import { ScoreBreakdown, AttemptComparison, ReviewTranscript, type ReviewTarget } from './ReviewTools';
import type { AcademyState, Attempt, Emotion, Localized, Mission, Mode, Session, Skill } from './types';

const l = (value: Localized) => value[getLocale()];
const WEIGHTS: Record<Skill, number> = { empathy: 20, accuracy: 25, safety: 25, resolution: 20, professionalism: 10 };
const AWARDS = ['first', 'empathy', 'defender', 'flawless', 'professional', 'comeback'];
const responses = new LocalResponseSource();
let memoryState: AcademyState | undefined;
let memoryWarning: string | undefined;
let memoryDirty = false;
let leaveGuard = { active: false, hash: '' };
let pendingCelebration: { id: string; levelUp: boolean } | undefined;
const progressSubscribers = new Set<(state: AcademyState, reset: boolean) => void>();

function withStoredProgress(state: AcademyState): AcademyState {
  const stored = loadProgress();
  return stored.warning ? state : mergeProgress(state, stored.state);
}

// Keep the cache current even while the Academy view is unmounted. A different tab
// must not lose completed attempts when this tab next changes an unrelated setting.
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  try { if (event.storageArea !== window.localStorage) return; }
  catch { return; }
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  if (event.newValue === null) {
    memoryState = defaultState(); memoryDirty = false; memoryWarning = undefined;
    pendingCelebration = undefined; leaveGuard.active = false;
    progressSubscribers.forEach(subscriber => subscriber(memoryState!, true));
    return;
  }
  const stored = loadProgress();
  if (stored.warning) return;
  const preserveSession = Boolean(memoryState?.active || memoryDirty);
  const next = memoryState ? mergeProgress(memoryState, stored.state) : stored.state;
  if (!preserveSession) { next.active = stored.state.active; next.demoUnlocked = stored.state.demoUnlocked; }
  memoryState = next;
  memoryDirty = JSON.stringify(next) !== JSON.stringify(stored.state);
  if (!memoryDirty) memoryWarning = undefined;
  progressSubscribers.forEach(subscriber => subscriber(next, false));
});

/** Called once by the existing application router before leaving a visible conversation. */
export async function canLeaveAcademy(nextHash: string): Promise<boolean> {
  if (!leaveGuard.active || nextHash === leaveGuard.hash) return true;
  canReloadAcademy();
  const allowed = await confirmAcademy({ title: a('leaveTitle'), message: a(memoryWarning === 'unavailable' ? 'leaveConfirmMemory' : 'leaveConfirm'), confirmLabel: a('leaveButton'), cancelLabel: a('cancel') });
  if (allowed) leaveGuard.active = false;
  return allowed;
}

/** A language switch reloads the page. Never silently discard memory-only progress. */
export function canReloadAcademy(): boolean {
  const planSaved = retryPendingWeeklyPlanSave();
  if (!memoryDirty || !memoryState) return planSaved;
  memoryState = withStoredProgress(memoryState);
  if (!saveState(memoryState)) { memoryWarning = 'unavailable'; return false; }
  memoryDirty = false;
  memoryWarning = undefined;
  return planSaved;
}

function initialProgress() {
  if (!memoryState) {
    const loaded = loadProgress();
    memoryState = loaded.state;
    memoryWarning = loaded.warning;
  }
  return { state: memoryState, warning: memoryWarning };
}

const missionHash = (mission: Mission, mode: Mode = 'story') => `#academy/mission/${encodeURIComponent(mission.id)}/${mode}`;
const resultHash = (id: string) => `#academy/result/${encodeURIComponent(id)}`;
const go = (hash: string) => { window.location.hash = hash; };
const unlocked = (state: AcademyState, mission: Mission) => state.demoUnlocked || state.mastered.includes(mission.id) || state.mastered.length >= mission.unlock;
const formatDate = (value: string) => new Intl.DateTimeFormat({ ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' }[getLocale()], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
function recommendationReason(state: AcademyState, mission: Mission): string {
  const latest = [...state.history].reverse().find(attempt => attempt.missionId === mission.id);
  return a(latest && !latest.passed ? 'reasonMistake' : !state.mastered.includes(mission.id) ? 'reasonNew' : 'reasonRefresh');
}

function Button({ children, icon, variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string; variant?: 'primary' | 'secondary' | 'ghost'; children: ReactNode }) {
  return <button type="button" className={`ac-button ac-${variant} ${className}`} {...props}>{icon && <Icon name={icon}/>}<span>{children}</span></button>;
}
function LinkButton({ href, children, icon, secondary = false }: { href: string; children: ReactNode; icon?: string; secondary?: boolean }) {
  return <a className={`ac-button ac-${secondary ? 'secondary' : 'primary'}`} href={href}>{icon && <Icon name={icon}/>}<span>{children}</span></a>;
}
function Heading({ title, icon, detail }: { title: string; icon?: string; detail?: ReactNode }) {
  return <div className="ac-card-head"><h3>{icon && <Icon name={icon}/>} {title}</h3>{detail}</div>;
}
function Track({ value, label, tone = '' }: { value: number; label: string; tone?: string }) {
  return <div className={`ac-track ${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }}/></div>;
}
function Emotions({ emotion, previous, avatar = false }: { emotion: Emotion; previous?: Emotion; avatar?: boolean }) {
  const mood = emotionName(emotion.stress);
  const angry = emotion.stress > 65;
  const worried = emotion.stress > 25;
  return <div className={`ac-emotion-bars is-${mood}`}>
    {avatar && <div className="ac-client-avatar" aria-hidden="true"><svg viewBox="0 0 80 80" fill="none"><circle cx="40" cy="40" r="33" fill="currentColor" opacity=".10"/><path d="M22 35c0-15 36-15 36 0v13c0 23-36 23-36 0V35Z" stroke="currentColor" strokeWidth="2"/><path d="M22 36c0-27 38-27 36 0M26 31c8 1 14-4 17-10 3 7 8 10 14 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d={angry ? 'M28 38l8 4m8 0 8-4' : worried ? 'm28 40 8-3m8 0 8 3' : 'M28 38h8m8 0h8'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/><circle cx="32" cy="44" r="2" fill="currentColor"/><circle cx="48" cy="44" r="2" fill="currentColor"/><path d={angry ? 'M32 57q8-7 16 0' : worried ? 'M33 56q7-3 14 0' : 'M32 53q8 9 16 0'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg><span/></div>}
    <div className="ac-emotion-label"><strong>{a(mood)}</strong>{previous && emotion.stress < previous.stress && <span className="ac-pill">{a('calming')}</span>}</div>
    <div className="ac-meter"><div><span>{a('stress')}</span><strong>{emotion.stress}<small>/100</small></strong></div><Track value={emotion.stress} label={a('stress')} tone="is-stress"/><div className="ac-meter-note"><span className="ac-direction-help">{a('stressDirection')}</span>{previous && <span className={`ac-delta ${emotion.stress < previous.stress ? 'is-improving' : emotion.stress > previous.stress ? 'is-worsening' : ''}`} data-ac-stress-delta>{previous.stress} → {emotion.stress}</span>}</div></div>
    <div className="ac-meter"><div><span>{a('trust')}</span><strong>{emotion.trust}<small>/100</small></strong></div><Track value={emotion.trust} label={a('trust')}/><div className="ac-meter-note"><span className="ac-direction-help">{a('trustDirection')}</span>{previous && <span className={`ac-delta ${emotion.trust > previous.trust ? 'is-improving' : emotion.trust < previous.trust ? 'is-worsening' : ''}`} data-ac-trust-delta>{emotion.trust === previous.trust ? a('deltaUnchanged') : `${emotion.trust > previous.trust ? '+' : '−'}${Math.abs(emotion.trust - previous.trust)}`}</span>}</div></div>
  </div>;
}
function DemoSwitch({ state, onChange }: { state: AcademyState; onChange: (value: boolean) => void }) {
  return <label className="ac-demo-switch"><input type="checkbox" role="switch" checked={state.demoUnlocked} onChange={event => onChange(event.target.checked)} data-ac-demo-unlock/><span><strong>{a('demoUnlock')}</strong><small>{a('demoUnlockText')}</small></span></label>;
}
function Achievements({ state }: { state: AcademyState }) {
  return <section className="ac-card"><Heading title={a('achievements')} icon="shield" detail={<span className="ac-muted">{AWARDS.filter(key => state.awards[key]).length}/{AWARDS.length}</span>}/><div className="ac-achievements">{AWARDS.map(key => <div className={`ac-badge ${state.awards[key] ? 'is-earned' : 'is-locked'}`} key={key} title={state.awards[key] ? `${a('earned')} · ${formatDate(state.awards[key])}` : a('lockedBadge')}><div className="ac-badge-icon" aria-hidden="true"><Icon name={achievementNames[key].icon}/></div><strong>{l(achievementNames[key].title)}</strong><small>{l(achievementNames[key].description)}</small><span className="ac-badge-status">{a(state.awards[key] ? 'earned' : 'lockedBadge')}</span></div>)}</div></section>;
}
function EmotionSandbox() {
  const [emotion, setEmotion] = useState<Emotion>({ stress: 60, trust: 40 });
  const [previous, setPrevious] = useState<Emotion>();
  const [reaction, setReaction] = useState('sandboxClient');
  const act = (key: string, delta: Emotion) => { setPrevious(emotion); setEmotion(updateEmotion(emotion, delta)); setReaction(key); };
  return <section className="ac-card ac-sandbox"><Heading title={a('sandbox')} icon="dialogs" detail={<span className="ac-pill">0 XP</span>}/><p className="ac-muted">{a('sandboxText')}</p><blockquote className="ac-sandbox-quote" aria-live="polite">{a(reaction)}</blockquote><Emotions emotion={emotion} previous={previous} avatar/><div className="ac-sandbox-actions"><Button variant="secondary" onClick={() => act('sandboxRudeReply', { stress: 25, trust: -20 })}>{a('sandboxRude')}</Button><Button variant="secondary" icon="heart" onClick={() => act('sandboxEmpathyReply', { stress: -15, trust: 10 })}>{a('sandboxEmpathy')}</Button><Button variant="secondary" icon="target" onClick={() => act('sandboxSolutionReply', { stress: -20, trust: 15 })}>{a('sandboxSolution')}</Button></div><Button variant="ghost" icon="rotate" onClick={() => { setEmotion({ stress: 60, trust: 40 }); setPrevious(undefined); setReaction('sandboxClient'); }}>{a('sandboxReset')}</Button></section>;
}
function InvestorGuidance() {
  const topics = [['investorLossPrices', 'losses', 'chart'], ['investorLossComplaints', 'losses', 'heart'], ['investorOrderStatus', 'order', 'list'], ['investorFees', 'fee', 'book'], ['investorSecurity', 'security', 'shield'], ['investorAdvice', 'boss', 'dialogs']];
  return <section className="ac-card ac-investor-guide"><Heading title={a('investorTitle')} icon="book"/><p className="ac-muted">{a('investorText')}</p><div className="ac-guidance-grid">{topics.map(([key, missionId, icon]) => <a className="ac-guidance-item" href={`#academy/mission/${missionId}/story`} key={key}><Icon name={icon}/><span><strong>{a(key)}</strong><small>{a(`${key}Text`)}</small></span><Icon name="chevron"/></a>)}</div></section>;
}
function frequentMistakes(state: AcademyState) {
  const counts = new Map<string, { text: Localized; count: number; mission: Mission }>();
  for (const attempt of state.history) {
    const mission = missions.find(value => value.id === attempt.missionId);
    if (!mission) continue;
    for (const item of attempt.errors) {
      const error = mission.nodes[item.nodeId]?.actions.find(action => action.id === item.actionId)?.errors.find(value => value.id === item.errorId);
      if (!error) continue;
      const current = counts.get(error.id);
      counts.set(error.id, { text: error.explanation, count: (current?.count ?? 0) + 1, mission });
    }
  }
  return [...counts.values()].sort((left, right) => right.count - left.count);
}
function Dashboard({ state, onDemo }: { state: AcademyState; onDemo: (value: boolean) => void }) {
  const xp = getXP(state);
  const level = levelInfo(xp);
  const recommended = recommendMission(state, missions) ?? missions[0];
  const daily = dailyMission(missions);
  const average = state.history.length ? Math.round(state.history.reduce((sum, item) => sum + item.score, 0) / state.history.length) : null;
  const activeMission = missions.find(mission => mission.id === state.active?.missionId);
  const nextMission = activeMission ?? recommended;
  const active = activeMission && state.active;
  const todayDone = state.history.some(item => item.mode === 'daily' && item.missionId === daily?.id && dayKey(new Date(item.finishedAt)) === dayKey());
  return <>
    <section className="ac-next-step" data-ac-next-step><div className="ac-next-copy"><span className="ac-kicker">{a(active ? 'resumeTitle' : 'nextStep')}</span><h1>{l(nextMission.title)}</h1><p>{active ? a(memoryWarning === 'unavailable' ? 'memoryOnly' : 'reasonResume') : recommendationReason(state, nextMission)}</p>{!state.history.length && !active && <p className="ac-onboarding">{a('onboarding')}</p>}<LinkButton href={missionHash(nextMission, active ? active.mode : 'story')} icon="arrow-right">{a(active ? active.status === 'active' ? 'continueTraining' : 'finish' : state.history.length ? 'next' : 'start')}</LinkButton></div><div className="ac-next-meta"><span className="ac-pill">{a(`difficulty${nextMission.difficulty}`)}</span><span>{a('minutes', { count: nextMission.duration })}</span><span>{a('maxXP', { xp: nextMission.maxXP })}</span>{active && <span className="ac-current-task"><strong>{a('currentStage')}</strong>{l(nextMission.nodes[active.nodeId].title)}</span>}</div></section>
    <section className="ac-progress-strip" aria-label={a('overview')}><div className="ac-progress-identity"><div className="ac-avatar" aria-hidden="true"><Icon name="shield"/></div><div><span>{a('operator')}</span><strong>{l(rankNames[level.rank])}</strong><small>{a('level', { level: level.level })} / 20</small></div></div><div className="ac-progress-xp"><div><strong>{xp.toLocaleString(getLocale())} XP</strong><span>{level.maximum ? a('maxLevel') : a('nextLevel', { xp: level.remaining })}</span></div><Track value={level.progress} label={a('level', { level: level.level })}/></div><div className="ac-progress-stat"><span>{a('mastered')}</span><strong>{state.mastered.length}<small> / {missions.length}</small></strong></div><div className="ac-progress-stat"><span>{a('quality')}</span><strong className={average === null ? 'ac-no-result' : ''}>{average === null ? a('noAttempts') : `${average}/100`}</strong></div><div className="ac-progress-stat"><span>{a('streak')}</span><strong>{streak(state)}</strong></div></section>
    <MissionDiscovery state={state} onDemo={onDemo} extraMistakes={<DrillCollection state={state}/>}/>
    <div className="ac-home-secondary">{daily && <section className="ac-card ac-daily"><Heading title={a('daily')} icon="target" detail={todayDone ? <span className="ac-pill"><Icon name="check"/>{a('dailyDone')}</span> : undefined}/><h3>{l(daily.title)}</h3><p className="ac-muted">{a('dailyText')}</p>{!unlocked(state, daily) && <p className="ac-muted">{a('unlock', { count: daily.unlock })}</p>}<LinkButton href={missionHash(daily, 'daily')} secondary icon="arrow-right">{a(unlocked(state, daily) ? 'dailyStart' : 'preview')}</LinkButton><p className="ac-xp-note">{a('xpFair')}</p></section>}<EmotionSandbox/></div>
    <details className="ac-card ac-week-disclosure"><summary>{tr('Личный план практики на неделю', 'Апталық жеке жаттығу жоспары', 'Your weekly practice plan')}</summary><WeeklyPlan state={state}/></details>
    <div className="ac-insights-grid"><SkillInsights state={state}/><Achievements state={state}/></div><InvestorGuidance/>
  </>;
}
function Analytics({ state }: { state: AcademyState }) {
  const recent = state.history.slice(-16);
  const mistakes = frequentMistakes(state);
  const success = state.history.filter(item => item.passed).length;
  const points = recent.map((item, index) => `${12 + index * (576 / Math.max(1, recent.length - 1))},${172 - item.score * 1.48}`).join(' ');
  return <div className="ac-analytics"><div className="ac-section-heading"><div><span className="ac-kicker">FREEDOM ACADEMY</span><h1>{a('statsTitle')}</h1><p className="ac-muted">{a('statsText')}</p></div></div><div className="ac-metrics"><div><span>{a('attempts')}</span><strong>{state.history.length}</strong></div><div><span>{a('successRate')}</span><strong>{state.history.length ? `${Math.round(success / state.history.length * 100)}%` : '—'}</strong></div><div><span>{a('mastered')}</span><strong>{state.mastered.length}<small> / {missions.length}</small></strong></div></div>
    <div className="ac-dashboard-grid"><div className="ac-dashboard-main"><section className="ac-card ac-trend"><Heading title={a('trend')} icon="chart"/>{recent.length > 1 ? <><svg viewBox="0 0 600 196" role="img" aria-label={`${a('trend')}: ${recent.map(item => item.score).join(', ')}`}><path className="ac-chart-grid" d="M12 24H588M12 98H588M12 172H588"/><polyline className="ac-chart-line" points={points}/>{recent.map((item, index) => <circle key={item.id} className="ac-chart-point" cx={12 + index * (576 / (recent.length - 1))} cy={172 - item.score * 1.48} r="4"><title>{`${formatDate(item.finishedAt)}: ${item.score}/100`}</title></circle>)}</svg><div className="ac-chart-labels"><span>{formatDate(recent[0].finishedAt)}</span><span>{formatDate(recent[recent.length - 1].finishedAt)}</span></div></> : <p className="ac-empty">{a('trendEmpty')}</p>}</section>
    <section className="ac-card"><Heading title={a('history')} icon="list"/>{state.history.length ? <div className="ac-history">{[...state.history].reverse().map(item => { const mission = missions.find(value => value.id === item.missionId); return mission ? <a className="ac-history-row" href={resultHash(item.id)} key={item.id}><div className={`ac-history-score ${item.passed ? 'is-passed' : ''}`}>{item.score}</div><div><strong>{l(mission.title)}</strong><small>{formatDate(item.finishedAt)} · {l(modeNames[item.mode])}</small></div><span className="ac-pill">+{item.xpEarned} XP</span><Icon name="chevron"/></a> : null; })}</div> : <p className="ac-empty">{a('historyEmpty')}</p>}</section><AttemptComparison history={state.history}/></div><aside className="ac-dashboard-aside"><SkillInsights state={state}/><section className="ac-card"><Heading title={a('frequent')} icon="target"/>{mistakes.length ? mistakes.slice(0, 5).map((item, index) => <a href={missionHash(item.mission, 'mistakes')} className="ac-mistake-link" key={index}><span>{l(item.text)}</span><strong>×{item.count}</strong><Icon name="chevron"/></a>) : <p className="ac-empty">{a('noMistakes')}</p>}</section></aside></div><Achievements state={state}/></div>;
}
function Knowledge({ mission }: { mission: Mission }) {
  return <div className="ac-knowledge"><h3><Icon name="book"/>{a('knowledge')}</h3><ul>{mission.knowledge.map((item, index) => <li key={index}>{l(item)}</li>)}</ul><p className="ac-muted">{a('knowledgeNote')}</p></div>;
}
function Briefing({ mission, mode, state, onStart, onDemo }: { mission: Mission; mode: Mode; state: AcademyState; onStart: () => void; onDemo: (value: boolean) => void }) {
  const open = unlocked(state, mission);
  return <div className="ac-briefing-page" data-ac-mission={mission.id}><div className="ac-breadcrumb"><a href="#academy/missions"><Icon name="arrow-left"/>{a('back')}</a><span>{l(modeNames[mode])}</span></div><div className="ac-briefing-layout"><section className="ac-card ac-briefing-intro"><span className="ac-kicker">{a('briefing')} · {String(mission.order).padStart(2, '0')}</span><h1>{l(mission.title)}</h1><p className="ac-lead">{l(mission.summary)}</p><div className="ac-mission-meta"><span>{a(`difficulty${mission.difficulty}`)}</span><span>{a('minutes', { count: mission.duration })}</span><strong>{a('maxXP', { xp: mission.maxXP })}</strong></div><div className="ac-objective"><Icon name="target"/><div><strong>{a('goal')}</strong><p>{l(mission.objective)}</p></div></div><p className="ac-muted">{a('chooseReady')}</p>{open ? <Button icon="arrow-right" onClick={onStart} data-ac-start>{a('start')}</Button> : <div className="ac-locked-notice"><Icon name="shield"/><h3>{a('locked')}</h3><p>{a('unlockRemaining', { count: Math.max(0, mission.unlock - state.mastered.length) })}</p><DemoSwitch state={state} onChange={onDemo}/></div>}</section><aside className="ac-card"><Knowledge mission={mission}/></aside></div></div>;
}
function ChatMessage({ kind, children }: { kind: 'client' | 'operator'; children: ReactNode }) {
  return <div className={`ac-message is-${kind}`}><span className="ac-message-author">{a(kind === 'client' ? 'client' : 'you')}</span><p>{children}</p></div>;
}
function Conversation({ mission, session, busy, pending, onChoice, onHint, onFinish }: { mission: Mission; session: Session; busy: boolean; pending?: string; onChoice: (id: string) => void; onHint: () => void; onFinish: () => void }) {
  const log = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const choiceHeading = useRef<HTMLHeadingElement>(null);
  const keyboardChoice = useRef<HTMLElement | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [selectedTurn, setSelectedTurn] = useState<number>();
  const [text, setText] = useState('');
  const [match, setMatch] = useState<{ actionId?: string; reason: string }>();
  const node = mission.nodes[session.nodeId];
  const previous = session.turns.length ? session.turns.length > 1 ? session.turns[session.turns.length - 2].emotion : mission.initial : undefined;
  const hinted = session.hintedNodes.includes(node.id);
  const matchAction = node.actions.find(action => action.id === match?.actionId);
  const lastTurn = session.turns.at(-1);
  const lastAction = lastTurn && mission.nodes[lastTurn.nodeId].actions.find(action => action.id === lastTurn.actionId);
  const priorEvents = new Set(session.turns.slice(0, -1).flatMap(turn => mission.nodes[turn.nodeId].actions.find(action => action.id === turn.actionId)?.events ?? []));
  const newGoals = mission.objectives.filter(goal => session.events.includes(goal.id) && !priorEvents.has(goal.id));
  const nextGoal = mission.objectives.find(goal => goal.required && !session.events.includes(goal.id));
  const turnFeedback = lastAction?.errors[0] ? l(lastAction.errors[0].explanation) : newGoals.length ? a('goalsAdded', { count: newGoals.length }) : nextGoal ? a('nextGoal', { goal: l(nextGoal.label) }) : undefined;
  useLayoutEffect(() => { if (atBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight; }, [session.turns.length, busy, pending]);
  useLayoutEffect(() => {
    if (busy || !keyboardChoice.current) return;
    const previousFocus = keyboardChoice.current;
    keyboardChoice.current = null;
    const focusUnchanged = document.activeElement === previousFocus || (!previousFocus.isConnected && document.activeElement === document.body);
    if (atBottom.current && focusUnchanged) choiceHeading.current?.focus({ preventScroll: true });
  }, [node.id, busy]);
  useEffect(() => { setText(''); setMatch(undefined); }, [node.id]);
  const matchAnswer = () => setMatch(classifyFreeText(text, session, mission, getLocale()));
  const jumpToLatest = () => {
    if (log.current) { log.current.scrollTop = log.current.scrollHeight; log.current.focus({ preventScroll: true }); }
    atBottom.current = true; setAwayFromLatest(false); setSelectedTurn(undefined);
  };
  const jumpToTurn = (turn: number) => {
    const target = log.current?.querySelector<HTMLElement>(`[data-ac-chat-turn="${turn}"]`);
    if (!target) return;
    atBottom.current = false; setAwayFromLatest(true); setSelectedTurn(turn);
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
  };
  const returnToCurrent = () => {
    jumpToLatest();
    choiceHeading.current?.focus({ preventScroll: true });
    choiceHeading.current?.scrollIntoView?.({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return <div className="ac-training" data-ac-mission={mission.id} data-ac-node={node.id}>
    <div className="ac-training-top"><a className="ac-back-link" href="#academy/missions"><Icon name="arrow-left"/>{a('pause')}</a><span className="ac-muted"><Icon name="shield"/>{a(memoryWarning === 'unavailable' ? 'memoryOnly' : 'saved')}</span></div>
    <div className="ac-session-summary"><div><span className="ac-kicker">{a('currentStage')} · {a('turn', { number: session.turns.length + 1 })}</span><h1>{l(mission.title)}</h1><p className="ac-current-task"><Icon name="target"/>{l(node.title)}</p></div><span className="ac-pill">{a(`difficulty${mission.difficulty}`)}</span></div>
    <div className="ac-simulator-grid">
    <section className="ac-card ac-chat"><div className="ac-chat-head"><div className="ac-client-summary"><span className="ac-avatar" aria-hidden="true"><Icon name="dialogs"/></span><div><h2>{l(mission.client)}</h2><span>{a('localClient')} · <strong>{a(emotionName(session.emotion.stress))}</strong></span></div></div><div className="ac-client-state"><span>{a('stress')}: <strong>{session.emotion.stress}</strong>{previous && <small className={`ac-delta ${session.emotion.stress < previous.stress ? 'is-improving' : session.emotion.stress > previous.stress ? 'is-worsening' : ''}`}>{previous.stress} → {session.emotion.stress}</small>}</span><span>{a('trust')}: <strong>{session.emotion.trust}</strong>{previous && <small className={`ac-delta ${session.emotion.trust > previous.trust ? 'is-improving' : session.emotion.trust < previous.trust ? 'is-worsening' : ''}`}>{session.emotion.trust >= previous.trust ? '+' : '−'}{Math.abs(session.emotion.trust - previous.trust)}</small>}</span></div></div>
      <div className="ac-sr-only" role="status" aria-live="polite" aria-atomic="true">{session.turns.length > 0 && !busy ? `${a('turn', { number: session.turns.length })}. ${a('newClientMessage')} ${a(emotionName(session.emotion.stress))}.` : ''}</div>
      <div className="ac-chat-log" ref={log} tabIndex={0} role="log" aria-live="off" aria-label={a('simulator')} onScroll={() => { const element = log.current; if (element) { atBottom.current = selectedTurn === undefined && element.scrollHeight - element.scrollTop - element.clientHeight < 88; setAwayFromLatest(!atBottom.current); } }}>
        <ChatMessage kind="client">{l(mission.nodes[mission.start].prompt)}</ChatMessage>
        {session.turns.map((turn, index) => { const action = mission.nodes[turn.nodeId].actions.find(value => value.id === turn.actionId); const next = mission.nodes[turn.nextNodeId]; if (!action || !next) return null; return <div className={`ac-turn ${selectedTurn === index + 1 ? 'is-navigated' : ''}`} data-ac-chat-turn={index + 1} tabIndex={-1} aria-label={`${a('turn', { number: index + 1 })}: ${l(mission.nodes[turn.nodeId].title)}`} key={`${turn.nodeId}-${index}`}><ChatMessage kind="operator">{l(action.text)}</ChatMessage><ChatMessage kind="client">{l(turn.tense && action.tenseReaction ? action.tenseReaction : action.reaction)}</ChatMessage>{l(next.prompt) && <ChatMessage kind="client">{l(next.prompt)}</ChatMessage>}</div>; })}
        {pending && <ChatMessage kind="operator">{l(node.actions.find(action => action.id === pending)!.text)}</ChatMessage>}
        {busy && <div className="ac-typing" role="status"><i/><i/><i/><span>{a('responding')}</span></div>}
      </div>
      {awayFromLatest && <div className="ac-latest-control"><Button variant="secondary" icon="arrow-right" onClick={jumpToLatest} data-ac-latest>{a('latest')}</Button></div>}
      {lastTurn && turnFeedback && !busy && <div className={`ac-turn-feedback ${lastAction?.errors.length ? 'has-concern' : ''}`} data-ac-feedback><Icon name={lastAction?.errors.length ? 'book' : 'check'}/><div><strong>{a('afterResponse')}</strong><p>{turnFeedback}</p></div></div>}
      <div className="ac-composer" aria-busy={busy}><div className="ac-composer-head"><div><h3 ref={choiceHeading} tabIndex={-1}>{session.status === 'completed' ? a('finish') : a('chooseAnswer')}</h3><p className="ac-muted">{session.status === 'completed' ? l(node.title) : a('choiceHint')}</p></div></div>
      <SteppedHint key={`${session.id}-${node.id}`} missionId={mission.id} node={node} hinted={hinted} busy={busy} onUse={onHint}/>
      {session.status === 'completed' ? <Button onClick={onFinish} data-ac-finish>{a('finish')}</Button> : <><div className="ac-choices">{node.actions.map((action, index) => <button type="button" className={`ac-choice ${pending === action.id ? 'is-sent' : ''}`} key={action.id} disabled={busy} onClick={event => { keyboardChoice.current = event.detail === 0 ? event.currentTarget : null; onChoice(action.id); }} data-ac-choice={action.id}><span className="ac-choice-number" aria-hidden="true">{String.fromCharCode(65 + index)}</span><span>{l(action.text)}{pending === action.id && <small className="ac-choice-sent"><Icon name="check"/>{a('responseSent')}</small>}</span></button>)}</div>
      <details className="ac-text-experiment"><summary>{a('textMode')}</summary><p className="ac-muted">{a('textModeNote')}</p><label htmlFor="ac-free-answer" className="ac-sr-only">{a('answerPlaceholder')}</label><textarea id="ac-free-answer" className="ac-input" value={text} onChange={event => { setText(event.target.value); setMatch(undefined); }} maxLength={1000} placeholder={a('answerPlaceholder')} disabled={busy} autoComplete="off"/><Button variant="secondary" disabled={busy || !text.trim()} onClick={matchAnswer}>{a('matchText')}</Button>{match && <div className="ac-match-result" role="status"><p>{a(match.reason === 'matched' ? 'matchedText' : 'unknownText')}</p>{matchAction && <><blockquote>{l(matchAction.text)}</blockquote><Button onClick={() => { setText(''); setMatch(undefined); onChoice(matchAction.id); }} disabled={busy}>{a('useMatched')}</Button></>}</div>}</details></>}
      </div>
    </section>
    <aside className="ac-card ac-briefing"><details className="ac-training-details"><summary><Icon name="target"/>{a('taskDetails')}</summary><div className="ac-detail-content"><p>{l(mission.objective)}</p><p className="ac-muted">{l(mission.summary)}</p><nav className="ac-stages" aria-label={a('stages')}><h3>{a('stages')}</h3>{session.turns.map((turn, index) => <button type="button" className={`ac-stage ac-stage-link is-done ${selectedTurn === index + 1 ? 'is-selected' : ''}`} aria-current={selectedTurn === index + 1 ? 'step' : undefined} data-ac-timeline-turn={index + 1} onClick={() => jumpToTurn(index + 1)} key={`${turn.nodeId}-${index}`}><span className="ac-stage-index">{index + 1}</span><span>{l(mission.nodes[turn.nodeId].title)}</span></button>)}<button type="button" className="ac-stage ac-stage-link is-current" onClick={returnToCurrent} data-ac-current><span className="ac-stage-dot"/><span>{l(node.title)}<small>{tr('К текущему ответу', 'Ағымдағы жауапқа', 'Return to current response')}</small></span></button></nav></div></details><details className="ac-training-details"><summary><Icon name="book"/>{a('knowledge')}</summary><div className="ac-detail-content"><Knowledge mission={mission}/></div></details></aside>
    <aside className="ac-card ac-coach"><details className="ac-training-details"><summary><Icon name="heart"/>{a('clientDetails')}<span className="ac-goal-count">{mission.objectives.filter(goal => session.events.includes(goal.id)).length}/{mission.objectives.length}</span></summary><div className="ac-detail-content"><Emotions emotion={session.emotion} previous={previous} avatar/><p className="ac-direction-help">{a('emotionNotScore')}</p><div className="ac-goals"><h3>{a('goals')}</h3><Track value={mission.objectives.filter(goal => session.events.includes(goal.id)).length / mission.objectives.length * 100} label={a('goals')}/>{mission.objectives.map(goal => { const done = session.events.includes(goal.id); return <div className={`ac-goal ${done ? 'is-met' : ''}`} key={goal.id}><Icon name={done ? 'circleCheck' : 'target'}/><span>{l(goal.label)}<small>{a(done ? 'metGoal' : 'pendingGoal')}{!goal.required && ` · ${a('optional')}`}</small></span></div>; })}</div></div></details></aside></div>
  </div>;
}
function Result({ attempt, mission, state, celebration }: { attempt: Attempt; mission: Mission; state: AcademyState; celebration?: { levelUp: boolean } }) {
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget>();
  const recommended = recommendMission(state, missions) ?? mission;
  const errors = attempt.errors.flatMap(item => {
    const node = mission.nodes[item.nodeId];
    const action = node?.actions.find(value => value.id === item.actionId);
    const error = action?.errors.find(value => value.id === item.errorId);
    const ideal = node?.actions.find(value => value.id === node.idealActionId);
    return node && action && error && ideal ? [{ ...item, node, action, error, ideal }] : [];
  }).sort((left, right) => Number(Boolean(right.action.critical)) - Number(Boolean(left.action.critical)) || right.error.penalty - left.error.penalty || left.turn - right.turn);
  const criticalError = errors.find(item => item.action.critical);
  const missedRequired = mission.objectives.filter(goal => goal.required && attempt.missedGoals.includes(goal.id));
  const reason = a(attempt.critical ? 'resultReasonCritical' : attempt.passed ? 'resultReasonPassed' : missedRequired.length ? 'resultReasonGoals' : attempt.score < 70 ? 'resultReasonScore' : 'resultReasonEnding');
  const nextMission = attempt.passed ? recommended : mission;
  const nextMode = attempt.passed ? 'story' : attempt.mode;
  const showReward = Boolean(celebration && attempt.passed && attempt.xpEarned > 0);
  const feedbackItem = (item: typeof errors[number]) => <article className={`ac-feedback-item ${item.action.critical ? 'is-critical' : ''}`} key={`${item.turn}-${item.errorId}`} data-ac-feedback><span className="ac-pill">{a('turn', { number: item.turn })} · {l(item.node.title)}</span><div className="ac-response-comparison"><div><h4>{a('chosen')}</h4><blockquote>{l(item.action.text)}</blockquote></div><div className="ac-feedback-reason"><h4>{a('whyProblem')}</h4><p>{l(item.error.explanation)}</p></div><div className="ac-ideal-response"><h4>{a('ideal')}</h4><blockquote>{l(item.ideal.text)}</blockquote></div></div><div className="ac-feedback-actions"><Button variant="secondary" data-ac-open-reply={item.turn} onClick={() => setReviewTarget(previous => ({ turn: item.turn, revision: (previous?.revision ?? 0) + 1 }))}>{tr('К этой реплике', 'Осы жауапқа', 'Go to this reply')}</Button><MicroDrillButton missionId={mission.id} errorId={item.errorId}/></div></article>;
  return <div className={`ac-result ${showReward ? 'is-celebrating' : ''}`} data-ac-result={attempt.id}><div className="ac-breadcrumb"><a href="#academy/missions"><Icon name="arrow-left"/>{a('back')}</a><span>{l(mission.title)}</span></div>
    <section className={`ac-card ac-result-hero ${attempt.passed ? 'is-passed' : 'is-retry'}`}><div className="ac-score-ring" style={{ '--ac-score': `${attempt.score}%` } as CSSProperties}><div><strong>{attempt.score}</strong><span>/ 100</span></div></div><div className="ac-result-heading"><span className="ac-kicker">{a('score')}</span><h1>{a(attempt.passed ? 'passed' : 'retryTitle')}</h1><p className="ac-result-summary">{reason}</p><div className="ac-result-reward"><strong className="ac-xp-award">+{attempt.xpEarned} XP</strong><span>{a('earnedXP')}</span>{showReward && celebration?.levelUp && <span className="ac-pill ac-level-up">{a('levelUp')}</span>}</div>{attempt.xpEarned === 0 && <p className="ac-muted">{a(attempt.passed ? 'alreadyCounted' : 'noXPMissed')}</p>}<div className="ac-next-action"><LinkButton href={missionHash(nextMission, nextMode)} icon={attempt.passed ? 'arrow-right' : 'rotate'}>{a(attempt.passed ? 'next' : 'retry')}</LinkButton><p><strong>{l(nextMission.title)}</strong><span>{attempt.passed ? recommendationReason(state, nextMission) : a('retryText')}</span></p></div></div></section>
    {attempt.critical && <div className="ac-error ac-critical" role="alert"><Icon name="alert"/><div><strong>{a('critical')}</strong>{criticalError && <p>{a('turn', { number: criticalError.turn })}: {l(criticalError.error.explanation)}</p>}<p>{a('criticalText')}</p></div></div>}
    <div className="ac-result-columns"><section className="ac-card"><Heading title={a('criteria')} icon="chart"/>{SKILLS.map(skill => <div className="ac-skill-row" key={skill}><div><span>{l(skillNames[skill])}<small> · {WEIGHTS[skill]}%</small></span><strong>{attempt.skills[skill]}<small>/100</small></strong></div><Track value={attempt.skills[skill]} label={l(skillNames[skill])}/></div>)}<p className="ac-muted">{a('criteriaNote')}</p><ScoreBreakdown attempt={attempt}/></section><section className="ac-card"><Heading title={a('good')} icon="circleCheck"/>{attempt.passedChecks.length ? <ul className="ac-check-list">{mission.checks.filter(check => attempt.passedChecks.includes(check.id)).map(check => <li key={check.id}><Icon name="check"/>{l(check.label)}</li>)}</ul> : <p className="ac-muted">{a('noGood')}</p>}</section></div>
    <section className="ac-card ac-priority-feedback"><Heading title={a('mainFeedback')} icon="book"/>{errors.length ? errors.slice(0, 2).map(feedbackItem) : <p className="ac-notice"><Icon name="check"/>{a('noErrors')}</p>}{errors.length > 2 && <details className="ac-details"><summary>{a('otherFeedback', { count: errors.length - 2 })}</summary>{errors.slice(2).map(feedbackItem)}</details>}{attempt.missedChecks.length > 0 && <div className="ac-missed-checks"><h4>{a('needsWork')}</h4><ul>{mission.checks.filter(check => attempt.missedChecks.includes(check.id)).map(check => <li key={check.id}>{l(check.label)}</li>)}</ul></div>}<p className="ac-muted">{a('idealNote')}</p></section>
    {attempt.newAwards.length > 0 && <section className="ac-card ac-new-awards"><Heading title={a('newAwards')} icon="shield"/><div className="ac-award-list">{attempt.newAwards.filter(key => achievementNames[key]).map(key => <span key={key} className="ac-award"><Icon name={achievementNames[key].icon}/>{l(achievementNames[key].title)}</span>)}</div></section>}
    <details className="ac-card ac-details"><summary>{a('detailedGoals')}</summary><div className="ac-result-columns"><section><Heading title={a('goals')} icon="target"/>{mission.objectives.map(goal => { const done = attempt.completedGoals.includes(goal.id); return <div className={`ac-goal ${done ? 'is-met' : 'is-missed'}`} key={goal.id}><Icon name={done ? 'circleCheck' : 'alert'}/><span>{l(goal.label)}<small>{a(done ? 'metGoal' : 'missed')}{!goal.required && ` · ${a('optional')}`}</small></span></div>; })}</section><section><Heading title={a('change')} icon="heart"/><div className="ac-state-comparison"><div><span className="ac-kicker">{a('startState')}</span><Emotions emotion={attempt.initial}/></div><Icon name="arrow-right"/><div><span className="ac-kicker">{a('endState')}</span><Emotions emotion={attempt.final} previous={attempt.initial}/>{attempt.passed && attempt.final.stress <= 25 && attempt.final.trust >= 60 && <span className="ac-pill">{a('satisfied')}</span>}</div></div><p className="ac-direction-help">{a('emotionNotScore')}</p></section></div></details>
    <ReviewTranscript attempt={attempt} mission={mission} target={reviewTarget}/>
    <div className="ac-result-actions">{attempt.passed && <LinkButton href={missionHash(mission, attempt.mode)} secondary icon="rotate">{a('retry')}</LinkButton>}<a className="ac-button ac-secondary" href="#academy/missions">{a('openPracticeMap')}</a></div>
  </div>;
}

export function AcademyApp({ missionId, mode = 'story', resultId, initialTab = 'overview' }: { missionId?: string; mode?: Mode; resultId?: string; initialTab?: 'overview' | 'missions' | 'analytics' }) {
  const reading = useReadingPreset();
  const [loaded] = useState(initialProgress);
  const [state, setState] = useState(loaded.state);
  const stateRef = useRef(state);
  const [warning, setWarning] = useState(loaded.warning);
  const tab = initialTab;
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ session: Session; actionId: string }>();
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const mountedHash = useRef(window.location.hash);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const [celebration] = useState(() => { const value = pendingCelebration?.id === resultId ? pendingCelebration : undefined; if (value) pendingCelebration = undefined; return value; });
  const mission = missions.find(item => item.id === missionId);
  const session = mission && state.active?.missionId === mission.id && state.active.mode === mode ? state.active : null;
  const visibleSession = pending?.session ?? session;
  const attempt = resultId ? state.history.find(item => item.id === resultId) : undefined;
  const attemptMission = attempt ? missions.find(item => item.id === attempt.missionId) : undefined;
  leaveGuard = { active: Boolean(missionId && session?.status === 'active'), hash: mountedHash.current };
  function commit(next: AcademyState) {
    const merged = withStoredProgress(next);
    memoryState = merged;
    stateRef.current = merged;
    const saved = saveState(merged);
    memoryDirty = !saved;
    memoryWarning = saved ? undefined : 'unavailable';
    setWarning(memoryWarning);
    setState(merged);
    leaveGuard.active = Boolean(missionId && merged.active?.missionId === missionId && merged.active.status === 'active');
  }
  function recordCompleted(completed: Session) {
    if (!mission || completed.status !== 'completed') return undefined;
    const base = withStoredProgress(stateRef.current);
    const fresh = !base.history.some(item => item.id === completed.id);
    const before = levelInfo(getXP(base)).level;
    const next = completeSession(base, completed, mission);
    const recorded = next.history.find(item => item.id === completed.id);
    commit(next);
    return recorded ? { attempt: recorded, fresh, levelUp: levelInfo(getXP(next)).level > before } : undefined;
  }
  function showResult(recorded: NonNullable<ReturnType<typeof recordCompleted>>) {
    const { attempt: result, fresh, levelUp } = recorded;
    pendingCelebration = fresh && result.passed && result.xpEarned > 0 ? { id: result.id, levelUp } : undefined;
    go(resultHash(result.id));
  }
  function finish(completed: Session) {
    try { const recorded = recordCompleted(completed); if (recorded) showResult(recorded); }
    catch { setError(a('responseError')); }
  }
  useEffect(() => {
    alive.current = true;
    const receive = (next: AcademyState, reset: boolean) => {
      if (reset) { if (timer.current) clearTimeout(timer.current); busyRef.current = false; setBusy(false); setPending(undefined); }
      stateRef.current = next; setState(next); setWarning(memoryWarning);
    };
    progressSubscribers.add(receive);
    return () => { alive.current = false; progressSubscribers.delete(receive); if (timer.current) clearTimeout(timer.current); };
  }, []);
  // Older versions may have persisted a completed graph before recording its result.
  // Preserve that session and finalize it through the same idempotent engine function.
  useEffect(() => { if (session?.status === 'completed' && !busyRef.current) finish(session); }, [session?.id, session?.status]);
  function choose(actionId: string) {
    if (!session || !mission || busyRef.current || session.status !== 'active') return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const nextSession = responses.choose(session, mission, actionId);
      setPending({ session, actionId });
      // Awards and history are durable immediately, including on the final answer.
      // The short delay only displays the chosen response and local typing indicator.
      const recorded = nextSession.status === 'completed' ? recordCompleted(nextSession) : undefined;
      if (nextSession.status !== 'completed') commit({ ...stateRef.current, active: nextSession });
      timer.current = setTimeout(() => {
        if (!alive.current) return;
        busyRef.current = false; setBusy(false); setPending(undefined);
        if (recorded) showResult(recorded);
      }, 350);
    } catch { busyRef.current = false; setBusy(false); setPending(undefined); setError(a('responseError')); }
  }
  async function start() {
    if (!mission || !unlocked(stateRef.current, mission)) return;
    if (stateRef.current.active && (stateRef.current.active.missionId !== mission.id || stateRef.current.active.mode !== mode)) {
      const accepted = await confirmAcademy({ title: a('replaceTitle'), message: a('replaceSession'), confirmLabel: a('replaceButton'), cancelLabel: a('cancelAction') });
      if (!accepted || !alive.current) return;
    }
    pendingCelebration = undefined;
    commit({ ...stateRef.current, active: startSession(mission, mode) });
  }
  async function reset() {
    const accepted = await confirmAcademy({ title: a('resetTitle'), message: a('resetConfirm'), confirmLabel: a('reset'), cancelLabel: a('cancelAction'), danger: true });
    if (!accepted || !alive.current) return;
    const removed = resetProgress();
    if (!removed) { setError(a('resetError')); return; }
    const next = defaultState();
    memoryState = next; stateRef.current = next; setState(next);
    memoryDirty = !removed;
    memoryWarning = removed ? undefined : 'unavailable'; setWarning(memoryWarning);
    pendingCelebration = undefined; leaveGuard.active = false;
    if (window.location.hash !== '#academy') go('#academy');
  }
  const onDemo = (value: boolean) => commit({ ...stateRef.current, demoUnlocked: value });
  let content: ReactNode;
  if (resultId) content = attempt && attemptMission ? <Result attempt={attempt} mission={attemptMission} state={state} celebration={celebration}/> : <div className="ac-card ac-empty"><Icon name="search"/><h1>{a('unknownResult')}</h1><p>{a('unknownTextRoute')}</p><LinkButton href="#academy/missions">{a('back')}</LinkButton></div>;
  else if (missionId) content = mission ? visibleSession ? <Conversation mission={mission} session={visibleSession} busy={busy} pending={pending?.actionId} onChoice={choose} onHint={() => { if (!busyRef.current && stateRef.current.active) commit({ ...stateRef.current, active: markHintUsed(stateRef.current.active) }); }} onFinish={() => finish(visibleSession)}/> : <Briefing mission={mission} mode={mode} state={state} onStart={start} onDemo={onDemo}/> : <div className="ac-card ac-empty"><Icon name="search"/><h1>{a('unknownMission')}</h1><p>{a('unknownTextRoute')}</p><LinkButton href="#academy/missions">{a('back')}</LinkButton></div>;
  else content = <><nav className="ac-tabs" aria-label="Freedom Academy">{(['overview', 'missions', 'analytics'] as const).map(value => <button type="button" className={tab === value ? 'is-active' : ''} aria-current={tab === value ? 'page' : undefined} key={value} onClick={() => go(value === 'overview' ? '#academy' : value === 'missions' ? '#academy/missions' : '#academy/history')} data-ac-tab={value}><Icon name={value === 'overview' ? 'target' : value === 'missions' ? 'book' : 'chart'}/>{a(value)}</button>)}</nav>{tab === 'overview' ? <Dashboard state={state} onDemo={onDemo}/> : tab === 'missions' ? <><MissionDiscovery state={state} onDemo={onDemo} extraMistakes={<DrillCollection state={state}/>}/><InvestorGuidance/></> : <Analytics state={state}/>}</>;
  return <div className="academy" data-academy data-ac-reading-preset={reading.preset}><header className="ac-topline"><a className="ac-brandline" href="#academy"><span className="ac-brand-icon"><Icon name="book"/></span><strong>Freedom <span>Academy</span></strong></a><div className="ac-topline-actions"><ReadingPreferences preset={reading.preset} warning={reading.warning} onApply={reading.apply}/><GuidedStartButton/><span className="ac-pill ac-demo-badge"><span className="ac-status-dot"/>{a('demo')}</span><a className="ac-back-link" href="#dialogs"><Icon name="arrow-left"/>{a('home')}</a></div></header>{warning && <div className="ac-notice ac-storage-warning" role="alert"><Icon name="alert"/>{a(warning === 'corrupt' ? 'corruptStorage' : warning === 'incompatible' ? 'incompatibleStorage' : 'storageError')}</div>}{error && <div className="ac-error" role="alert">{error}</div>}{content}<footer className="ac-footer"><p>{a('disclaimer')}</p>{!missionId && !resultId && <Button variant="ghost" icon="rotate" onClick={reset} data-ac-reset>{a('reset')}</Button>}</footer><AcademyConfirm/></div>;
}

export default AcademyApp;
