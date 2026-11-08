import { useId, useLayoutEffect, useRef, useState } from 'react';
import { getLocale } from '../i18n';
import { missions, skillNames } from './missions';
import { FeatureDialog, isMissionAvailable, localized, missionLink, tr } from './feature-ui';
import { getMicroDrill, type MicroDrill } from './microDrills';
import { currentWeeklyPlan, movePlannedMission, plannedCompletion, rememberWeeklyPlan, removePlannedMission, scheduleMission, shiftPlanDate, validPlanDate, weekDates, type PlannedMission, type WeeklyPlanData } from './weeklyPlan';
import type { AcademyState } from './types';

const practiceNote = () => tr('Самостоятельный учебный пример. Факты вымышлены и не являются регламентом Freedom Broker. Без XP, достижений и завершения основной миссии.', 'Дербес оқу мысалы. Деректер ойдан шығарылған және Freedom Broker регламенті емес. XP, жетістік берілмейді, негізгі миссия аяқталмайды.', 'Independent practice with fictional facts, not Freedom Broker policy. No XP, achievements or main mission completion.');

function DrillExercise({ drill }: { drill: MicroDrill }) {
  const [selected, setSelected] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const answer = drill.choices.find(choice => choice.id === selected);
  const ideal = drill.choices.find(choice => choice.correct)!;
  return <div className="ac-learning-drill" data-drill-id={drill.id}>
    <p className="ac-learning-note">{practiceNote()}</p>
    <span className="ac-learning-tag">{localized(skillNames[drill.skill])}</span>
    <h3 ref={heading} tabIndex={-1}>{tr('Ситуация и все доступные факты', 'Жағдай және барлық белгілі дерек', 'Situation and all available facts')}</h3>
    <p className="ac-learning-context">{localized(drill.context)}</p>
    <fieldset className="ac-learning-choices" disabled={selected !== null}>
      <legend>{tr('Как ответить клиенту?', 'Клиентке қалай жауап бересіз?', 'How would you respond?')}</legend>
      {drill.choices.map((choice, index) => <button key={choice.id} type="button" className={`ac-learning-choice${selected === choice.id ? ' is-selected' : ''}`} onClick={() => setSelected(choice.id)} aria-pressed={selected === choice.id}>
        <span className="ac-learning-choice-index" aria-hidden="true">{index + 1}</span><span>{localized(choice.text)}</span>
      </button>)}
    </fieldset>
    <div aria-live="polite" aria-atomic="true">{answer && <section className={`ac-learning-feedback ${answer.correct ? 'is-correct' : 'needs-work'}`}>
      <h4>{answer.correct ? tr('Обоснованный ответ', 'Негізделген жауап', 'Well-supported response') : tr('Есть что улучшить', 'Жақсартуға болады', 'Room to improve')}</h4>
      <p>{localized(answer.explanation)}</p>
      {!answer.correct && <><h4>{tr('Пример подходящего ответа', 'Дұрыс жауаптың мысалы', 'Example of a suitable response')}</h4><p>{localized(ideal.text)}</p></>}
    </section>}</div>
    {answer && <button type="button" className="ac-button ac-secondary" onClick={() => { setSelected(null); heading.current?.focus({ preventScroll: true }); }}>{tr('Попробовать снова', 'Қайта көру', 'Try again')}</button>}
  </div>;
}

export function MicroDrillButton({ missionId, errorId }: { missionId: string; errorId?: string }) {
  const [open, setOpen] = useState(false);
  const drill = getMicroDrill(missionId, errorId);
  if (!drill) return null;
  return <><button type="button" className="ac-button ac-secondary" data-ac-micro-drill={missionId} onClick={() => setOpen(true)}>{tr('Мини-практика', 'Шағын жаттығу', 'Micro-practice')}</button>
    {open && <FeatureDialog title={`${tr('Мини-практика', 'Шағын жаттығу', 'Micro-practice')}: ${localized(drill.title)}`} onClose={() => setOpen(false)}><DrillExercise key={drill.id} drill={drill} /></FeatureDialog>}</>;
}

