import { useEffect, useId, useRef, useState } from 'react';
import { getLocale } from '../i18n';
import { WEIGHTS } from './engine';
import { missions, SKILLS, skillNames } from './missions';
import { localized, tr } from './feature-ui';
import type { Attempt, Mission, QualityError } from './types';

/** Display arithmetic only: the saved evaluation remains the source of truth. */
export function scoreContributions(attempt: Attempt) {
  const rows = SKILLS.map(skill => ({ skill, score: attempt.skills[skill], weight: WEIGHTS[skill], contribution: attempt.skills[skill] * WEIGHTS[skill] / 100 }));
  return { rows, sum: rows.reduce((total, row) => total + row.contribution, 0) };
}

const number = (value: number) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(value);
const difference = (value: number) => `${value > 0 ? '+' : ''}${number(value)}`;
const turnLabel = (turn: number) => `${tr('Ход', 'Қадам', 'Turn')} ${turn}`;
const date = (value: string) => new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Qyzylorda' }).format(new Date(value));

export function ScoreBreakdown({ attempt }: { attempt: Attempt }) {
  const { rows, sum } = scoreContributions(attempt);
  const heading = useId();
  return <section className="ac-breakdown" aria-labelledby={heading} data-ac-score-breakdown>
    <h3 id={heading}>{tr('Как сложился итог', 'Қорытынды қалай есептелді', 'How the score adds up')}</h3>
    <p className="ac-muted">{tr('Вклад каждого критерия в 100 возможных баллов. Раскройте строку, чтобы увидеть расчёт.', 'Әр критерийдің мүмкін 100 балға үлесі. Есептеуді көру үшін жолды ашыңыз.', 'Each criterion contributes to a possible 100 points. Expand a row to see the calculation.')}</p>
    <div className="ac-breakdown-bar" aria-hidden="true">{rows.map(row => <span key={row.skill} className={`ac-breakdown-segment is-${row.skill}`} style={{ width: `${row.contribution}%` }}/>)}</div>
    <div className="ac-breakdown-rows">{rows.map(row => <details className={`ac-breakdown-row is-${row.skill}`} key={row.skill} data-ac-contribution={row.skill}>
      <summary><span className="ac-breakdown-name"><i aria-hidden="true"/>{localized(skillNames[row.skill])}</span><strong>{number(row.contribution)}<small> / {row.weight}</small></strong></summary>
      <div className="ac-breakdown-formula"><p><strong>{row.score}</strong> / 100 × <strong>{row.weight}</strong> = <strong>{number(row.contribution)}</strong> {tr('балла к итогу', 'қорытынды балл', 'points toward the total')}</p><p className="ac-muted">{tr('Сохранённая оценка × вес критерия.', 'Сақталған баға × критерий салмағы.', 'Saved criterion score × its weight.')}</p></div>
    </details>)}</div>
    <dl className="ac-breakdown-total"><div><dt>{tr('Взвешенная сумма', 'Салмақталған қосынды', 'Weighted sum')}</dt><dd data-ac-weighted-sum={sum}>{number(sum)} / 100</dd></div><div><dt>{tr('После округления', 'Дөңгелектегеннен кейін', 'After rounding')}</dt><dd data-ac-rounded-score={attempt.rawScore}>{attempt.rawScore} / 100</dd></div><div><dt>{tr('Сохранённый итог', 'Сақталған қорытынды', 'Saved final score')}</dt><dd data-ac-final-score={attempt.score}>{attempt.score} / 100</dd></div></dl>
    <p className="ac-breakdown-note">{tr('Округляется общая сумма до ближайшего целого; половина балла округляется вверх. Это объяснение сохранённой оценки, а не новое оценивание.', 'Жалпы қосынды ең жақын бүтін санға дөңгелектенеді; жарты балл жоғары дөңгелектенеді. Бұл — сақталған бағаның түсіндірмесі, жаңа бағалау емес.', 'The total is rounded to the nearest whole point, with half points rounded up. This explains the saved score; it does not evaluate the attempt again.')}</p>
    {attempt.critical && <div className="ac-breakdown-critical" data-ac-score-cap><strong>{tr('Критическое нарушение: два ограничения', 'Өрескел бұзушылық: екі шектеу', 'Critical violation: two safeguards')}</strong><p>{tr('Безопасность уже обнулена до взвешивания: 0 × 25% = 0. После округления итог ограничен 49 баллами.', 'Қауіпсіздік салмақтау алдында нөлге түсірілген: 0 × 25% = 0. Дөңгелектеуден кейін қорытынды 49 балмен шектеледі.', 'Safety is already zeroed before weighting: 0 × 25% = 0. After rounding, the final score is capped at 49.')}</p><p><strong>min({attempt.rawScore}, 49) = {attempt.score}</strong></p></div>}
  </section>;
}

