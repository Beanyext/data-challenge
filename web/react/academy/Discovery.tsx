import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../shared';
import { getLocale } from '../i18n';
import { missions, SKILLS, skillNames, modeNames, modeDescriptions } from './missions';
import { dailyMission, recommendMission } from './engine';
import { tr, localized, isMissionAvailable, missionLink } from './feature-ui';
import type { AcademyState, Attempt, Locale, Mission, Mode, QualityError, Skill } from './types';

const MODES: Mode[] = ['story', 'quick', 'daily', 'mistakes', 'boss'];
const modeIcons: Record<Mode, string> = { story: 'book', quick: 'phone', daily: 'target', mistakes: 'rotate', boss: 'shield' };

/** Existing mission-card focus labels; this is display metadata, not new scoring. */
export const MISSION_FOCUS: Record<string, readonly Skill[]> = {
  login: ['safety', 'professionalism'], order: ['accuracy', 'resolution'], losses: ['empathy', 'safety'],
  withdrawal: ['accuracy', 'professionalism'], fee: ['accuracy', 'professionalism'],
  dividends: ['accuracy', 'resolution'], security: ['safety', 'empathy'], boss: ['empathy', 'safety'],
};
const focusOf = (mission: Mission): readonly Skill[] => MISSION_FOCUS[mission.id] ?? ['accuracy'];
export interface MissionFilters { query: string; skill: 'all' | Skill; difficulty: 'all' | '1' | '2' | '3' }
const emptyFilters = (): MissionFilters => ({ query: '', skill: 'all', difficulty: 'all' });

function mostFrequentErrorMission(state: AcademyState): Mission | undefined {
  const occurrences = new Map<string, { count: number; mission: Mission }>();
  // Keep the existing chronological insertion order when frequencies tie.
  for (const attempt of state.history) {
    const mission = missions.find(item => item.id === attempt.missionId);
    if (!mission) continue;
    for (const item of attempt.errors) {
      const error = mission.nodes[item.nodeId]?.actions.find(action => action.id === item.actionId)?.errors.find(error => error.id === item.errorId);
      if (!error) continue;
      const previous = occurrences.get(error.id);
      occurrences.set(error.id, { count: (previous?.count ?? 0) + 1, mission });
    }
  }
  return [...occurrences.values()].sort((left, right) => right.count - left.count)[0]?.mission;
}

/** Filters are deliberately applied after the existing mode chooses its dataset. */
export function missionsForMode(state: AcademyState, mode: Mode, now = new Date()): Mission[] {
  if (mode === 'story') return [...missions];
  const target = mode === 'quick' ? missions.filter(mission => isMissionAvailable(state, mission)).sort((left, right) => left.duration - right.duration)[0]
    : mode === 'daily' ? dailyMission(missions, now)
      : mode === 'boss' ? missions[missions.length - 1]
        : mostFrequentErrorMission(state) ?? missions[0];
  return target ? [target] : [];
}

export function filterMissions(source: Mission[], filters: MissionFilters, locale: Locale): Mission[] {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase(locale).replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const query = normalize(filters.query);
  return source.filter(mission => (!query || normalize(mission.title[locale]).includes(query))
    && (filters.skill === 'all' || focusOf(mission).includes(filters.skill))
    && (filters.difficulty === 'all' || mission.difficulty === Number(filters.difficulty)));
}

const difficultyName = (level: number) => level === 1 ? tr('Начальная', 'Бастапқы', 'Starter') : level === 2 ? tr('Средняя', 'Орташа', 'Intermediate') : tr('Сложная', 'Күрделі', 'Advanced');
type MissionStatus = 'current' | 'locked' | 'mastered' | 'retry' | 'available';
function statusName(status: MissionStatus): string {
  const names: Record<MissionStatus, string> = {
    current: tr('В работе', 'Орындалып жатыр', 'In progress'), locked: tr('Закрыто', 'Жабық', 'Locked'),
    mastered: tr('Пройдено', 'Орындалды', 'Mastered'), retry: tr('Нужно повторить', 'Қайталау қажет', 'Practise again'),
    available: tr('Доступно', 'Қолжетімді', 'Available'),
  };
  return names[status];
}
function missionStatus(state: AcademyState, mission: Mission): MissionStatus {
  if (state.active?.missionId === mission.id && state.active.status === 'active') return 'current';
  if (!isMissionAvailable(state, mission)) return 'locked';
  if (state.mastered.includes(mission.id)) return 'mastered';
  return state.history.some(attempt => attempt.missionId === mission.id) ? 'retry' : 'available';
}