export function DrillCollection({ state }: { state: AcademyState }) {
  const groups = new Map<string, { missionId: string; errorId: string; count: number; explanation: typeof skillNames.empathy; skill: MicroDrill['skill'] }>();
  for (const attempt of state.history) {
    const mission = missions.find(item => item.id === attempt.missionId);
    if (!mission) continue;
    for (const item of attempt.errors) {
      const error = mission.nodes[item.nodeId]?.actions.find(action => action.id === item.actionId)?.errors.find(value => value.id === item.errorId);
      const drill = getMicroDrill(mission.id, item.errorId);
      if (!error || !drill) continue;
      const existing = groups.get(drill.id);
      if (existing) existing.count += 1;
      else groups.set(drill.id, { missionId: mission.id, errorId: error.id, count: 1, explanation: error.explanation, skill: error.skill });
    }
  }
  return <section className="ac-learning-section" aria-labelledby="ac-drill-collection-title">
    <h2 id="ac-drill-collection-title">{tr('Короткая практика по ошибкам', 'Қателер бойынша қысқа жаттығу', 'Focused practice from your mistakes')}</h2>
    <p className="ac-learning-note">{tr('По сохранённым попыткам. Мини-практика разбирает один самостоятельный пример; переигрывание всей миссии доступно отдельно.', 'Сақталған әрекеттер бойынша. Шағын жаттығу бір дербес мысалды талдайды; толық миссияны қайта өту бөлек қолжетімді.', 'Based on saved attempts. Each micro-practice uses one independent example; replaying the full mission is a separate action.')}</p>
    {groups.size ? <div className="ac-learning-grid">{[...groups].map(([id, group]) => {
      const mission = missions.find(item => item.id === group.missionId)!;
      return <article className="ac-learning-card" key={id}>
        <span className="ac-learning-tag">{localized(skillNames[group.skill])}</span><h3>{localized(mission.title)}</h3><p>{localized(group.explanation)}</p>
        <p className="ac-learning-note">{tr('Ошибок этого навыка в сохранённых попытках', 'Сақталған әрекеттердегі осы дағды қателері', 'Errors for this skill in saved attempts')}: {group.count}</p>
        <div className="ac-learning-actions"><MicroDrillButton missionId={group.missionId} errorId={group.errorId} />{isMissionAvailable(state, mission) ? <a className="ac-button ac-ghost" href={missionLink(group.missionId, 'mistakes')}>{tr('Повторить всю миссию', 'Толық миссияны қайталау', 'Replay full mission')}</a> : <span className="ac-learning-note">{tr('Полная миссия пока закрыта', 'Толық миссия әзірге жабық', 'Full mission is currently locked')}</span>}</div>
      </article>;
    })}</div> : <div className="ac-learning-card"><h3>{tr('В сохранённых попытках пока нет ошибок', 'Сақталған әрекеттерде әзірге қате жоқ', 'No mistakes in your saved attempts yet')}</h3><p>{tr('Можно познакомиться с форматом на отдельном примере входа в платформу.', 'Платформаға кіру туралы дербес мысал арқылы форматпен танысуға болады.', 'Explore the format with an independent platform sign-in example.')}</p><MicroDrillButton missionId="login" /></div>}
  </section>;
}

export function GuidedStartButton() {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="ac-button ac-ghost" data-ac-guided-start onClick={() => setOpen(true)}>{tr('Как проходит тренировка', 'Жаттығу қалай өтеді', 'How training works')}</button>{open && <FeatureDialog title={tr('Знакомство с тренировкой', 'Жаттығумен танысу', 'Training walkthrough')} onClose={() => setOpen(false)}><GuidedTour onClose={() => setOpen(false)} /></FeatureDialog>}</>;
}

function GuidedTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [choice, setChoice] = useState<'specific' | 'vague' | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const changeStep = (next: number) => { moved.current = true; setStep(next); };
  useLayoutEffect(() => { if (moved.current) heading.current?.focus({ preventScroll: true }); }, [step]);
  const titles = [tr('Выберите ответ', 'Жауапты таңдаңыз', 'Choose a response'), tr('Посмотрите реакцию', 'Реакцияны көріңіз', 'Observe the reaction'), tr('Прочитайте разбор', 'Талдауды оқыңыз', 'Read the review')];
  const positive = choice === 'specific';
  return <div className="ac-learning-tour" data-tour-step={step + 1}>
    <p className="ac-learning-note">{tr('Демонстрация из трёх шагов. Она не запускает миссию и не меняет прогресс.', 'Үш қадамдық көрсетілім. Миссияны бастамайды және ілгерілеуді өзгертпейді.', 'A three-step demo. It does not start a mission or change your progress.')}</p>
    <ol className="ac-learning-steps">{titles.map((title, index) => <li key={index} aria-current={step === index ? 'step' : undefined}><span aria-hidden="true">{index + 1}</span>{title}</li>)}</ol>
    <h3 ref={heading} tabIndex={-1}>{titles[step]}</h3>
    {step === 0 && <><p className="ac-learning-context">{tr('Учебный клиент: «Не могу войти в торговую платформу. Что делать?» Причина неизвестна. Можно уточнить сообщение об ошибке, но нельзя просить пароль или код.', 'Оқу мысалындағы клиент: «Сауда платформасына кіре алмаймын. Не істеймін?» Себебі белгісіз. Қате хабарламасын нақтылауға болады, бірақ құпиясөз бен кодты сұрауға болмайды.', 'Demo client: “I cannot sign in to the trading platform. What should I do?” The cause is unknown. You can clarify the error message, but must not request a password or code.')}</p>
      <fieldset className="ac-learning-choices"><legend>{tr('Выберите один учебный ответ', 'Бір оқу жауабын таңдаңыз', 'Choose one demo response')}</legend>
        <button type="button" className={`ac-learning-choice${positive ? ' is-selected' : ''}`} aria-pressed={positive} onClick={() => setChoice('specific')}>{tr('Понимаю неудобство. Какое сообщение об ошибке вы видите? Пароль и коды не присылайте.', 'Қолайсыздықты түсінемін. Қандай қате хабарламасын көріп тұрсыз? Құпиясөз бен кодтарды жібермеңіз.', 'I understand the inconvenience. What error message do you see? Please do not send passwords or codes.')}</button>
        <button type="button" className={`ac-learning-choice${choice === 'vague' ? ' is-selected' : ''}`} aria-pressed={choice === 'vague'} onClick={() => setChoice('vague')}>{tr('Подождите, всё само наладится.', 'Күтіңіз, бәрі өзінен-өзі түзеледі.', 'Wait; everything will fix itself.')}</button>
      </fieldset></>}
    {step === 1 && <div className="ac-learning-feedback"><span className="ac-learning-tag">{tr('Подготовленная реакция', 'Дайындалған реакция', 'Prepared reaction')}</span><blockquote>{positive ? tr('«Спасибо. Вижу сообщение об ошибке входа. Коды отправлять не буду».', '«Рақмет. Кіру қатесі туралы хабарлама тұр. Кодтарды жібермеймін».', '“Thank you. I see a sign-in error. I will not send any codes.”') : tr('«Сколько ждать? Вы даже не уточнили, что происходит».', '«Қанша күтемін? Не болғанын да нақтыламадыңыз».', '“How long should I wait? You have not even asked what is happening.”')}</blockquote><div className="ac-learning-emotion" aria-label={tr('Учебное изменение эмоций', 'Эмоция өзгерісінің оқу мысалы', 'Demo emotional change')}><p>{positive ? tr('Напряжённость: тревога → спокойнее', 'Шиеленіс: алаңдау → сабырлырақ', 'Tension: anxious → calmer') : tr('Напряжённость: тревога → раздражение', 'Шиеленіс: алаңдау → ашулану', 'Tension: anxious → frustrated')}</p><p>{positive ? tr('Доверие: неопределённость → растёт', 'Сенім: белгісіздік → артады', 'Trust: uncertain → growing') : tr('Доверие: неопределённость → снижается', 'Сенім: белгісіздік → төмендейді', 'Trust: uncertain → declining')}</p></div><p>{positive ? tr('Конкретный безопасный вопрос помогает продолжить разговор и снижает неопределённость.', 'Нақты әрі қауіпсіз сұрақ әңгімені жалғастыруға және белгісіздікті азайтуға көмектеседі.', 'A specific, safe question helps the conversation continue and reduces uncertainty.') : tr('Необоснованное обещание не даёт следующего шага. Клиенту по-прежнему непонятно, что делать.', 'Негізсіз уәде келесі қадамды көрсетпейді. Клиент не істеу керегін әлі түсінбейді.', 'An unsupported promise gives no next step. The client still does not know what to do.')}</p></div>}
    {step === 2 && <div className="ac-learning-feedback"><h4>{positive ? tr('Что сработало в примере', 'Мысалда не сәтті болды', 'What worked in this example') : tr('Как улучшить этот пример', 'Бұл мысалды қалай жақсартуға болады', 'How to improve this example')}</h4><ul><li>{tr('Признать неудобство клиента.', 'Клиенттің қолайсыздығын мойындау.', 'Acknowledge the client’s inconvenience.')}</li><li>{tr('Уточнить наблюдаемый факт вместо догадки.', 'Болжамның орнына байқалған деректі нақтылау.', 'Clarify an observable fact rather than guess.')}</li><li>{tr('Предложить безопасный следующий шаг.', 'Қауіпсіз келесі қадамды ұсыну.', 'Offer a safe next step.')}</li></ul><p>{tr('В полной миссии после разговора появится оценка с объяснением критериев. В этом знакомстве баллы не начисляются.', 'Толық миссияда әңгімеден кейін критерийлері түсіндірілген баға көрсетіледі. Бұл танысуда ұпай берілмейді.', 'A full mission ends with a score and criterion explanations. This walkthrough awards no points.')}</p></div>}
    <div className="ac-learning-tour-nav"><button type="button" className="ac-button ac-ghost" data-ac-tour-skip onClick={onClose}>{tr('Пропустить и закрыть', 'Өткізіп, жабу', 'Skip and close')}</button><div className="ac-learning-actions">
      {step > 0 && <button type="button" className="ac-button ac-secondary" data-ac-tour-back onClick={() => changeStep(step - 1)}>{tr('Назад', 'Артқа', 'Back')}</button>}
      {step < 2 ? <button type="button" className="ac-button ac-primary" data-ac-tour-next disabled={!choice} onClick={() => changeStep(step + 1)}>{tr('Далее', 'Келесі', 'Next')}</button> : <><button type="button" className="ac-button ac-secondary" data-ac-tour-repeat onClick={() => { setChoice(null); changeStep(0); }}>{tr('Повторить', 'Қайталау', 'Repeat')}</button><button type="button" className="ac-button ac-primary" data-ac-tour-done onClick={onClose}>{tr('Готово', 'Дайын', 'Done')}</button></>}
    </div></div>
  </div>;
}

