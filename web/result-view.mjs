import { icon } from './icons.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : '—';
const answerLabel = value => ({ yes: 'Да', no: 'Нет', na: 'N/A' }[value] ?? number(value));

// Presentation only: all answers, weights and scores are provided by the existing result.
function criterionTone(item, criterion) {
  if (item.answer === 'na') return 'na';
  if (item.needs_review) return 'review';
  if (criterion?.gross_error) return item.answer === 'yes' ? 'critical' : item.answer === 'no' ? 'success' : 'review';
  if (item.answer === 'yes' || typeof item.answer === 'number' && item.answer === criterion?.scale?.max) return 'success';
  return 'attention';
}

function scaleMarkup(item, criterion) {
  if (criterion?.answer_type !== 'scale' || item.answer === 'na' || !Array.isArray(criterion.scale?.steps)) return '';
  const steps = criterion.scale.steps;
  const current = steps.find(step => step.value === item.answer);
  return `<div class="result-scale"><div class="result-scale-caption"><span>Оценка по шкале</span><strong>${number(item.answer)} <span>/ ${number(criterion.scale.max)}</span></strong></div>
    <ol class="result-scale-steps" aria-label="Ступени шкалы">${steps.map(step => `<li class="${step.value === item.answer ? 'is-current' : ''}"><span>${number(step.value)}</span>${step.value === item.answer ? '<span class="sr-only">Текущая оценка</span>' : ''}</li>`).join('')}</ol>
    ${current?.label ? `<p class="result-scale-description">${escape(current.label)}</p>` : ''}</div>`;
}

function evidenceMarkup(item, transcriptLength) {
  const evidence = Array.isArray(item.evidence) ? item.evidence : [];
  const validTurn = turn => Number.isInteger(turn) && turn >= 0 && turn < transcriptLength;
  const quote = (e, first) => `<div class="result-evidence ${first ? 'result-evidence-primary' : ''}"><div class="result-evidence-heading">${icon('dialogs')}<span>${validTurn(e.turn) ? `Реплика ${e.turn + 1}` : 'Цитата из диалога'}</span></div><blockquote>«${escape(e.quote)}»</blockquote>${validTurn(e.turn) ? `<button class="evidence-link" data-turn="${e.turn}">Перейти к реплике ${icon('arrow-right')}</button>` : '<span class="result-missing-reference">Корректный номер реплики не указан</span>'}</div>`;
  const range = item.checked_range;
  const validRange = range && Number.isInteger(range.from) && Number.isInteger(range.to) && range.from >= 0 && range.to >= range.from && range.to < transcriptLength;
  return `${evidence.length ? quote(evidence[0], true) : ''}
    ${evidence.length > 1 ? `<details class="result-more-evidence"><summary>Другие доказательства · ${evidence.length - 1}</summary>${evidence.slice(1).map(e => quote(e, false)).join('')}</details>` : ''}
    ${validRange ? `<div class="result-range"><span class="result-block-label">Проверенный участок разговора</span><div><strong>Реплики ${range.from + 1}–${range.to + 1}</strong><button class="evidence-link" data-turn="${range.from}" data-range-end="${range.to}">К участку ${icon('arrow-right')}</button></div></div>` : range ? '<div class="notice result-range-warning">Некорректный диапазон доказательства</div>' : ''}`;
}

function revisionMarkup(item, decision) {
  if (!decision) return '';
  return `<div class="result-revision"><div class="result-block-label">Решение проверяющего</div>
    <div class="result-answer-comparison"><div><span>Исходный ответ</span><strong>${item.original_answer !== undefined ? escape(answerLabel(item.original_answer)) : 'Не указан'}</strong></div><span class="comparison-arrow">${icon('arrow-right')}</span><div><span>После пересмотра</span><strong>${escape(answerLabel(item.answer))}</strong></div></div>
    <p>${escape(decision.decision.reason)}</p></div>`;
}

