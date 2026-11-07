import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Appeal, Checklist, Criterion, CriterionResult, DialogRecord, Evaluation, Section } from './types';
import { Icon, TurnText, label, number, transcriptReference } from './shared';
import { translate as t } from './i18n';
import { clearLinkedEvidence } from './review-tools';
import { animateElement } from './motion';
import { criterionReason, firstTurn, plainTurnRefs, scoreTone } from './text';

export interface EvaluationViewProps {
  evaluation?: Evaluation | null;
  checklist?: Checklist | null;
  appeals?: Appeal[];
  dialog?: DialogRecord | null;
  demo?: boolean;
}

type CriterionTone = 'na' | 'review' | 'critical' | 'success' | 'attention' | 'neutral';
type AnswerTone = 'na' | 'critical' | 'success' | 'fail' | 'partial' | 'neutral';
type CriterionEntry = { item: CriterionResult; definition?: Criterion; index: number };
type ResultGroup = { id: string; name?: string; entries: CriterionEntry[] };
type ResultContext = { evaluation: Evaluation; appeals: Appeal[]; dialog?: DialogRecord | null; transcriptLength: number };

const answerLabel = (answer: unknown) => answer === 'yes' || answer === 'no' || answer === 'na' ? label(answer) : number(answer);
const isGross = (item: CriterionResult, criterion?: Criterion) => Boolean(criterion?.gross_error || item.gross_error);
const criterionAnswer = (item: CriterionResult, criterion?: Criterion) => isGross(item, criterion)
  ? item.answer === 'yes' ? t('Нарушение выявлено') : item.answer === 'no' ? t('Не выявлено') : answerLabel(item.answer)
  : item.answer === 'na' ? t('Не применяется') : answerLabel(item.answer);
/** Answer as a short label: a scale answer is shown against its maximum («7 из 10»). */
function answerText(item: CriterionResult, criterion?: Criterion) {
  const max = criterion?.scale?.max;
  if (!isGross(item, criterion) && criterion?.answer_type === 'scale' && typeof item.answer === 'number' && typeof max === 'number') return t('{value} из {max}', { value: number(item.answer), max: number(max) });
  return criterionAnswer(item, criterion);
}
const criterionTitle = (item: CriterionResult, criterion?: Criterion) => criterion?.title || item.title || item.criterion_id;
const maxPointsOf = (item: CriterionResult, criterion?: Criterion) => item.effective_weight ?? item.weight ?? criterion?.weight;
const pointsOf = (item: CriterionResult) => item.points ?? item.score;
const findOpenAppeal = (context: ResultContext, criterionId: string) => context.appeals.find(appeal => appeal.evaluation_id === context.evaluation.id && appeal.criterion_id === criterionId && appeal.status === 'open');

// Presentation only: answers, weights and totals always come from the existing result.
function criterionTone(item: CriterionResult, criterion?: Criterion): CriterionTone {
  if (item.answer === 'na') return 'na';
  if (criterion?.gross_error && item.answer === 'yes') return 'critical';
  if (item.needs_review) return 'review';
  if (!criterion) return 'neutral';
  if (criterion?.gross_error) return item.answer === 'yes' ? 'critical' : item.answer === 'no' ? 'success' : 'review';
  if (item.answer === 'yes' || typeof item.answer === 'number' && item.answer === criterion?.scale?.max) return 'success';
  return 'attention';
}
/** Colour of the answer label: done, not done, partially done (scale), not applicable, violation. */
function answerTone(item: CriterionResult, criterion?: Criterion): AnswerTone {
  if (item.answer === 'na') return 'na';
  if (isGross(item, criterion) && criterion) return item.answer === 'yes' ? 'critical' : item.answer === 'no' ? 'success' : 'neutral';
  if (!criterion) return 'neutral';
  if (criterion.answer_type === 'scale' && typeof item.answer === 'number' && criterion.scale) {
    if (item.answer >= criterion.scale.max) return 'success';
    return item.answer <= (criterion.scale.min ?? 0) ? 'fail' : 'partial';
  }
  return item.answer === 'yes' ? 'success' : item.answer === 'no' ? 'fail' : 'neutral';
}