export function orderAttempts(attempts: Attempt[]) {
  return [...attempts].sort((left, right) => Date.parse(left.finishedAt) - Date.parse(right.finishedAt) || left.id.localeCompare(right.id));
}

/** Compare existing IDs, without inferring why an error did or did not recur. */
export function compareAttemptErrors(earlier: Attempt, later: Attempt) {
  const before = new Set(earlier.errors.map(error => error.errorId));
  const after = new Set(later.errors.map(error => error.errorId));
  return { absentLater: [...before].filter(id => !after.has(id)), repeated: [...before].filter(id => after.has(id)), addedLater: [...after].filter(id => !before.has(id)) };
}

function errorFor(mission: Mission, attempt: Attempt, errorId: string): QualityError | undefined {
  const reference = attempt.errors.find(error => error.errorId === errorId);
  return reference && mission.nodes[reference.nodeId]?.actions.find(action => action.id === reference.actionId)?.errors.find(error => error.id === reference.errorId);
}

function CompareErrors({ mission, earlier, later }: { mission: Mission; earlier: Attempt; later: Attempt }) {
  const groups = compareAttemptErrors(earlier, later);
  const sections = [
    { key: 'absent', ids: groups.absentLater, attempt: earlier, title: tr('Не повторились', 'Қайталанбады', 'Not repeated'), note: tr('Замечания ранней попытки, которых нет в поздней.', 'Ертерек әрекеттегі ескертулер кейінгі әрекетте жоқ.', 'Errors from the earlier attempt absent from the later one.') },
    { key: 'repeated', ids: groups.repeated, attempt: later, title: tr('Повторились', 'Қайталанды', 'Repeated'), note: tr('Одинаковые замечания есть в обеих попытках.', 'Бірдей ескертулер екі әрекетте де бар.', 'The same errors occur in both attempts.') },
    { key: 'added', ids: groups.addedLater, attempt: later, title: tr('Добавились в поздней попытке', 'Кейінгі әрекетте қосылды', 'Appeared in the later attempt'), note: tr('Замечания, которых не было в ранней попытке.', 'Ертерек әрекетте болмаған ескертулер.', 'Errors absent from the earlier attempt.') },
  ];
  return <div className="ac-compare-errors">{sections.map(section => <section key={section.key} data-ac-compare-errors={section.key}><h4>{section.title} <span>({section.ids.length})</span></h4><p className="ac-muted">{section.note}</p>{section.ids.length ? <ul>{section.ids.map(id => { const error = errorFor(mission, section.attempt, id); const before = earlier.errors.filter(item => item.errorId === id).map(item => item.turn); const after = later.errors.filter(item => item.errorId === id).map(item => item.turn); return <li key={id}>{error ? localized(error.explanation) : tr('Пояснение недоступно для этой версии задания.', 'Тапсырманың бұл нұсқасына түсіндірме қолжетімсіз.', 'The explanation is unavailable for this mission version.')}<small>{before.length > 0 && `${tr('Раньше', 'Ертерек', 'Earlier')}: ${before.map(turnLabel).join(', ')}`}{before.length > 0 && after.length > 0 && ' · '}{after.length > 0 && `${tr('Позже', 'Кейінірек', 'Later')}: ${after.map(turnLabel).join(', ')}`}</small></li>; })}</ul> : <p className="ac-compare-empty">{tr('Таких замечаний нет.', 'Мұндай ескертулер жоқ.', 'No errors in this group.')}</p>}</section>)}</div>;
}

