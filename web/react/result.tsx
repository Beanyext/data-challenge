import type { Appeal, Checklist, Criterion, CriterionResult, DialogRecord, Evaluation } from './types';
import { Icon, label, number } from './shared';

export interface EvaluationViewProps {
  evaluation?: Evaluation | null;
  checklist?: Checklist | null;
  appeals?: Appeal[];
  dialog?: DialogRecord | null;
  demo?: boolean;
}

type CriterionTone = 'na' | 'review' | 'critical' | 'success' | 'attention';
type CriterionEntry = { item: CriterionResult; definition?: Criterion; index: number };
type ResultGroup = { id: string; name?: string; entries: CriterionEntry[] };
type ResultContext = { evaluation: Evaluation; appeals: Appeal[]; dialog?: DialogRecord | null };

const answerLabel = (answer: unknown) => answer === 'yes' || answer === 'no' || answer === 'na' ? label(answer) : number(answer);

// Presentation only: answers, weights and totals always come from the existing result.
function criterionTone(item: CriterionResult, criterion?: Criterion): CriterionTone {
  if (item.answer === 'na') return 'na';
  if (item.needs_review) return 'review';
  if (criterion?.gross_error) return item.answer === 'yes' ? 'critical' : item.answer === 'no' ? 'success' : 'review';
  if (item.answer === 'yes' || typeof item.answer === 'number' && item.answer === criterion?.scale?.max) return 'success';
  return 'attention';
}