function ResultNavigator({ groups, active, onNavigate }: { groups: ResultGroup[]; active: string | null; onNavigate: (id: string) => void }) {
  const visibleGroups = groups.filter(group => group.entries.length);
  if (!visibleGroups.length) return null;
  return <nav className="result-navigator" id="criteria-map" tabIndex={-1} aria-label={t('Карта критериев')}>
    <div className="result-navigator-heading"><span className="result-nav-symbol"><Icon name="list" /></span><div><h3>{t('Карта критериев')}</h3><p>{t('Выберите критерий, чтобы перейти к обоснованию.')}</p></div></div>
    <div className="result-nav-groups">{visibleGroups.map(group => <div className="result-nav-group" key={group.id}>
      <div className="result-nav-section">{group.name}</div>
      <div className="result-nav-items">{group.entries.map(({ item, definition, index }) => {
        const tone = criterionTone(item, definition);
        return <button type="button" className={`result-nav-item result-nav-${tone}`} key={`${item.criterion_id}-${index}`} aria-controls={`criterion-${item.criterion_id}`} aria-current={active === item.criterion_id ? 'location' : undefined} onClick={() => onNavigate(item.criterion_id)}>
          <span className="result-nav-number">{String(index + 1).padStart(2, '0')}</span>
          <span className="result-nav-name">{definition?.title || item.criterion_id}{item.needs_review && <span className="result-nav-review">{t('Нужна проверка')}</span>}</span>
          <span className="result-nav-answer">{criterionAnswer(item, definition)}</span>
          <Icon name="chevron" />
        </button>;
      })}</div>
    </div>)}</div>
  </nav>;
}

function CriterionScale({ item, criterion }: { item: CriterionResult; criterion?: Criterion }) {
  const scale = criterion?.scale;
  if (criterion?.answer_type !== 'scale' || item.answer === 'na' || !scale || !Array.isArray(scale.steps)) return null;
  const current = scale.steps.find(step => step.value === item.answer);
  return <div className="result-scale">
    <div className="result-scale-caption"><span>{t('Оценка по шкале')}</span><strong>{number(item.answer)} <span>/ {number(scale.max)}</span></strong></div>
    <ol className="result-scale-steps" aria-label={t('Ступени шкалы')}>
      {scale.steps.map((step, index) => <li key={`${step.value}-${index}`} className={step.value === item.answer ? 'is-current' : ''}>
        <span>{number(step.value)}</span>
        {step.value === item.answer && <span className="sr-only">{t('Текущая оценка')}</span>}
      </li>)}
    </ol>
    {current?.label && <p className="result-scale-description">{current.label}</p>}
  </div>;
}