function renderCriterion(item, criterion, index, context) {
  const { evaluation, appeals, dialog } = context;
  const openAppeal = appeals.find(a => a.evaluation_id === evaluation.id && a.criterion_id === item.criterion_id && a.status === 'open');
  const decision = appeals.findLast(a => a.evaluation_id === evaluation.id && a.criterion_id === item.criterion_id && a.decision);
  const tone = criterionTone(item, criterion);
  const gross = criterion?.gross_error;
  const badge = gross ? item.answer === 'yes' ? 'Нарушение выявлено' : item.answer === 'no' ? 'Не выявлено' : answerLabel(item.answer) : item.answer === 'na' ? 'Не применяется' : answerLabel(item.answer);
  const baseWeight = item.weight ?? criterion?.weight;
  const maxPoints = item.effective_weight ?? baseWeight;
  const points = item.points ?? item.score;
  const hasAdjustedWeight = Number.isFinite(item.effective_weight) && Number.isFinite(baseWeight) && item.effective_weight !== baseWeight;
  return `<article class="criterion result-criterion result-criterion-${tone}" id="criterion-${escape(item.criterion_id)}">
    <div class="criterion-head"><div class="result-criterion-title"><span class="result-criterion-index">${String(index + 1).padStart(2, '0')}</span><div><span class="criterion-number">${gross ? 'Отдельная отметка' : criterion?.answer_type === 'scale' ? 'Шкальный критерий' : 'Критерий качества'}</span><h3>${escape(criterion?.title || item.criterion_id)}</h3></div></div><span class="result-answer result-answer-${tone}">${tone === 'success' ? icon('check') : tone === 'critical' ? icon('alert') : ''}${escape(badge)}</span></div>
    ${item.needs_review ? '<div class="result-review-note">Нужна проверка человеком. Ответ требует подтверждения.</div>' : ''}
    ${gross ? '<p class="result-gross-caption">Отмечается отдельно от итогового балла.</p>' : ''}
    ${item.answer === 'na' ? `<div class="result-na"><span class="result-block-label">Почему критерий не применяется</span><p>${escape(item.na_reason || 'Причина не указана в результате.')}</p><span>${gross ? 'Неприменимость указана для отдельной отметки.' : 'Критерий исключён из итогового расчёта.'}</span></div>` : gross ? '' : `${scaleMarkup(item, criterion)}
    <dl class="criterion-metrics"><div><dt>Базовый вес</dt><dd>${number(baseWeight)}</dd></div><div><dt>${hasAdjustedWeight ? 'Вес после N/A' : 'Максимум баллов'}</dt><dd>${number(maxPoints)}</dd></div><div class="criterion-contribution"><dt>Баллы в итог</dt><dd>${number(points)}<span> / ${number(maxPoints)}</span></dd></div></dl>
    ${hasAdjustedWeight ? '<p class="result-weight-note">Вес перераспределён с учётом неприменимых критериев.</p>' : ''}`}
    <div class="result-reason"><span class="result-block-label">Обоснование</span><p>${escape(item.explanation || 'Обоснование не получено.')}</p></div>
    ${evidenceMarkup(item, dialog?.transcript?.length || 0)}
    ${revisionMarkup(item, decision)}
    <div class="result-criterion-footer"><span>${gross ? 'Не входит в балльную оценку' : item.answer === 'na' ? 'N/A — не является ошибкой' : 'Оценка по выбранному чек-листу'}</span><button class="btn btn-small btn-ghost" data-appeal="${escape(item.criterion_id)}" ${openAppeal ? 'disabled' : ''}>${icon('appeal')}${openAppeal ? 'Апелляция подана' : 'Оспорить'}</button></div>
    ${criterion ? `<details class="result-rule"><summary>Правило и условия критерия</summary><p>${escape(criterion.description)}</p><p>${gross ? 'Отдельный флаг без баллов.' : `Базовый вес: ${number(criterion.weight)}.`} ${criterion.na_allowed ? `N/A: ${escape(criterion.na_rule)}` : 'N/A не допускается.'}</p>${criterion.notes ? `<p>${escape(criterion.notes)}</p>` : ''}</details>` : ''}
  </article>`;
}