function displayDate(date: string, weekday = false): string {
  return new Intl.DateTimeFormat(getLocale() === 'kk' ? 'kk-KZ' : getLocale() === 'ru' ? 'ru-RU' : 'en-GB', { timeZone: 'Asia/Qyzylorda', day: 'numeric', month: 'short', year: 'numeric', ...(weekday ? { weekday: 'short' as const } : {}) }).format(new Date(`${date}T12:00:00Z`));
}

function PlannedRow({ entry, state, available, onMove, onRemove }: { entry: PlannedMission; state: AcademyState; available: boolean; onMove: (date: string) => void; onRemove: () => void }) {
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState(entry.date);
  const dateId = useId();
  const mission = missions.find(item => item.id === entry.missionId)!;
  const completion = plannedCompletion(entry, state.history);
  return <article className={`ac-learning-plan-item is-${completion.status}`}>
    <h4>{localized(mission.title)}</h4>
    <p className="ac-learning-plan-status">{completion.status === 'passed' ? tr('Пройдена успешно', 'Сәтті өтті', 'Passed') : completion.status === 'completed' ? tr('Попытка завершена · нужна доработка', 'Әрекет аяқталды · жақсарту қажет', 'Attempt finished · needs improvement') : tr('Запланирована', 'Жоспарланған', 'Planned')}</p>
    {completion.count > 0 && <p className="ac-learning-note">{tr('Сохранённых попыток в этот день', 'Осы күнгі сақталған әрекеттер', 'Saved attempts on this day')}: {completion.count}</p>}
    {!available && <p className="ac-learning-note">{tr('Миссия пока закрыта. Запись остаётся в плане.', 'Миссия әзірге жабық. Жазба жоспарда қалады.', 'Mission is currently locked. It stays in your plan.')}</p>}
    <div className="ac-learning-actions">{available ? <a className="ac-button ac-secondary" href={missionLink(entry.missionId)}>{tr('Открыть миссию', 'Миссияны ашу', 'Open mission')}</a> : <button type="button" className="ac-button ac-secondary" disabled>{tr('Закрыта', 'Жабық', 'Locked')}</button>}
      <button type="button" className="ac-button ac-ghost" disabled={!available} aria-expanded={moving} onClick={() => setMoving(value => !value)}>{tr('Перенести', 'Ауыстыру', 'Move')}</button>
      <button type="button" className="ac-button ac-ghost" onClick={onRemove} aria-label={`${tr('Убрать из плана', 'Жоспардан алып тастау', 'Remove from plan')}: ${localized(mission.title)}, ${displayDate(entry.date)}`}>{tr('Убрать', 'Алып тастау', 'Remove')}</button>
    </div>
    {moving && <form className="ac-learning-move" onSubmit={event => { event.preventDefault(); if (available && validPlanDate(target) && target !== entry.date) { onMove(target); setMoving(false); } }}><label htmlFor={dateId}>{tr('Новая дата', 'Жаңа күн', 'New date')}</label><input id={dateId} type="date" required value={target} onChange={event => setTarget(event.target.value)} /><button type="submit" className="ac-button ac-secondary" disabled={!validPlanDate(target) || target === entry.date}>{tr('Сохранить дату', 'Күнді сақтау', 'Save date')}</button></form>}
  </article>;
}