function CriterionEvidence({ item, transcriptLength }: { item: CriterionResult; transcriptLength: number }) {
  const evidence = Array.isArray(item.evidence) ? item.evidence : [];
  const validTurn = (turn: unknown): turn is number => typeof turn === 'number' && Number.isInteger(turn) && turn >= 0 && turn < transcriptLength;
  const quote = (entry: (typeof evidence)[number], index: number) => {
    const turn = entry.turn;
    const valid = validTurn(turn);
    return <div key={index} className={`result-evidence ${index === 0 ? 'result-evidence-primary' : ''}`}>
      <div className="result-evidence-heading"><Icon name="dialogs" /><span>{valid ? t('Реплика {n}', { n: turn + 1 }) : t('Цитата из диалога')}</span></div>
      <blockquote>«{entry.quote}»</blockquote>
      {valid ? <button className="evidence-link" data-turn={turn}>{t('Перейти к реплике')} <Icon name="arrow-right" /></button> : <span className="result-missing-reference">{t('Корректный номер реплики не указан')}</span>}
    </div>;
  };
  const range = item.checked_range;
  const validRange = range && validTurn(range.from) && validTurn(range.to) && range.to >= range.from;
  return <>
    {evidence.length > 0 && quote(evidence[0], 0)}
    {evidence.length > 1 && <details className="result-more-evidence">
      <summary>{t('Другие доказательства')} · {evidence.length - 1}</summary>
      {evidence.slice(1).map((entry, index) => quote(entry, index + 1))}
    </details>}
    {validRange ? <div className="result-range">
      <span className="result-block-label">{t('Проверенный участок разговора')}</span>
      <div><strong>{t('Реплики {from}–{to}', { from: range.from + 1, to: range.to + 1 })}</strong><button className="evidence-link" data-turn={range.from} data-range-end={range.to}>{t('К участку')} <Icon name="arrow-right" /></button></div>
    </div> : range ? <div className="notice result-range-warning">{t('Некорректный диапазон доказательства')}</div> : null}
  </>;
}

function CriterionRevision({ item, appeal }: { item: CriterionResult; appeal?: Appeal }) {
  if (!appeal?.decision) return null;
  return <div className="result-revision">
    <div className="result-block-label">{t('Решение проверяющего')}</div>
    <div className="result-answer-comparison">
      <div><span>{t('Исходный ответ')}</span><strong>{item.original_answer !== undefined ? answerLabel(item.original_answer) : t('Не указан')}</strong></div>
      <span className="comparison-arrow"><Icon name="arrow-right" /></span>
      <div><span>{t('После пересмотра')}</span><strong>{answerLabel(item.answer)}</strong></div>
    </div>
    <p>{appeal.decision.reason}</p>
  </div>;
}

function AppealButton({ criterionId, context, compact = false }: { criterionId: string; context: ResultContext; compact?: boolean }) {
  const openAppeal = findOpenAppeal(context, criterionId);
  return <button type="button" className={`btn btn-small ${compact ? '' : 'btn-ghost'}`} data-appeal={criterionId} disabled={Boolean(openAppeal)}><Icon name="appeal" />{openAppeal ? t('Апелляция подана') : t('Оспорить')}</button>;
}

