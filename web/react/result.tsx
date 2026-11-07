import { useState } from 'react';
import type { Appeal, Checklist, Criterion, CriterionResult, DialogRecord, Evaluation } from './types';
import { Icon, label, number } from './shared';
import { translate as t } from './i18n';
import { evaluationWasReviewed, hasAnswer, incompleteEvaluation } from './evaluation-state';

export interface EvaluationViewProps {
  evaluation?: Evaluation | null;
  checklist?: Checklist | null;
  appeals?: Appeal[];
  dialog?: DialogRecord | null;
  demo?: boolean;
  selectedCriterion?: string | null;
  onCriterionNavigate?: (id:string) => void;
}

type CriterionTone = 'na' | 'review' | 'critical' | 'success' | 'attention' | 'neutral';
type CriterionEntry = { item: CriterionResult; definition?: Criterion; index: number };
type ResultGroup = { id: string; name?: string; entries: CriterionEntry[] };
type ResultContext = { evaluation: Evaluation; appeals: Appeal[]; dialog?: DialogRecord | null; selectedCriterion?:string|null };

const answerLabel = (answer: unknown) => !hasAnswer(answer) ? t('Ответ не получен') : answer === 'yes' || answer === 'no' || answer === 'na' ? label(answer) : number(answer);
const criterionAnswer = (item: CriterionResult, criterion?: Criterion) => criterion?.gross_error
  ? item.answer === 'yes' ? t('Нарушение выявлено') : item.answer === 'no' ? t('Не выявлено') : answerLabel(item.answer)
  : item.answer === 'na' ? t('Не применяется') : answerLabel(item.answer);

// Presentation only: answers, weights and totals always come from the existing result.
function criterionTone(item: CriterionResult, criterion?: Criterion): CriterionTone {
  if (!hasAnswer(item.answer)) return 'review';
  if (item.answer === 'na') return 'na';
  if (criterion?.gross_error && item.answer === 'yes') return 'critical';
  if (item.needs_review) return 'review';
  if (!criterion) return 'neutral';
  if (criterion?.gross_error) return item.answer === 'yes' ? 'critical' : item.answer === 'no' ? 'success' : 'review';
  if (item.answer === 'yes' || typeof item.answer === 'number' && item.answer === criterion?.scale?.max) return 'success';
  return 'attention';
}