function MissionItem({ mission, state, mode, recommended }: { mission: Mission; state: AcademyState; mode: Mode; recommended: boolean }) {
  const status = missionStatus(state, mission);
  const active = state.active?.missionId === mission.id ? state.active : undefined;
  const mastered = state.mastered.includes(mission.id);
  const demoAccess = state.demoUnlocked && !mastered && state.mastered.length < mission.unlock;
  const locked = status === 'locked';
  const action = active ? active.status === 'active' ? tr('Продолжить тренировку', 'Жаттығуды жалғастыру', 'Continue training') : tr('Открыть результат', 'Нәтижені ашу', 'Open result')
    : locked ? tr('Посмотреть условия', 'Шарттарды көру', 'View requirements') : tr('Открыть миссию', 'Миссияны ашу', 'Open mission');
  return <a className={`ac-mission-card acf-mission-link ${locked ? 'is-locked' : ''} ${mastered ? 'is-complete' : ''} ${status === 'current' ? 'is-current' : ''}`}
    href={missionLink(mission.id, active?.mode ?? mode)} data-ac-mission={mission.id} data-ac-status={status} data-ac-recommended={recommended ? 'true' : undefined} aria-current={status === 'current' ? 'step' : undefined}>
    <div className="ac-mission-top"><span className="acf-mission-number">{tr('Миссия', 'Миссия', 'Mission')} {String(mission.order + 1).padStart(2, '0')}</span><div className="acf-statuses"><span className={`ac-pill is-${mastered && status !== 'current' ? 'mastered' : status}`}><Icon name={status === 'locked' ? 'shield' : status === 'mastered' ? 'check' : status === 'current' ? 'target' : 'book'}/>{statusName(status)}</span>{recommended && status !== 'current' && !locked && <span className="ac-pill is-green">{tr('Рекомендовано', 'Ұсынылады', 'Recommended')}</span>}{mastered && status === 'current' && <span className="ac-pill is-mastered">{tr('Пройдено ранее', 'Бұрын орындалған', 'Previously mastered')}</span>}</div></div>
    <h3>{localized(mission.title)}</h3>{demoAccess && <span className="ac-pill is-warning" data-ac-demo-access>{tr('Доступно в демо', 'Демода қолжетімді', 'Available in demo')}</span>}<p>{localized(mission.summary)}</p>
    <div className="acf-focus"><span>{tr('Фокус', 'Негізгі дағды', 'Focus')}:</span>{focusOf(mission).map(skill => <span key={skill}>{localized(skillNames[skill])}</span>)}</div>
    <div className="ac-mission-meta"><span>{difficultyName(mission.difficulty)}</span><span>{mission.duration} {tr('мин', 'мин', 'min')}</span><strong>{tr('До', 'Ең көбі', 'Up to')} {mission.maxXP} XP</strong></div>
    {locked && <p className="acf-unlock" data-ac-unlock>{tr('Условие открытия: освоенные миссии', 'Ашылу шарты: меңгерілген миссиялар', 'Unlock requirement: mastered missions')} — {state.mastered.length}/{mission.unlock}. {tr('Осталось освоить', 'Әлі меңгеру керек', 'Still to master')}: {Math.max(0, mission.unlock - state.mastered.length)}.</p>}
    <div className="ac-mission-bottom"><span>{state.best[mission.id] !== undefined ? <>{tr('Лучший результат', 'Үздік нәтиже', 'Best score')}: <strong>{state.best[mission.id]}/100</strong></> : tr('Без таймера и гонки за скоростью', 'Таймерсіз және жылдамдық жарысынсыз', 'No timer or speed targets')}</span><span className="acf-mission-action">{action}<Icon name="arrow-right"/></span></div>
  </a>;
}