export function WeeklyPlan({ state }: { state: AcademyState }) {
  const [stored, setStored] = useState(currentWeeklyPlan);
  const [week, setWeek] = useState(() => weekDates()[0]);
  const dates = weekDates(week);
  const availableMissions = missions.filter(mission => isMissionAvailable(state, mission));
  const available = new Set(availableMissions.map(mission => mission.id));
  const [selectedMission, setSelectedMission] = useState(availableMissions[0]?.id ?? '');
  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [message, setMessage] = useState('');
  const headingId = useId();
  const missionId = useId();
  const dateId = useId();
  const activeMission = available.has(selectedMission) ? selectedMission : availableMissions[0]?.id ?? '';
  const activeDate = dates.includes(selectedDate) ? selectedDate : dates[0];
  function commit(plan: WeeklyPlanData, notice: string) { setStored(rememberWeeklyPlan(plan)); setMessage(notice); }
  function navigateWeek(next: string) { setWeek(next); setSelectedDate(next); setMessage(''); }
  return <section className="ac-learning-section ac-learning-week" aria-labelledby={headingId}>
    <div className="ac-learning-section-head"><div><h2 id={headingId}>{tr('Личный план на неделю', 'Апталық жеке жоспар', 'Your weekly plan')}</h2><p className="ac-learning-note">{tr('Семь календарных дней · часовой пояс Asia/Qyzylorda. План хранится отдельно на этом устройстве.', 'Жеті күнтізбелік күн · Asia/Qyzylorda уақыт белдеуі. Жоспар осы құрылғыда бөлек сақталады.', 'Seven calendar days · Asia/Qyzylorda time zone. The plan is saved separately on this device.')}</p></div></div>
    <div className="ac-learning-week-nav"><button type="button" className="ac-button ac-secondary" onClick={() => navigateWeek(shiftPlanDate(week, -7))} aria-label={tr('Предыдущая неделя', 'Алдыңғы апта', 'Previous week')}>←</button><h3 aria-live="polite">{displayDate(dates[0])} — {displayDate(dates[6])}</h3><button type="button" className="ac-button ac-secondary" onClick={() => navigateWeek(shiftPlanDate(week, 7))} aria-label={tr('Следующая неделя', 'Келесі апта', 'Next week')}>→</button><button type="button" className="ac-button ac-ghost" onClick={() => navigateWeek(weekDates()[0])}>{tr('Текущая неделя', 'Осы апта', 'This week')}</button></div>
    {stored.warning && <div role="status" className="ac-learning-warning"><p>{stored.warning === 'unavailable' ? tr('Сохранение недоступно. Изменения плана пока только в памяти этой вкладки. Повторите сохранение перед обновлением страницы.', 'Сақтау қолжетімсіз. Жоспар өзгерістері әзірге осы қойындының жадында ғана. Бетті жаңартпас бұрын қайта сақтап көріңіз.', 'Saving is unavailable. Plan changes are currently held only in this tab’s memory. Retry saving before reloading.') : stored.warning === 'incompatible' ? tr('Сохранённая версия плана не поддерживается. Показан пустой план; новые изменения заменят только сохранённый план.', 'Сақталған жоспар нұсқасына қолдау жоқ. Бос жоспар көрсетілді; жаңа өзгерістер тек сақталған жоспарды ауыстырады.', 'The saved plan version is unsupported. An empty plan is shown; new changes will replace only the saved plan.') : tr('Сохранённый план повреждён. Показан пустой план; история тренировок не затронута.', 'Сақталған жоспар зақымдалған. Бос жоспар көрсетілді; жаттығу тарихы өзгерген жоқ.', 'The saved plan is invalid. An empty plan is shown; training history is unchanged.')}</p>{stored.warning === 'unavailable' && <button type="button" className="ac-button ac-secondary" onClick={() => setStored(rememberWeeklyPlan(stored.plan))}>{tr('Повторить сохранение', 'Қайта сақтау', 'Retry saving')}</button>}</div>}
    <form className="ac-learning-schedule" onSubmit={event => { event.preventDefault(); const next = scheduleMission(stored.plan, activeDate, activeMission, available); if (next === stored.plan) { setMessage(tr('Не добавлено: запись уже есть или выбранная миссия недоступна.', 'Қосылмады: жазба бар немесе таңдалған миссия қолжетімсіз.', 'Not added: this entry already exists or the selected mission is unavailable.')); return; } commit(next, tr('Миссия добавлена в план.', 'Миссия жоспарға қосылды.', 'Mission added to your plan.')); }}>
      <div><label htmlFor={missionId}>{tr('Доступная миссия', 'Қолжетімді миссия', 'Available mission')}</label><select id={missionId} value={activeMission} disabled={!availableMissions.length} onChange={event => setSelectedMission(event.target.value)}>{availableMissions.map(mission => <option value={mission.id} key={mission.id}>{localized(mission.title)}</option>)}</select></div>
      <div><label htmlFor={dateId}>{tr('День недели', 'Апта күні', 'Day of the week')}</label><select id={dateId} value={activeDate} onChange={event => setSelectedDate(event.target.value)}>{dates.map(date => <option key={date} value={date}>{displayDate(date, true)}</option>)}</select></div><button type="submit" className="ac-button ac-primary" disabled={!availableMissions.length}>{tr('Добавить в план', 'Жоспарға қосу', 'Add to plan')}</button>
    </form>
    <p className="ac-learning-note" role="status">{message}</p>
    <div className="ac-learning-week-grid">{dates.map(date => <section className="ac-learning-day" key={date} aria-label={displayDate(date, true)}><h3><time dateTime={date}>{displayDate(date, true)}</time></h3>
      {stored.plan.entries.filter(entry => entry.date === date).map(entry => <PlannedRow key={`${entry.date}:${entry.missionId}`} entry={entry} state={state} available={available.has(entry.missionId)} onRemove={() => commit(removePlannedMission(stored.plan, date, entry.missionId), tr('Запись убрана из плана.', 'Жазба жоспардан алынды.', 'Entry removed from the plan.'))} onMove={to => { const duplicate = stored.plan.entries.some(item => item.date === to && item.missionId === entry.missionId); const next = movePlannedMission(stored.plan, date, to, entry.missionId, available); if (next !== stored.plan) commit(next, `${duplicate ? tr('Записи объединены на дату', 'Жазбалар осы күнге біріктірілді', 'Entries merged on') : tr('Миссия перенесена на', 'Миссия ауыстырылды', 'Mission moved to')} ${displayDate(to)}.`); }} />)}
      {!stored.plan.entries.some(entry => entry.date === date) && <p className="ac-learning-note">{tr('Пока нет миссий', 'Әзірге миссия жоқ', 'No missions planned')}</p>}
    </section>)}</div>
    <p className="ac-learning-note">{tr('Статус появляется только по сохранённой попытке этой миссии в назначенный день. Завершённая попытка с ошибками отмечается отдельно от успешного прохождения. Перенос и удаление плана не меняют XP и историю. За пропуски нет штрафов.', 'Мәртебе тек осы миссияның белгіленген күндегі сақталған әрекеті бойынша көрсетіледі. Қатемен аяқталған әрекет сәтті өтуден бөлек белгіленеді. Жоспарды ауыстыру мен жою XP және тарихты өзгертпейді. Өткізіп алғаны үшін айып жоқ.', 'Status comes only from a saved attempt for this mission on its scheduled day. Finished attempts with errors are distinguished from passing. Moving or removing a plan entry changes neither XP nor history. There are no missed-day penalties.')}</p>
  </section>;
}