function ResultNavigator({ groups, onNavigate }: { groups: ResultGroup[]; onNavigate?:(id:string)=>void }) {
  const [active, setActive] = useState<string | null>(null);
  const visibleGroups = groups.filter(group => group.entries.length);
  if (!visibleGroups.length) return null;
  function navigate(id: string) {
    const target = document.getElementById(`criterion-${id}`);
    if (!target) return;
    onNavigate?.(id);
    setActive(id);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  return <nav className="result-navigator" id="criteria-map" tabIndex={-1} aria-label={t('Карта критериев')}>
    <div className="result-navigator-heading"><span className="result-nav-symbol"><Icon name="list" /></span><div><h3>{t('Карта критериев')}</h3><p>{t('Выберите критерий, чтобы перейти к обоснованию.')}</p></div></div>
    <div className="result-nav-groups">{visibleGroups.map(group => <div className="result-nav-group" key={group.id}>
      <div className="result-nav-section">{group.name}</div>
      <div className="result-nav-items">{group.entries.map(({ item, definition, index }) => {
        const tone = criterionTone(item, definition);
        return <button type="button" className={`result-nav-item result-nav-${tone}`} key={`${item.criterion_id}-${index}`} aria-controls={`criterion-${item.criterion_id}`} aria-current={active === item.criterion_id ? 'location' : undefined} onClick={() => navigate(item.criterion_id)}>
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

function ResultCriterion({ item, criterion, index, context }: { item: CriterionResult; criterion?: Criterion; index: number; context: ResultContext }) {
  const { evaluation, appeals, dialog } = context;
  const openAppeal = appeals.find(appeal => appeal.evaluation_id === evaluation.id && appeal.criterion_id === item.criterion_id && appeal.status === 'open');
  const decision = appeals.findLast(appeal => appeal.evaluation_id === evaluation.id && appeal.criterion_id === item.criterion_id && appeal.decision);
  const tone = criterionTone(item, criterion);
  const gross = criterion?.gross_error;
  const badge = criterionAnswer(item, criterion);
  const baseWeight = item.weight ?? criterion?.weight;
  const maxPoints = item.effective_weight ?? baseWeight;
  const points = item.points ?? item.score;
  const hasAdjustedWeight = Number.isFinite(item.effective_weight) && Number.isFinite(baseWeight) && item.effective_weight !== baseWeight;
  return <article className={`criterion result-criterion result-criterion-${tone}${context.selectedCriterion===item.criterion_id?' evidence-selected':''}`} id={`criterion-${item.criterion_id}`} tabIndex={-1}>
    <div className="criterion-head">
      <div className="result-criterion-title">
        <span className="result-criterion-index">{String(index + 1).padStart(2, '0')}</span>
        <div><span className="criterion-number">{gross ? t('Отдельная отметка') : criterion?.answer_type === 'scale' ? t('Шкальный критерий') : t('Критерий качества')}</span><h3>{criterion?.title || item.criterion_id}</h3></div>
      </div>
      <span className={`result-answer result-answer-${tone}`}>{tone === 'success' ? <Icon name="check" /> : tone === 'critical' ? <Icon name="alert" /> : null}{badge}</span>
    </div>
    {context.selectedCriterion===item.criterion_id&&<div className="linked-evidence-label"><Icon name="arrow-left"/>{t('Связанная реплика выделена')}</div>}
    {item.needs_review && <div className="result-review-note">{t('Нужна проверка человеком. Ответ требует подтверждения.')}</div>}
    {gross && <p className="result-gross-caption">{t('Отмечается отдельно от итогового балла.')}</p>}
    {item.answer === 'na' ? <div className="result-na">
      <span className="result-block-label">{t('Почему критерий не применяется')}</span>
      <p>{item.na_reason || t('Причина не указана в результате.')}</p>
      <span>{gross ? t('Неприменимость указана для отдельной отметки.') : t('Критерий исключён из итогового расчёта.')}</span>
    </div> : gross ? null : <div className="result-points"><span>{t('Баллы в итог')}</span><strong>{number(points)} <span>/ {number(maxPoints)}</span></strong></div>}
    <div className="result-reason"><span className="result-block-label">{t('Обоснование')}</span><p>{item.explanation || t('Обоснование не получено.')}</p></div>
    <CriterionEvidence item={item} transcriptLength={dialog?.transcript?.length || 0} />
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
      <button className="btn btn-small btn-ghost" data-appeal={item.criterion_id} disabled={Boolean(openAppeal)}><Icon name="appeal" />{openAppeal ? t('Апелляция подана') : t('Оспорить')}</button>
    </div>
    {criterion && <details className="result-rule">
      <summary>{t('Правило и условия критерия')}</summary>
      <p>{criterion.description}</p>
      <p>{gross ? t('Отдельный флаг без баллов.') : t('Базовый вес: {weight}.', { weight: number(criterion.weight) })} {criterion.na_allowed ? `N/A: ${criterion.na_rule ?? ''}` : t('N/A не допускается.')}</p>
      {criterion.notes && <p>{criterion.notes}</p>}
    </details>}
  </article>;
}

export function EvaluationView({ evaluation, checklist, appeals = [], dialog, demo = false, selectedCriterion, onCriterionNavigate }: EvaluationViewProps) {
  if (!evaluation) return <>
    <div className="panel-heading"><h2>{t('Оценка качества')}</h2></div>
    <div className="empty-state"><div className="empty-symbol"><Icon name="list" /></div><h2>{t('Оценка ещё не выполнена')}</h2><p>{t('Выберите чек-лист и запустите оценку. Здесь появятся ответы, баллы и доказательства.')}</p></div>
  </>;
  const criteria = Array.isArray(evaluation.criteria) ? evaluation.criteria : [];
  const definitions = Array.isArray(checklist?.criteria) ? checklist.criteria : [];
  const sections = Array.isArray(checklist?.sections) ? checklist.sections : [];
  const groups: ResultGroup[] = sections.map(section => ({ id: section.id, name: section.name, entries: [] }));
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
    group.entries.push({ item, definition, index });
  }
  const revisions = appeals.filter(appeal => appeal.evaluation_id === evaluation.id && appeal.decision);
  const original = evaluation.original_total;
  const hasRevision = evaluationWasReviewed({...evaluation,criteria},appeals);
  const incomplete = !Array.isArray(evaluation.criteria) || incompleteEvaluation(evaluation,checklist);
  const sectionScores = Array.isArray(evaluation.sections) ? evaluation.sections : [];
  const ungroupedScores = sectionScores.filter(section => !groups.some(group => group.id === section.id && group.entries.length));
  const context: ResultContext = { evaluation, appeals, dialog, selectedCriterion };
  const testResult=evaluation.demo===true || [evaluation.provider,evaluation.model].some(value=>typeof value==='string' && ['mock','demo'].includes(value.trim().toLowerCase()));
  const demonstration=demo || testResult;
  return <>
    <div className="panel-heading result-panel-heading">
      <div><span className="result-eyebrow">{t('РЕЗУЛЬТАТ ПРОВЕРКИ')}</span><h2>{t('Оценка качества')}</h2></div>
      <span className={`badge ${demonstration ? 'badge-amber' : 'badge-green'}`}>{demonstration ? t('Учебная оценка') : evaluation.model || t('AI-оценка')}</span>
    </div>
    {!demo&&testResult&&<div className="notice result-demo-notice">{t('Оценка получена в тестовом режиме. Модель не вызывалась.')}</div>}
    {incomplete&&<div className="notice result-incomplete-warning">{t('Оценка неполная: есть критерии без ответа. Проверьте диалог или повторите оценку.')}</div>}
    <div className="result-summary" data-reveal="">
      <div className="result-score-area"><span className="result-block-label">{t(incomplete?'Предварительный балл':'Итоговый балл')}</span><div className="result-score">{number(evaluation.total)} <span>/ 100</span></div><p>{incomplete?t('Есть критерии без ответа'):evaluation.total == null ? t('Нет применимых критериев для расчёта') : t('По результатам оценки диалога')}</p></div>
      <div className="result-summary-meta"><span>{t('Чек-лист')} <strong>v{evaluation.checklist_version}</strong></span><span>{t('Критериев')} <strong>{criteria.length}</strong></span></div>
    </div>
    {evaluation.gross_error && <div className="result-critical-banner"><Icon name="alert" /><div><strong>{t('Выявлена грубая ошибка')}</strong><p>{t('Проверьте раздел нарушений. Эта отметка рассматривается отдельно от итогового балла.')}</p></div></div>}
    {criteria.some(item => item.needs_review) && <div className="result-review-banner">{t('Есть ответы, требующие проверки человеком. Проверьте обоснования перед использованием оценки.')}</div>}
    {!checklist&&<div className="notice result-snapshot-warning">{t('Исходная версия чек-листа недоступна. Правила другой версии не подставляются. Для пересмотра нужен исходный чек-лист.')}</div>}
    {hasRevision && <div className="result-total-revision">
      <span className="result-block-label">{t('Пересмотр результата')}</span>
      <div className="result-revision-flow">
        <div><span>{t('Исходная оценка')}</span><strong>{number(original)}</strong></div>
        <div className="revision-decision"><span>{t('Решение проверяющего')}</span><strong>{revisions.length ? t('Сохранено: {n}', { n: revisions.length }) : t('Результат пересмотрен')}</strong></div>
        <div className="revision-final"><span>{t('Итоговая оценка')}</span><strong>{number(evaluation.total)}</strong></div>
      </div>
    </div>}
    {ungroupedScores.length > 0 && <div className="result-unmapped-sections">
      <span className="result-block-label">{t('Баллы по секциям')}</span>
      <div className="section-results">{ungroupedScores.map((section, index) => <span className="section-result" key={`${section.id}-${index}`}>{section.name || sections.find(candidate => candidate.id === section.id)?.name || section.id} <strong>{number(section.score)}</strong></span>)}</div>
    </div>}
    <ResultNavigator groups={groups} onNavigate={onCriterionNavigate} />
    <div className="result-groups">{groups.filter(group => group.entries.length).map((group, index) => {
      const score = sectionScores.find(section => section.id === group.id);
      const critical = group.entries.some(entry => entry.definition?.gross_error);
      return <section key={`${group.id}-${index}`} className={`result-group ${critical ? 'result-group-gross' : ''}`} aria-labelledby={`result-group-${index}`}>
        <header className="result-group-heading"><span className="result-group-index">{String(index + 1).padStart(2, '0')}</span><h3 id={`result-group-${index}`}>{group.name}</h3>{score && <span className="result-section-score"><span>{t('Балл секции')}</span><strong>{number(score.score)}</strong></span>}</header>
        {group.entries.map(({ item, definition, index: criterionIndex }) => <ResultCriterion key={`${item.criterion_id}-${criterionIndex}`} item={item} criterion={definition} index={criterionIndex} context={context} />)}
      </section>;
    })}</div>
  </>;
}