function ResultCriterion({ item, criterion, index, context, open, onToggle }: { item: CriterionResult; criterion?: Criterion; index: number; context: ResultContext; open: boolean; onToggle: () => void }) {
  const { evaluation, appeals, transcriptLength } = context;
  const decision = appeals.findLast(appeal => appeal.evaluation_id === evaluation.id && appeal.criterion_id === item.criterion_id && appeal.decision);
  const details = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    if (open && !wasOpen.current && details.current) animateElement(details.current, [{ opacity: .5, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180 });
    wasOpen.current = open;
  }, [open]);
  const tone = criterionTone(item, criterion);
  const gross = isGross(item, criterion);
  const tag = answerTone(item, criterion);
  const baseWeight = item.weight ?? criterion?.weight;
  const maxPoints = maxPointsOf(item, criterion);
  const points = pointsOf(item);
  const applicable = item.answer !== 'na' && item.applicable !== false;
  const hasAdjustedWeight = Number.isFinite(item.effective_weight) && Number.isFinite(baseWeight) && item.effective_weight !== baseWeight;
  const reference = transcriptReference(transcriptLength);
  const detailsId = `criterion-${item.criterion_id}-details`;
  const title = criterionTitle(item, criterion);
  return <article className={`criterion result-criterion result-criterion-${tone} ${open ? 'is-open' : ''}`} id={`criterion-${item.criterion_id}`} tabIndex={-1}>
    <h4 className="result-row-heading">
      <button type="button" className="result-row" aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>
        <span className="result-criterion-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="result-row-main">
          <span className="result-row-title">{title}</span>
          <span className="result-row-reason">{plainTurnRefs(criterionReason(item, title))}</span>
          {item.needs_review && <span className="result-row-review">{t('Нужна проверка')}</span>}
        </span>
        <span className={`result-answer result-answer-${tag}`}>{tag === 'success' ? <Icon name="check" /> : tag === 'critical' ? <Icon name="alert" /> : null}{answerText(item, criterion)}</span>
        {gross ? <span className="result-row-points is-muted">{t('без баллов')}</span>
          : applicable ? <span className="result-row-points result-points"><strong>{number(points)}</strong> <span>/ {number(maxPoints)}</span></span>
            : <span className="result-row-points is-muted" aria-label={t('Баллы не начисляются')}>—</span>}
        <span className="result-row-chevron"><Icon name="chevron" /></span>
      </button>
    </h4>
    <div className="result-criterion-details" id={detailsId} hidden={!open} ref={details}>
      <div className="linked-evidence-label"><Icon name="arrow-left"/>{t('Связанная реплика выделена')}</div>
      {item.needs_review && <div className="result-review-note">{t('Нужна проверка человеком. Ответ требует подтверждения.')}</div>}
      {gross && <p className="result-gross-caption">{t('Отмечается отдельно от итогового балла.')}</p>}
      {item.answer === 'na' && <div className="result-na">
        <span className="result-block-label">{t('Почему критерий не применяется')}</span>
        <p>{item.na_reason ? <TurnText text={item.na_reason} reference={reference}/> : t('Причина не указана в результате.')}</p>
        <span>{gross ? t('Неприменимость указана для отдельной отметки.') : t('Критерий исключён из итогового расчёта.')}</span>
      </div>}
      <div className="result-reason"><span className="result-block-label">{t('Обоснование')}</span><p>{item.explanation ? <TurnText text={item.explanation} reference={reference}/> : t('Обоснование не получено.')}</p></div>
      <CriterionEvidence item={item} transcriptLength={transcriptLength} />
      {!gross && item.answer !== 'na' && <details className="result-calculation">
        <summary><Icon name="chart" /><span>{t('Как рассчитано')}</span><Icon name="chevron" /></summary>
        <CriterionScale item={item} criterion={criterion} />
        <dl className="criterion-metrics">
          <div><dt>{t('Базовый вес')}</dt><dd>{number(baseWeight)}</dd></div>
          <div><dt>{hasAdjustedWeight ? t('Вес после N/A') : t('Максимум баллов')}</dt><dd>{number(maxPoints)}</dd></div>
          <div className="criterion-contribution"><dt>{t('Баллы в итог')}</dt><dd>{number(points)}<span> / {number(maxPoints)}</span></dd></div>
        </dl>
        {hasAdjustedWeight && <p className="result-weight-note">{t('Вес перераспределён с учётом неприменимых критериев.')}</p>}
      </details>}
      <CriterionRevision item={item} appeal={decision} />
      <div className="result-criterion-footer">
        <span>{gross ? t('Не входит в балльную оценку') : item.answer === 'na' ? t('N/A — не является ошибкой') : t('Оценка по выбранному чек-листу')}</span>
        <AppealButton criterionId={item.criterion_id} context={context} />
      </div>
      {criterion && <details className="result-rule">
        <summary>{t('Правило и условия критерия')}</summary>
        <p>{criterion.description}</p>
        <p>{gross ? t('Отдельный флаг без баллов.') : t('Базовый вес: {weight}.', { weight: number(criterion.weight) })} {criterion.na_allowed ? `N/A: ${criterion.na_rule ?? ''}` : t('N/A не допускается.')}</p>
        {criterion.notes && <p>{criterion.notes}</p>}
      </details>}
    </div>
  </article>;
}