function CriterionScale({ item, criterion }: { item: CriterionResult; criterion?: Criterion }) {
  const scale = criterion?.scale;
  if (criterion?.answer_type !== 'scale' || item.answer === 'na' || !scale || !Array.isArray(scale.steps)) return null;
  const current = scale.steps.find(step => step.value === item.answer);
  return <div className="result-scale">
    <div className="result-scale-caption"><span>Оценка по шкале</span><strong>{number(item.answer)} <span>/ {number(scale.max)}</span></strong></div>
    <ol className="result-scale-steps" aria-label="Ступени шкалы">
      {scale.steps.map((step, index) => <li key={`${step.value}-${index}`} className={step.value === item.answer ? 'is-current' : ''}>
        <span>{number(step.value)}</span>
        {step.value === item.answer && <span className="sr-only">Текущая оценка</span>}
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
      <div className="result-evidence-heading"><Icon name="dialogs" /><span>{valid ? `Реплика ${turn + 1}` : 'Цитата из диалога'}</span></div>
      <blockquote>«{entry.quote}»</blockquote>
      {valid ? <button className="evidence-link" data-turn={turn}>Перейти к реплике <Icon name="arrow-right" /></button> : <span className="result-missing-reference">Корректный номер реплики не указан</span>}
    </div>;
  };
  const range = item.checked_range;
  const validRange = range && validTurn(range.from) && validTurn(range.to) && range.to >= range.from;
  return <>
    {evidence.length > 0 && quote(evidence[0], 0)}
    {evidence.length > 1 && <details className="result-more-evidence">
      <summary>Другие доказательства · {evidence.length - 1}</summary>
      {evidence.slice(1).map((entry, index) => quote(entry, index + 1))}
    </details>}
    {validRange ? <div className="result-range">
      <span className="result-block-label">Проверенный участок разговора</span>
      <div><strong>Реплики {range.from + 1}–{range.to + 1}</strong><button className="evidence-link" data-turn={range.from} data-range-end={range.to}>К участку <Icon name="arrow-right" /></button></div>
    </div> : range ? <div className="notice result-range-warning">Некорректный диапазон доказательства</div> : null}
  </>;
}

function CriterionRevision({ item, appeal }: { item: CriterionResult; appeal?: Appeal }) {
  if (!appeal?.decision) return null;
  return <div className="result-revision">
    <div className="result-block-label">Решение проверяющего</div>
    <div className="result-answer-comparison">
      <div><span>Исходный ответ</span><strong>{item.original_answer !== undefined ? answerLabel(item.original_answer) : 'Не указан'}</strong></div>
      <span className="comparison-arrow"><Icon name="arrow-right" /></span>
      <div><span>После пересмотра</span><strong>{answerLabel(item.answer)}</strong></div>
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
  const badge = gross ? item.answer === 'yes' ? 'Нарушение выявлено' : item.answer === 'no' ? 'Не выявлено' : answerLabel(item.answer) : item.answer === 'na' ? 'Не применяется' : answerLabel(item.answer);
  const baseWeight = item.weight ?? criterion?.weight;
  const maxPoints = item.effective_weight ?? baseWeight;
  const points = item.points ?? item.score;
  const hasAdjustedWeight = Number.isFinite(item.effective_weight) && Number.isFinite(baseWeight) && item.effective_weight !== baseWeight;
  return <article className={`criterion result-criterion result-criterion-${tone}`} id={`criterion-${item.criterion_id}`}>
    <div className="criterion-head">
      <div className="result-criterion-title">
        <span className="result-criterion-index">{String(index + 1).padStart(2, '0')}</span>
        <div><span className="criterion-number">{gross ? 'Отдельная отметка' : criterion?.answer_type === 'scale' ? 'Шкальный критерий' : 'Критерий качества'}</span><h3>{criterion?.title || item.criterion_id}</h3></div>
      </div>
      <span className={`result-answer result-answer-${tone}`}>{tone === 'success' ? <Icon name="check" /> : tone === 'critical' ? <Icon name="alert" /> : null}{badge}</span>
    </div>
    {item.needs_review && <div className="result-review-note">Нужна проверка человеком. Ответ требует подтверждения.</div>}
    {gross && <p className="result-gross-caption">Отмечается отдельно от итогового балла.</p>}
    {item.answer === 'na' ? <div className="result-na">
      <span className="result-block-label">Почему критерий не применяется</span>
      <p>{item.na_reason || 'Причина не указана в результате.'}</p>
      <span>{gross ? 'Неприменимость указана для отдельной отметки.' : 'Критерий исключён из итогового расчёта.'}</span>
    </div> : gross ? null : <>
      <CriterionScale item={item} criterion={criterion} />
      <dl className="criterion-metrics">
        <div><dt>Базовый вес</dt><dd>{number(baseWeight)}</dd></div>
        <div><dt>{hasAdjustedWeight ? 'Вес после N/A' : 'Максимум баллов'}</dt><dd>{number(maxPoints)}</dd></div>
        <div className="criterion-contribution"><dt>Баллы в итог</dt><dd>{number(points)}<span> / {number(maxPoints)}</span></dd></div>
      </dl>
      {hasAdjustedWeight && <p className="result-weight-note">Вес перераспределён с учётом неприменимых критериев.</p>}
    </>}
    <div className="result-reason"><span className="result-block-label">Обоснование</span><p>{item.explanation || 'Обоснование не получено.'}</p></div>
    <CriterionEvidence item={item} transcriptLength={dialog?.transcript?.length || 0} />
    <CriterionRevision item={item} appeal={decision} />
    <div className="result-criterion-footer">
      <span>{gross ? 'Не входит в балльную оценку' : item.answer === 'na' ? 'N/A — не является ошибкой' : 'Оценка по выбранному чек-листу'}</span>
      <button className="btn btn-small btn-ghost" data-appeal={item.criterion_id} disabled={Boolean(openAppeal)}><Icon name="appeal" />{openAppeal ? 'Апелляция подана' : 'Оспорить'}</button>
    </div>
    {criterion && <details className="result-rule">
      <summary>Правило и условия критерия</summary>
      <p>{criterion.description}</p>
      <p>{gross ? 'Отдельный флаг без баллов.' : `Базовый вес: ${number(criterion.weight)}.`} {criterion.na_allowed ? `N/A: ${criterion.na_rule ?? ''}` : 'N/A не допускается.'}</p>
      {criterion.notes && <p>{criterion.notes}</p>}
    </details>}
  </article>;
}

export function EvaluationView({ evaluation, checklist, appeals = [], dialog, demo = false }: EvaluationViewProps) {
  if (!evaluation) return <>
    <div className="panel-heading"><h2>Оценка качества</h2></div>
    <div className="empty-state"><div className="empty-symbol"><Icon name="list" /></div><h2>Оценка ещё не выполнена</h2><p>Выберите чек-лист и запустите оценку. Здесь появятся ответы, баллы и доказательства.</p></div>
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
        group = { id: groupId, name: sections.length ? 'Другие критерии' : 'Критерии оценки', entries: [] };
        groups.push(group);
      }
    }
    group.entries.push({ item, definition, index });
  }
  const revisions = appeals.filter(appeal => appeal.evaluation_id === evaluation.id && appeal.decision);
  const original = evaluation.original_total;
  const hasRevision = typeof original === 'number' || revisions.length > 0;
  const sectionScores = Array.isArray(evaluation.sections) ? evaluation.sections : [];
  const ungroupedScores = sectionScores.filter(section => !groups.some(group => group.id === section.id && group.entries.length));
  const context: ResultContext = { evaluation, appeals, dialog };
  return <>
    <div className="panel-heading result-panel-heading">
      <div><span className="result-eyebrow">РЕЗУЛЬТАТ ПРОВЕРКИ</span><h2>Оценка качества</h2></div>
      <span className={`badge ${demo ? 'badge-amber' : 'badge-green'}`}>{demo ? 'Учебная оценка' : evaluation.model || 'AI-оценка'}</span>
    </div>
    <div className="result-summary" data-reveal="">
      <div className="result-score-area"><span className="result-block-label">Итоговый балл</span><div className="result-score">{number(evaluation.total)} <span>/ 100</span></div><p>{evaluation.total == null ? 'Нет применимых критериев для расчёта' : 'По результатам оценки диалога'}</p></div>
      <div className="result-summary-meta"><span>Чек-лист <strong>v{evaluation.checklist_version}</strong></span><span>Критериев <strong>{criteria.length}</strong></span></div>
    </div>
    {evaluation.gross_error && <div className="result-critical-banner"><Icon name="alert" /><div><strong>Выявлена грубая ошибка</strong><p>Проверьте раздел нарушений. Эта отметка рассматривается отдельно от итогового балла.</p></div></div>}
    {criteria.some(item => item.needs_review) && <div className="result-review-banner">Есть ответы, требующие проверки человеком. Проверьте обоснования перед использованием оценки.</div>}
    {hasRevision && <div className="result-total-revision">
      <span className="result-block-label">Пересмотр результата</span>
      <div className="result-revision-flow">
        <div><span>Исходная оценка</span><strong>{number(original)}</strong></div>
        <div className="revision-decision"><span>Решение проверяющего</span><strong>{revisions.length ? `Сохранено: ${revisions.length}` : 'Результат пересмотрен'}</strong></div>
        <div className="revision-final"><span>Итоговая оценка</span><strong>{number(evaluation.total)}</strong></div>
      </div>
    </div>}
    {ungroupedScores.length > 0 && <div className="result-unmapped-sections">
      <span className="result-block-label">Баллы по секциям</span>
      <div className="section-results">{ungroupedScores.map((section, index) => <span className="section-result" key={`${section.id}-${index}`}>{section.name || sections.find(candidate => candidate.id === section.id)?.name || section.id} <strong>{number(section.score)}</strong></span>)}</div>
    </div>}
    <div className="result-groups">{groups.filter(group => group.entries.length).map((group, index) => {
      const score = sectionScores.find(section => section.id === group.id);
      const critical = group.entries.some(entry => entry.definition?.gross_error);
      return <section key={`${group.id}-${index}`} className={`result-group ${critical ? 'result-group-gross' : ''}`} aria-labelledby={`result-group-${index}`}>
        <header className="result-group-heading"><span className="result-group-index">{String(index + 1).padStart(2, '0')}</span><h3 id={`result-group-${index}`}>{group.name}</h3>{score && <span className="result-section-score"><span>Балл секции</span><strong>{number(score.score)}</strong></span>}</header>
        {group.entries.map(({ item, definition, index: criterionIndex }) => <ResultCriterion key={`${item.criterion_id}-${criterionIndex}`} item={item} criterion={definition} index={criterionIndex} context={context} />)}
      </section>;
    })}</div>
  </>;
}