export function MissionDiscovery({ state, onDemo, extraMistakes }: { state: AcademyState; onDemo: (value: boolean) => void; extraMistakes?: ReactNode }) {
  const [mode, setMode] = useState<Mode>('story');
  const [filters, setFilters] = useState<MissionFilters>(emptyFilters);
  const titleId = useId();
  const source = missionsForMode(state, mode);
  const visible = filterMissions(source, filters, getLocale());
  const recommended = recommendMission(state, missions)?.id;
  const filtered = Boolean(filters.query || filters.skill !== 'all' || filters.difficulty !== 'all');
  return <section className="ac-mission-map acf-discovery" aria-labelledby={titleId} data-ac-discovery>
    <div className="ac-section-heading"><div><span className="ac-kicker">FREEDOM ACADEMY</span><h2 id={titleId}>{tr('Выберите следующую тренировку', 'Келесі жаттығуды таңдаңыз', 'Choose your next practice')}</h2><p>{tr('Найдите ситуацию по названию, навыку и сложности.', 'Жағдайды атауы, дағдысы және қиындығы бойынша табыңыз.', 'Find a situation by its title, skill and difficulty.')}</p></div>
      <label className="ac-demo-switch"><input type="checkbox" role="switch" checked={state.demoUnlocked} onChange={event => onDemo(event.target.checked)} data-ac-demo-unlock/><span><strong>{tr('Режим демонстрации', 'Демонстрация режимі', 'Demonstration mode')}</strong><small>{tr('Открывает миссии. Не выдаёт XP и отметки прохождения.', 'Миссияларды ашады. XP мен орындалу белгісін бермейді.', 'Unlocks missions. Awards no XP or completion marks.')}</small></span></label>
    </div>
    <div className="acf-discovery-modes" role="group" aria-label={tr('Режим тренировки', 'Жаттығу режимі', 'Practice mode')}>{MODES.map(value => <button type="button" key={value} className={mode === value ? 'is-active' : ''} aria-pressed={mode === value} onClick={() => setMode(value)} data-ac-mode={value}><Icon name={modeIcons[value]}/><span>{localized(modeNames[value])}</span></button>)}</div>
    <p className="acf-mode-description">{localized(modeDescriptions[mode])}</p>
    <form className="acf-filters" role="search" aria-label={tr('Подбор миссии', 'Миссияны іріктеу', 'Find a mission')} onSubmit={event => event.preventDefault()}>
      <div className="acf-filter-fields"><label><span>{tr('Название миссии', 'Миссия атауы', 'Mission title')}</span><input type="search" value={filters.query} onChange={event => setFilters(previous => ({ ...previous, query: event.target.value }))} placeholder={tr('Например, заявка', 'Мысалы, өтінім', 'For example, order')} data-ac-mission-search/></label>
        <label><span>{tr('Навык', 'Дағды', 'Skill')}</span><select value={filters.skill} onChange={event => setFilters(previous => ({ ...previous, skill: event.target.value as MissionFilters['skill'] }))} data-ac-skill-filter><option value="all">{tr('Все навыки', 'Барлық дағдылар', 'All skills')}</option>{SKILLS.map(skill => <option value={skill} key={skill}>{localized(skillNames[skill])}</option>)}</select></label>
        <label><span>{tr('Сложность', 'Қиындық', 'Difficulty')}</span><select value={filters.difficulty} onChange={event => setFilters(previous => ({ ...previous, difficulty: event.target.value as MissionFilters['difficulty'] }))} data-ac-difficulty-filter><option value="all">{tr('Любая', 'Кез келген', 'Any difficulty')}</option>{[1, 2, 3].map(level => <option value={level} key={level}>{difficultyName(level)}</option>)}</select></label></div>
      <div className="acf-filter-summary"><p role="status" aria-live="polite" data-ac-results-count>{tr('Найдено', 'Табылды', 'Found')}: <strong>{visible.length}</strong> / {source.length} · {localized(modeNames[mode])}</p><button type="button" className="ac-button ac-ghost" disabled={!filtered} onClick={() => setFilters(emptyFilters())} data-ac-filter-reset>{tr('Сбросить фильтры', 'Сүзгілерді тазарту', 'Reset filters')}</button></div>
    </form>
    {mode === 'story' && <p className="acf-route-note">{tr('Это маршрут для ориентира. Доступ зависит от числа освоенных миссий, а не от прохождения предыдущей карточки.', 'Бұл бағдар беретін бағыт. Қолжетімділік алдыңғы карточканы орындауға емес, меңгерілген миссиялар санына байланысты.', 'This route is a guide. Access depends on the number of mastered missions, not on completing the preceding card.')}{filtered && ` ${tr('Показана отфильтрованная часть маршрута.', 'Бағыттың сүзілген бөлігі көрсетілген.', 'A filtered part of the route is shown.')}`}</p>}
    {mode === 'mistakes' && !mostFrequentErrorMission(state) && <p className="ac-notice">{tr('В истории пока нет разобранных ошибок. Начните с первой миссии; отдельная отработка появится после сохранённого разбора.', 'Тарихта талданған қателер әлі жоқ. Бірінші миссиядан бастаңыз; жеке жаттығу сақталған талдаудан кейін пайда болады.', 'There are no reviewed errors in your history yet. Start with the first mission; targeted practice becomes useful after a saved review.')}</p>}
    {!visible.length ? <div className="acf-no-missions" data-ac-no-missions><Icon name="search"/><h3>{tr('По этим фильтрам миссий нет', 'Бұл сүзгілерге сай миссия жоқ', 'No missions match these filters')}</h3><p>{tr('Измените название, навык или сложность. Это не означает, что миссии закрыты.', 'Атауды, дағдыны немесе қиындықты өзгертіңіз. Бұл миссиялар жабық дегенді білдірмейді.', 'Change the title, skill or difficulty. This does not mean the missions are locked.')}</p><button type="button" className="ac-button ac-secondary" onClick={() => setFilters(emptyFilters())} data-ac-empty-reset>{tr('Показать весь текущий режим', 'Ағымдағы режимді толық көрсету', 'Show this mode without filters')}</button></div>
      : mode === 'story' ? <ol className="acf-story-path" data-ac-story-path>{visible.map(mission => { const status = missionStatus(state, mission); return <li key={mission.id} className={`is-${status}`}><span className="acf-path-marker" aria-hidden="true">{status === 'mastered' ? <Icon name="check"/> : status === 'locked' ? <Icon name="shield"/> : String(mission.order + 1).padStart(2, '0')}</span><MissionItem mission={mission} state={state} mode={mode} recommended={recommended === mission.id}/></li>; })}</ol>
        : <div className="ac-mission-grid is-single">{visible.map(mission => <MissionItem key={mission.id} mission={mission} state={state} mode={mode} recommended={recommended === mission.id}/>)}</div>}
    {mode === 'mistakes' && extraMistakes}
  </section>;
}