export function AttemptComparison({ history }: { history: Attempt[] }) {
  const known = missions.filter(mission => history.some(attempt => attempt.missionId === mission.id));
  const [missionId, setMissionId] = useState(() => known.find(mission => history.filter(item => item.missionId === mission.id).length > 1)?.id ?? known[0]?.id ?? '');
  const [chosen, setChosen] = useState<[string, string]>(['', '']);
  const heading = useId();
  const mission = known.find(item => item.id === missionId) ?? known[0];
  const attempts = mission ? orderAttempts(history.filter(item => item.missionId === mission.id)) : [];
  const first = attempts.find(item => item.id === chosen[0]) ?? attempts.at(-2);
  const second = attempts.find(item => item.id === chosen[1] && item.id !== first?.id) ?? [...attempts].reverse().find(item => item.id !== first?.id);
  const pair = first && second ? orderAttempts([first, second]) : [];
  const earlier = pair[0], later = pair[1];
  const label = (attempt: Attempt) => `${tr('Попытка', 'Әрекет', 'Attempt')} ${attempts.findIndex(item => item.id === attempt.id) + 1} · ${date(attempt.finishedAt)} · ${attempt.score}/100`;
  return <section className="ac-card ac-compare" aria-labelledby={heading} data-ac-attempt-comparison>
    <h2 id={heading}>{tr('Сравнить попытки', 'Әрекеттерді салыстыру', 'Compare attempts')}</h2>
    <p className="ac-muted">{tr('Две сохранённые попытки одной миссии. Разница описывает результаты, но сама по себе не объясняет причину изменений.', 'Бір миссияның сақталған екі әрекеті. Айырмашылық нәтижелерді сипаттайды, бірақ өзгерістің себебін өздігінен түсіндірмейді.', 'Two saved attempts at the same mission. Differences describe the results; they do not explain what caused a change.')}</p>
    {mission ? <><label className="ac-compare-select">{tr('Миссия', 'Миссия', 'Mission')}<select data-ac-compare-mission value={mission.id} onChange={event => { setMissionId(event.target.value); setChosen(['', '']); }}>{known.map(item => <option key={item.id} value={item.id}>{localized(item.title)}</option>)}</select></label>
      {earlier && later ? <><div className="ac-compare-selectors">{([0, 1] as const).map((slot) => { const own = slot === 0 ? first! : second!; const other = slot === 0 ? second! : first!; return <label className="ac-compare-select" key={slot}>{slot === 0 ? tr('Первая выбранная попытка', 'Бірінші таңдалған әрекет', 'First selected attempt') : tr('Вторая выбранная попытка', 'Екінші таңдалған әрекет', 'Second selected attempt')}<select data-ac-compare-attempt={slot} value={own.id} onChange={event => setChosen(slot === 0 ? [event.target.value, other.id] : [other.id, event.target.value])}>{attempts.map(item => <option key={item.id} value={item.id} disabled={item.id === other.id}>{label(item)}</option>)}</select></label>; })}</div>
        <div className="ac-compare-summaries">{[earlier, later].map((attempt, index) => <article className={`ac-compare-summary ${attempt.critical ? 'is-critical' : ''}`} key={attempt.id} data-ac-compare-summary={index === 0 ? 'earlier' : 'later'} data-ac-attempt-id={attempt.id}><h3>{index === 0 ? tr('Раньше', 'Ертерек', 'Earlier') : tr('Позже', 'Кейінірек', 'Later')} · {tr('попытка', 'әрекет', 'attempt')} {attempts.findIndex(item => item.id === attempt.id) + 1}</h3><time dateTime={attempt.finishedAt}>{date(attempt.finishedAt)}</time><strong className="ac-compare-score">{attempt.score}<small> / 100</small></strong><p className={attempt.critical ? 'ac-compare-critical' : 'ac-muted'}>{attempt.critical ? tr('Есть критическое нарушение', 'Өрескел бұзушылық бар', 'Critical violation recorded') : tr('Без критического нарушения', 'Өрескел бұзушылық жоқ', 'No critical violation')}</p><a href={`#academy/result/${encodeURIComponent(attempt.id)}`}>{tr('Открыть результат', 'Нәтижені ашу', 'Open result')}</a></article>)}</div>
        <p className="ac-compare-date-note">{tr('Время: Asia/Qyzylorda. При совпадении времени порядок определяется ID попытки.', 'Уақыт: Asia/Qyzylorda. Уақыт бірдей болса, реттілік әрекет ID-і бойынша анықталады.', 'Time zone: Asia/Qyzylorda. Matching timestamps are ordered by attempt ID.')}</p>
        <p className="ac-compare-delta">{tr('Разница итогов (позже − раньше)', 'Қорытынды айырмасы (кейінірек − ертерек)', 'Final-score difference (later − earlier)')}: <strong data-ac-score-delta>{difference(later.score - earlier.score)}</strong></p>
        {(earlier.critical || later.critical) && <p className="ac-compare-critical">{tr('Положительная разница не отменяет критического нарушения. Его статус показан отдельно для каждой попытки.', 'Оң айырма өрескел бұзушылықты жоймайды. Оның күйі әр әрекет үшін бөлек көрсетілген.', 'A positive difference does not cancel a critical violation. Its status is shown separately for each attempt.')}</p>}
        <div className="ac-compare-criteria">{SKILLS.map(skill => <section className="ac-compare-row" key={skill} data-ac-compare-skill={skill}><h4>{localized(skillNames[skill])}</h4><div><span>{tr('Раньше', 'Ертерек', 'Earlier')}</span><strong>{earlier.skills[skill]}</strong></div><div><span>{tr('Позже', 'Кейінірек', 'Later')}</span><strong>{later.skills[skill]}</strong></div><div><span>{tr('Разница', 'Айырма', 'Difference')}</span><strong data-ac-skill-delta>{difference(later.skills[skill] - earlier.skills[skill])}</strong></div></section>)}</div>
        <CompareErrors mission={mission} earlier={earlier} later={later}/>
        <details className="ac-compare-goals"><summary>{tr('Учебные цели в обеих попытках', 'Екі әрекеттегі оқу мақсаттары', 'Learning objectives in both attempts')}</summary><div>{mission.objectives.map(goal => <section key={goal.id} className="ac-compare-goal" data-ac-compare-goal={goal.id}><h4>{localized(goal.label)}</h4><p>{tr('Раньше', 'Ертерек', 'Earlier')}: <strong>{earlier.completedGoals.includes(goal.id) ? tr('выполнена', 'орындалды', 'completed') : tr('не выполнена', 'орындалмады', 'not completed')}</strong></p><p>{tr('Позже', 'Кейінірек', 'Later')}: <strong>{later.completedGoals.includes(goal.id) ? tr('выполнена', 'орындалды', 'completed') : tr('не выполнена', 'орындалмады', 'not completed')}</strong></p></section>)}</div></details>
      </> : <p className="ac-compare-empty" data-ac-compare-empty>{tr('Для сравнения нужны две разные завершённые попытки этой миссии. Сейчас сохранена одна.', 'Салыстыру үшін осы миссияның аяқталған екі бөлек әрекеті қажет. Қазір біреуі сақталған.', 'Two different completed attempts at this mission are needed. One is currently saved.')}</p>}</> : <p className="ac-compare-empty" data-ac-compare-empty>{tr('После двух завершённых попыток одной миссии здесь появится сравнение. Пока истории нет.', 'Бір миссияны екі рет аяқтағаннан кейін мұнда салыстыру пайда болады. Әзірше тарих жоқ.', 'A comparison becomes available after two completed attempts at one mission. There is no history yet.')}</p>}
  </section>;
}