function ScoreRing({ total }: { total: number | null | undefined }) {
  const tone = scoreTone(total);
  const radius = 52;
  const length = 2 * Math.PI * radius;
  const share = typeof total === 'number' ? Math.max(0, Math.min(100, total)) / 100 : 0;
  return <svg className={`result-ring result-ring-${tone ?? 'none'}`} viewBox="0 0 120 120" width="120" height="120" role="img"
    aria-label={typeof total === 'number' ? t('Итоговый балл: {score} из 100', { score: number(total) }) : t('Итоговый балл не рассчитан')}>
    <circle className="result-ring-track" cx="60" cy="60" r={radius} />
    {share > 0 && <circle className="result-ring-value" cx="60" cy="60" r={radius} strokeDasharray={`${length * share} ${length}`} transform="rotate(-90 60 60)" />}
    <text className="result-ring-number" x="60" y="63" textAnchor="middle">{number(total)}</text>
    <text className="result-ring-caption" x="60" y="84" textAnchor="middle">{t('из 100')}</text>
  </svg>;
}

const sectionMax = (section: Section) => typeof section.max === 'number' ? section.max : typeof section.effective_weight === 'number' ? section.effective_weight : null;
function ResultOverview({ evaluation, sections, names, criteriaCount }: { evaluation: Evaluation; sections: Section[]; names: Section[]; criteriaCount: number }) {
  return <div className="result-overview" data-reveal="">
    <div className="result-overview-score">
      <span className="result-block-label">{t('Итоговый балл')}</span>
      <ScoreRing total={evaluation.total} />
    </div>
    <div className="result-overview-body">
      {sections.length > 0 && <>
        <span className="result-block-label">{t('Результаты секций')}</span>
        <ul className="section-bars">{sections.map((section, index) => {
          const max = sectionMax(section) as number;
          const score = typeof section.score === 'number' ? section.score : 0;
          const share = Math.max(0, Math.min(1, score / max));
          return <li className="section-bar" key={`${section.id}-${index}`}>
            <span className="section-bar-name">{section.name || names.find(item => item.id === section.id)?.name || section.id}</span>
            <span className="section-bar-track" aria-hidden="true"><span className={`section-bar-fill section-bar-${scoreTone(share * 100)}`} style={{ width: `${Math.round(share * 1000) / 10}%` }} /></span>
            <span className="section-bar-value"><strong>{number(section.score)}</strong> / {number(max)}</span>
          </li>;
        })}</ul>
      </>}
      {evaluation.total == null && <p className="result-overview-empty">{t('Нет применимых критериев для расчёта')}</p>}
      <p className="result-overview-meta">{t('Чек-лист')} <strong>v{evaluation.checklist_version ?? '—'}</strong> · {t('Критериев')} <strong>{criteriaCount}</strong></p>
    </div>
  </div>;
}

function GrossBanner({ entries, context }: { entries: CriterionEntry[]; context: ResultContext }) {
  const entry = entries.find(({ item, definition }) => isGross(item, definition) && item.answer === 'yes');
  if (!entry) return <div className="result-critical-banner"><Icon name="alert" /><div><strong>{t('Выявлена грубая ошибка')}</strong><p>{t('На итог не влияет, учитывается отдельно.')}</p></div></div>;
  const { item, definition } = entry;
  const reason = criterionReason(item, criterionTitle(item, definition));
  const quote = Array.isArray(item.evidence) ? item.evidence.find(evidence => evidence?.quote)?.quote : undefined;
  const turn = firstTurn(item, context.transcriptLength);
  return <div className="result-critical-banner" role="note">
    <Icon name="alert" />
    <div>
      <strong>{t('Грубая ошибка:')} <TurnText text={reason || t('причина не указана')} reference={transcriptReference(context.transcriptLength)} /></strong>
      {quote && <blockquote>«{quote}»</blockquote>}
      <div className="result-critical-actions">
        {turn != null && <button type="button" className="btn btn-small" data-turn={turn}>{t('К реплике № {n}', { n: turn + 1 })}</button>}
        <AppealButton criterionId={item.criterion_id} context={context} compact />
      </div>
      <p>{t('На итог не влияет, учитывается отдельно.')}</p>
    </div>
  </div>;
}