export function skillAverage(state: AcademyState, skill: Skill): number | null {
  return state.history.length ? Math.round(state.history.reduce((sum, attempt) => sum + attempt.skills[skill], 0) / state.history.length) : null;
}
export interface SkillEvidence { attempt: Attempt; mission: Mission; error: QualityError; nodeId: string; actionId: string; turn: number }
export function skillEvidence(state: AcademyState, skill: Skill): SkillEvidence[] {
  const evidence: SkillEvidence[] = [];
  for (const attempt of [...state.history].reverse()) {
    const mission = missions.find(item => item.id === attempt.missionId);
    if (!mission) continue;
    for (const item of attempt.errors) {
      const error = mission.nodes[item.nodeId]?.actions.find(action => action.id === item.actionId)?.errors.find(error => error.id === item.errorId);
      if (error?.skill === skill) evidence.push({ attempt, mission, error, nodeId: item.nodeId, actionId: item.actionId, turn: item.turn });
    }
  }
  return evidence;
}
export function recommendForSkill(state: AcademyState, skill: Skill): Mission | undefined {
  const errorMission = skillEvidence(state, skill).find(item => isMissionAvailable(state, item.mission))?.mission;
  if (errorMission) return errorMission;
  const available = missions.filter(mission => isMissionAvailable(state, mission));
  const focused = available.filter(mission => focusOf(mission).includes(skill));
  const candidates = focused.length ? focused : available.filter(mission => mission.checks.some(check => check.skill === skill));
  return candidates.find(mission => !state.mastered.includes(mission.id)) ?? candidates[0];
}
const resultLink = (id: string) => `#academy/result/${encodeURIComponent(id)}`;
const dateLabel = (value: string) => new Intl.DateTimeFormat({ ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' }[getLocale()], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export function SkillInsights({ state }: { state: AcademyState }) {
  const [expanded, setExpanded] = useState<Skill | null>(null);
  const sectionId = useId();
  return <section className="ac-card acf-skill-insights" aria-labelledby={`${sectionId}-title`} data-ac-skill-insights>
    <div className="ac-card-head"><h3 id={`${sectionId}-title`}><Icon name="chart"/>{tr('Навыки: оценки и примеры', 'Дағдылар: бағалар мен мысалдар', 'Skills: scores and examples')}</h3></div>
    {!state.history.length ? <p className="ac-empty" data-ac-skills-empty>{tr('После первой завершённой миссии здесь появятся реальные оценки, их основания и подходящие упражнения.', 'Алғашқы аяқталған миссиядан кейін мұнда нақты бағалар, олардың негіздері және тиісті жаттығулар пайда болады.', 'After your first completed mission, this section will show real scores, their evidence and suitable practice.')}</p>
      : <><p className="acf-skill-intro">{tr('Раскройте навык, чтобы увидеть основания среднего балла.', 'Орташа бағаның негізін көру үшін дағдыны ашыңыз.', 'Expand a skill to see what its average is based on.')}</p><div className="acf-skill-list">{SKILLS.map(skill => {
        const average = skillAverage(state, skill)!;
        const open = expanded === skill;
        const examples = skillEvidence(state, skill);
        const recommended = recommendForSkill(state, skill);
        const panelId = `${sectionId}-${skill}`;
        return <div className={`acf-skill-item ${open ? 'is-open' : ''}`} key={skill}><button type="button" className="acf-skill-button" aria-expanded={open} aria-controls={panelId} onClick={() => setExpanded(open ? null : skill)} data-ac-skill={skill} data-ac-skill-average={average}><span className="acf-skill-heading"><span>{localized(skillNames[skill])}</span><strong>{average}<span>/100</span></strong><span className="acf-expand-symbol" aria-hidden="true">{open ? '−' : '+'}</span></span><span className="acf-skill-track" aria-hidden="true"><span style={{ width: `${average}%` }}/></span><span className="acf-skill-count">{tr('Попыток в расчёте', 'Есепке алынған талпыныстар', 'Attempts included')}: {state.history.length}</span></button>
          {open && <div id={panelId} className="acf-skill-detail" data-ac-skill-detail={skill}><p>{tr('Среднее по сохранённым завершённым попыткам. Просмотр не меняет оценку или XP.', 'Сақталған аяқталған талпыныстардың орташа бағасы. Қарау бағаны немесе XP-ді өзгертпейді.', 'The average of saved completed attempts. Viewing this does not change scores or XP.')}</p>
            {examples.length ? <><h4>{tr('Примеры из вашего разбора', 'Талдауыңыздан мысалдар', 'Examples from your reviews')}</h4><ul className="acf-skill-evidence">{examples.slice(0, 3).map(item => <li key={`${item.attempt.id}:${item.turn}:${item.error.id}`} data-ac-error-evidence={`${item.attempt.id}:${item.turn}:${item.error.id}`}><p>{localized(item.error.explanation)}</p><span className="acf-evidence-meta">{localized(item.mission.title)} · {tr('Ход', 'Кезек', 'Turn')} {item.turn} · {dateLabel(item.attempt.finishedAt)}</span><a href={resultLink(item.attempt.id)}>{tr('Открыть этот разбор', 'Осы талдауды ашу', 'Open this review')}<Icon name="arrow-right"/></a></li>)}</ul>{examples.length > 3 && <p className="acf-evidence-meta">{tr('Показаны последние примеры', 'Соңғы мысалдар көрсетілген', 'Showing the latest examples')}: 3 / {examples.length}.</p>}</>
              : <><p>{tr('Отмеченных ошибок по этому навыку нет. Балл также зависит от выполненных проверок.', 'Бұл дағды бойынша белгіленген қателер жоқ. Баға орындалған тексерістерге де байланысты.', 'No recorded errors for this skill. The score also depends on completed checks.')}</p><ul className="acf-skill-samples">{[...state.history].reverse().slice(0, 3).map(attempt => { const mission = missions.find(item => item.id === attempt.missionId); return mission ? <li key={attempt.id}><a href={resultLink(attempt.id)}><span>{localized(mission.title)}<small>{dateLabel(attempt.finishedAt)}</small></span><strong>{attempt.skills[skill]}/100</strong></a></li> : null; })}</ul></>}
            {recommended && <div className="acf-skill-recommendation"><span className="ac-kicker">{tr('Подходящая практика', 'Тиісті жаттығу', 'Relevant practice')}</span><strong>{localized(recommended.title)}</strong><p>{focusOf(recommended).includes(skill) ? tr('Навык входит в основной фокус этой миссии.', 'Дағды осы миссияның негізгі бағытына кіреді.', 'This skill is a main focus of the mission.') : tr('В этой миссии есть проверка выбранного навыка.', 'Бұл миссияда таңдалған дағды тексеріледі.', 'This mission includes a check for the selected skill.')}</p><a className="ac-button ac-secondary" href={missionLink(recommended.id)} data-ac-skill-practice={skill}>{tr('Потренировать навык', 'Дағдыны жаттықтыру', 'Practise this skill')}<Icon name="arrow-right"/></a></div>}
          </div>}
        </div>;
      })}</div></>}
  </section>;
}