export type ReviewTarget = { turn: number; revision: number };

export function ReviewTranscript({ attempt, mission, target }: { attempt: Attempt; mission: Mission; target?: ReviewTarget }) {
  const history = useRef<HTMLDetailsElement>(null);
  const replies = useRef(new Map<number, HTMLDivElement>());
  const reviews = useRef(new Map<number, HTMLDetailsElement>());
  const lastTarget = useRef('');
  const [selected, setSelected] = useState<number>();
  const navigate = (turn: number, showReview = false) => {
    const reply = replies.current.get(turn);
    if (!reply || !history.current) return;
    history.current.open = true;
    if (showReview) { const review = reviews.current.get(turn); if (review) review.open = true; }
    setSelected(turn);
    reply.focus({ preventScroll: true });
    reply.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  };
  useEffect(() => {
    if (!target || !Number.isInteger(target.turn) || target.turn < 1 || target.turn > attempt.turns.length) return;
    const identity = `${attempt.id}:${target.turn}:${target.revision}`;
    if (lastTarget.current === identity) return;
    lastTarget.current = identity;
    navigate(target.turn, true);
    // Only an explicit new target is navigation. Ordinary reading and locale renders never scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt.id, target?.turn, target?.revision]);
  return <details className="ac-card ac-details ac-review-history" ref={history} data-ac-history>
    <summary>{tr('Полный разговор', 'Толық әңгіме', 'Full conversation')} · {tr('ходов:', 'қадам:', 'turns:')} {attempt.turns.length}</summary>
    <nav className="ac-review-timeline" aria-label={tr('Пройденные этапы разговора', 'Әңгіменің өткен кезеңдері', 'Recorded conversation stages')}><ol>{attempt.turns.map((turn, index) => <li key={`${attempt.id}:${index}:${turn.nodeId}`}><button type="button" data-ac-review-stage={index + 1} aria-current={selected === index + 1 ? 'step' : undefined} onClick={() => navigate(index + 1)}><span>{index + 1}</span>{localized(mission.nodes[turn.nodeId].title)}</button></li>)}</ol>{attempt.turns.length > 0 && <button type="button" className="ac-button ac-secondary" data-ac-review-latest onClick={() => navigate(attempt.turns.length)}>{tr('К последнему ответу', 'Соңғы жауапқа', 'Jump to the last reply')}</button>}</nav>
    <div className="ac-transcript ac-review-transcript"><div className="ac-message is-client"><span className="ac-message-author">{tr('Клиент', 'Клиент', 'Client')}</span><p>{localized(mission.nodes[mission.start].prompt)}</p></div>
      {attempt.turns.map((turn, index) => {
        const node = mission.nodes[turn.nodeId];
        const action = node?.actions.find(item => item.id === turn.actionId);
        const ideal = node?.actions.find(item => item.id === node.idealActionId);
        const next = mission.nodes[turn.nextNodeId];
        if (!node || !action || !next) return null;
        const turnNumber = index + 1;
        const errors = attempt.errors.filter(error => error.turn === turnNumber && error.nodeId === turn.nodeId && error.actionId === turn.actionId).flatMap(reference => { const error = action.errors.find(item => item.id === reference.errorId); return error ? [error] : []; });
        return <section className={`ac-review-turn ${selected === turnNumber ? 'is-selected' : ''}`} key={`${attempt.id}:${index}:${turn.nodeId}`} data-ac-review-turn={turnNumber} data-ac-node-id={turn.nodeId} id={`ac-review-${encodeURIComponent(attempt.id)}-${index}-${encodeURIComponent(turn.nodeId)}`}>
          <h3 className="ac-review-turn-heading">{turnLabel(turnNumber)} · {localized(node.title)}</h3>
          <div className="ac-message is-operator ac-review-reply" tabIndex={-1} aria-label={`${tr('Ответ оператора', 'Оператор жауабы', 'Operator reply')}, ${turnLabel(turnNumber)}`} ref={element => { if (element) replies.current.set(turnNumber, element); else replies.current.delete(turnNumber); }}><span className="ac-message-author">{tr('Вы', 'Сіз', 'You')}</span><p>{localized(action.text)}</p></div>
          {errors.length > 0 && <details className="ac-inline-review" data-ac-inline-review={turnNumber} ref={element => { if (element) reviews.current.set(turnNumber, element); else reviews.current.delete(turnNumber); }}><summary>{tr('Разбор ответа', 'Жауапты талдау', 'Review this reply')} · {errors.length}</summary><div>{action.critical && <strong className="ac-review-critical">{tr('Критическое нарушение', 'Өрескел бұзушылық', 'Critical violation')}</strong>}{errors.map(error => <section key={error.id} data-ac-review-error={error.id}><h4>{localized(skillNames[error.skill])}</h4><p>{localized(error.explanation)}</p></section>)}{ideal && <section className="ac-review-ideal"><h4>{tr('Как можно ответить', 'Қалай жауап беруге болады', 'A better reply')}</h4><blockquote>{localized(ideal.text)}</blockquote></section>}</div></details>}
          <div className="ac-message is-client"><span className="ac-message-author">{tr('Клиент', 'Клиент', 'Client')}</span><p>{localized(turn.tense && action.tenseReaction ? action.tenseReaction : action.reaction)}</p></div>
          {localized(next.prompt) && <div className="ac-message is-client"><span className="ac-message-author">{tr('Клиент', 'Клиент', 'Client')}</span><p>{localized(next.prompt)}</p></div>}
        </section>;
      })}
    </div>
  </details>;
}