function ResultLosses({ entries, context, onReveal }: { entries: CriterionEntry[]; context: ResultContext; onReveal: (id: string) => void }) {
  const losses = entries.flatMap(entry => {
    const { item, definition } = entry;
    const max = maxPointsOf(item, definition);
    const points = pointsOf(item);
    if (isGross(item, definition) || item.answer === 'na' || item.applicable === false || typeof max !== 'number' || !(max > 0) || typeof points !== 'number') return [];
    const lost = max - points;
    return lost > 0.005 ? [{ ...entry, lost }] : [];
  }).sort((a, b) => b.lost - a.lost);
  const reference = transcriptReference(context.transcriptLength);
  return <section className="result-losses" aria-labelledby="result-losses-title">
    <h3 id="result-losses-title" className="result-block-label">{t('Почему снижена оценка')}</h3>
    {losses.length ? <ol className="loss-list">{losses.map(({ item, definition, lost }) => {
      const title = criterionTitle(item, definition);
      const turn = firstTurn(item, context.transcriptLength);
      return <li className="loss-row" key={item.criterion_id} data-criterion={item.criterion_id}>
        <span className="loss-value" aria-label={t('Потеряно баллов: {points}', { points: number(lost) })}>−{number(lost)}</span>
        <div className="loss-main">
          <button type="button" className="loss-title" aria-controls={`criterion-${item.criterion_id}`} onClick={() => onReveal(item.criterion_id)}>{title} · {answerText(item, definition)}</button>
          <p className="loss-reason"><TurnText text={criterionReason(item, title)} reference={reference} /></p>
        </div>
        <div className="loss-actions">
          {turn != null && <button type="button" className="btn btn-small" data-turn={turn}>{t('К реплике № {n}', { n: turn + 1 })}</button>}
          <AppealButton criterionId={item.criterion_id} context={context} compact />
        </div>
      </li>;
    })}</ol> : <p className="loss-empty">{t('Баллы не потеряны')}</p>}
  </section>;
}