export function renderEvaluationView({ evaluation, checklist, appeals = [], dialog, demo = false }) {
  if (!evaluation) return `<div class="panel-heading"><h2>Оценка качества</h2></div><div class="empty-state"><div class="empty-symbol">${icon('list')}</div><h2>Оценка ещё не выполнена</h2><p>Выберите чек-лист и запустите оценку. Здесь появятся ответы, баллы и доказательства.</p></div>`;
  const criteria = Array.isArray(evaluation.criteria) ? evaluation.criteria : [];
  const definitions = Array.isArray(checklist?.criteria) ? checklist.criteria : [];
  const sections = Array.isArray(checklist?.sections) ? checklist.sections : [];
  const groups = sections.map(section => ({ id: section.id, name: section.name, entries: [] }));
  for (const [index, item] of criteria.entries()) {
    const definition = definitions.find(c => c.id === item.criterion_id);
    let group = groups.find(g => g.id === definition?.section_id);
    if (!group) {
      const groupId = definition?.section_id || '__other__';
      group = groups.find(g => g.id === groupId);
      if (!group) { group = { id: groupId, name: sections.length ? 'Другие критерии' : 'Критерии оценки', entries: [] }; groups.push(group); }
    }
    group.entries.push({ item, definition, index });
  }
  const revisions = appeals.filter(a => a.evaluation_id === evaluation.id && a.decision);
  const original = evaluation.original_total;
  const hasRevision = typeof original === 'number' || revisions.length > 0;
  const sectionScores = Array.isArray(evaluation.sections) ? evaluation.sections : [];
  const ungroupedScores = sectionScores.filter(section => !groups.some(group => group.id === section.id && group.entries.length));
  const context = { evaluation, appeals, dialog };
  return `<div class="panel-heading result-panel-heading"><div><span class="result-eyebrow">РЕЗУЛЬТАТ ПРОВЕРКИ</span><h2>Оценка качества</h2></div><span class="badge ${demo ? 'badge-amber' : 'badge-green'}">${demo ? 'Учебная оценка' : escape(evaluation.model || 'AI-оценка')}</span></div>
    <div class="result-summary"><div class="result-score-area"><span class="result-block-label">Итоговый балл</span><div class="result-score">${number(evaluation.total)} <span>/ 100</span></div><p>${evaluation.total == null ? 'Нет применимых критериев для расчёта' : 'По результатам оценки диалога'}</p></div><div class="result-summary-meta"><span>Чек-лист <strong>v${escape(evaluation.checklist_version)}</strong></span><span>Критериев <strong>${criteria.length}</strong></span></div></div>
    ${evaluation.gross_error ? `<div class="result-critical-banner">${icon('alert')}<div><strong>Выявлена грубая ошибка</strong><p>Проверьте раздел нарушений. Эта отметка рассматривается отдельно от итогового балла.</p></div></div>` : ''}
    ${criteria.some(item => item.needs_review) ? '<div class="result-review-banner">Есть ответы, требующие проверки человеком. Проверьте обоснования перед использованием оценки.</div>' : ''}
    ${hasRevision ? `<div class="result-total-revision"><span class="result-block-label">Пересмотр результата</span><div class="result-revision-flow"><div><span>Исходная оценка</span><strong>${number(original)}</strong></div><div class="revision-decision"><span>Решение проверяющего</span><strong>${revisions.length ? `Сохранено: ${revisions.length}` : 'Результат пересмотрен'}</strong></div><div class="revision-final"><span>Итоговая оценка</span><strong>${number(evaluation.total)}</strong></div></div></div>` : ''}
    ${ungroupedScores.length ? `<div class="result-unmapped-sections"><span class="result-block-label">Баллы по секциям</span><div class="section-results">${ungroupedScores.map(section => `<span class="section-result">${escape(section.name || sections.find(s => s.id === section.id)?.name || section.id)} <strong>${number(section.score)}</strong></span>`).join('')}</div></div>` : ''}
    <div class="result-groups">${groups.filter(group => group.entries.length).map((group, index) => {
      const score = sectionScores.find(section => section.id === group.id);
      const critical = group.entries.some(entry => entry.definition?.gross_error);
      return `<section class="result-group ${critical ? 'result-group-gross' : ''}" aria-labelledby="result-group-${index}"><header class="result-group-heading"><span class="result-group-index">${String(index + 1).padStart(2, '0')}</span><h3 id="result-group-${index}">${escape(group.name)}</h3>${score ? `<span class="result-section-score"><span>Балл секции</span><strong>${number(score.score)}</strong></span>` : ''}</header>${group.entries.map(({ item, definition, index: criterionIndex }) => renderCriterion(item, definition, criterionIndex, context)).join('')}</section>`;
    }).join('')}</div>`;
}