export function EvaluationView({ evaluation, checklist, appeals = [], dialog, demo = false }: EvaluationViewProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState<string | null>(null);
  if (!evaluation) return <>
    <div className="panel-heading"><h2>{t('Оценка качества')}</h2></div>
    <div className="empty-state"><div className="empty-symbol"><Icon name="list" /></div><h2>{t('Оценка ещё не выполнена')}</h2><p>{t('Выберите чек-лист и запустите оценку. Здесь появятся ответы, баллы и доказательства.')}</p></div>
  </>;
  const criteria = Array.isArray(evaluation.criteria) ? evaluation.criteria : [];
  const definitions = Array.isArray(checklist?.criteria) ? checklist.criteria : [];
  const sections = Array.isArray(checklist?.sections) ? checklist.sections : [];
  const groups: ResultGroup[] = sections.map(section => ({ id: section.id, name: section.name, entries: [] }));
  const entries: CriterionEntry[] = [];
  for (const [index, item] of criteria.entries()) {
    const definition = definitions.find(criterion => criterion.id === item.criterion_id);
    let group = groups.find(candidate => candidate.id === definition?.section_id);
    if (!group) {
      const groupId = definition?.section_id || '__other__';
      group = groups.find(candidate => candidate.id === groupId);
      if (!group) {
        group = { id: groupId, name: sections.length ? t('Другие критерии') : t('Критерии оценки'), entries: [] };
        groups.push(group);
      }
    }
    const entry = { item, definition, index };
    group.entries.push(entry);
    entries.push(entry);
  }
  const revisions = appeals.filter(appeal => appeal.evaluation_id === evaluation.id && appeal.decision);
  const original = evaluation.original_total;
  const hasRevision = typeof original === 'number' || revisions.length > 0;
  const sectionScores = Array.isArray(evaluation.sections) ? evaluation.sections : [];
  const barSections = sectionScores.filter(section => (sectionMax(section) ?? 0) > 0);
  const ungroupedScores = sectionScores.filter(section => !barSections.includes(section) && !groups.some(group => group.id === section.id && group.entries.length));
  const context: ResultContext = { evaluation, appeals, dialog, transcriptLength: dialog?.transcript?.length || 0 };
  const toggle = (id: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Moving to a criterion from the map, the summary or a link opens its details first, then focuses the card.
  function reveal(id: string) {
    flushSync(() => { setActive(id); setExpanded(previous => previous.has(id) ? previous : new Set(previous).add(id)); });
    const target = document.getElementById(`criterion-${id}`);
    if (!target) return;
    clearLinkedEvidence();
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  return <>
    <div className="panel-heading result-panel-heading">
      <div><span className="result-eyebrow">{t('РЕЗУЛЬТАТ ПРОВЕРКИ')}</span><h2>{t('Оценка качества')}</h2></div>
      <span className={`badge ${demo ? 'badge-amber' : 'badge-green'}`}>{demo ? t('Учебная оценка') : evaluation.model || t('AI-оценка')}</span>
    </div>
    <ResultOverview evaluation={evaluation} sections={barSections} names={sections} criteriaCount={criteria.length} />
    {evaluation.gross_error && <GrossBanner entries={entries} context={context} />}
    {criteria.some(item => item.needs_review) && <div className="result-review-banner">{t('Есть ответы, требующие проверки человеком. Проверьте обоснования перед использованием оценки.')}</div>}
    {hasRevision && <div className="result-total-revision">
      <span className="result-block-label">{t('Пересмотр результата')}</span>
      <div className="result-revision-flow">
        <div><span>{t('Исходная оценка')}</span><strong>{number(original)}</strong></div>
        <div className="revision-decision"><span>{t('Решение проверяющего')}</span><strong>{revisions.length ? t('Сохранено: {n}', { n: revisions.length }) : t('Результат пересмотрен')}</strong></div>
        <div className="revision-final"><span>{t('Итоговая оценка')}</span><strong>{number(evaluation.total)}</strong></div>
      </div>
    </div>}
    {evaluation.total != null && <ResultLosses entries={entries} context={context} onReveal={reveal} />}
    {ungroupedScores.length > 0 && <div className="result-unmapped-sections">
      <span className="result-block-label">{t('Баллы по секциям')}</span>
      <div className="section-results">{ungroupedScores.map((section, index) => <span className="section-result" key={`${section.id}-${index}`}>{section.name || sections.find(candidate => candidate.id === section.id)?.name || section.id} <strong>{number(section.score)}</strong></span>)}</div>
    </div>}
    <ResultNavigator groups={groups} active={active} onNavigate={reveal} />
    <div className="result-groups">{groups.filter(group => group.entries.length).map((group, index) => {
      const score = sectionScores.find(section => section.id === group.id);
      const critical = group.entries.some(entry => entry.definition?.gross_error);
      const max = score ? sectionMax(score) : null;
      return <section key={`${group.id}-${index}`} className={`result-group ${critical ? 'result-group-gross' : ''}`} aria-labelledby={`result-group-${index}`}>
        <header className="result-group-heading"><span className="result-group-index">{String(index + 1).padStart(2, '0')}</span><h3 id={`result-group-${index}`}>{group.name}</h3>{score && <span className="result-section-score"><span>{t('Балл секции')}</span><strong>{number(score.score)}{max ? <span> / {number(max)}</span> : null}</strong></span>}</header>
        {group.entries.map(({ item, definition, index: criterionIndex }) => <ResultCriterion key={`${item.criterion_id}-${criterionIndex}`} item={item} criterion={definition} index={criterionIndex} context={context} open={expanded.has(item.criterion_id)} onToggle={() => toggle(item.criterion_id)} />)}
      </section>;
    })}</div>
  </>;
}
