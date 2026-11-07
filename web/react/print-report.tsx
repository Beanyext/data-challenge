import { useEffect } from 'react';
import type { Appeal, Checklist, Criterion, CriterionResult, DialogRecord, Evaluation } from './types';
import { channel, label, number } from './shared';
import { translate as t } from './i18n';
import { stopMotion } from './motion';

const answerText = (answer: unknown) => typeof answer === 'number' ? number(answer) : label(answer);
function reportedAnswer(item: CriterionResult, criterion?: Criterion) {
  if (item.answer === 'na') return t('Не применяется');
  if (criterion?.gross_error) return item.answer === 'yes' ? t('Нарушение выявлено') : item.answer === 'no' ? t('Не выявлено') : answerText(item.answer);
  return answerText(item.answer);
}

export function PrintReport({ record, evaluation, checklist: availableChecklist, appeals, demo }: {
  record: DialogRecord; evaluation: Evaluation | null; checklist?: Checklist; appeals: Appeal[]; demo: boolean;
}) {
  // Printing has its own complete DOM. No details, scroll position, routes or drafts are mutated.
  useEffect(() => {
    window.addEventListener('beforeprint', stopMotion);
    return () => window.removeEventListener('beforeprint', stopMotion);
  }, []);
  const checklist = evaluation?.checklist || (evaluation && availableChecklist?.id === evaluation.checklist_id && availableChecklist?.version === evaluation.checklist_version ? availableChecklist : undefined);
  const transcript = record.transcript || [];
  const criteria = Array.isArray(evaluation?.criteria) ? evaluation.criteria : [];
  const definitions = Array.isArray(checklist?.criteria) ? checklist.criteria : [];
  const sections = Array.isArray(checklist?.sections) ? checklist.sections : [];
  const decisions = appeals.filter(appeal => appeal.evaluation_id === evaluation?.id && appeal.decision);
  const roles: Record<string, string> = { operator: t('Оператор'), client: t('Клиент'), bot: t('Бот'), system: t('Система') };
  const validTurn = (index: unknown): index is number => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < transcript.length;
  return <article className="print-report" aria-label={t('Отчёт о качестве диалога')}>
    <header className="print-report-heading"><img src="./assets/freedom-logo-print.svg" width="168" height="40" alt="Freedom"/><span>Conversation Quality Analytics</span></header>
    <h1>{t('Отчёт о качестве диалога')}</h1>
    <p className="print-report-subject">{record.title || record.subject || t('Карточка диалога')}</p>
    {demo && <p className="print-notice"><strong>{t('Учебный пример.')}</strong> {t('Вымышленные диалоги и оценки, модель не вызывается.')}</p>}
    <dl className="print-metadata">
      <div><dt>{t('Диалог')}</dt><dd>{record.conversation_id}</dd></div>
      <div><dt>{t('Канал')}</dt><dd>{channel(record.channel)}</dd></div>
      <div><dt>{t('Язык')}</dt><dd>{record.language}</dd></div>
      <div><dt>{t('Чек-лист')}</dt><dd>{checklist?.name || evaluation?.checklist_id || t('Не указан')}{evaluation?.checklist_version != null && ` · v${evaluation.checklist_version}`}</dd></div>
      {evaluation && <div><dt>{t('Оценка качества')}</dt><dd>{demo ? t('Учебная оценка') : evaluation.model || t('AI-оценка')}</dd></div>}
    </dl>
    {evaluation ? <>
      <section className="print-summary"><div><span>{t('Итоговый балл')}</span><strong>{number(evaluation.total)} <small>/ 100</small></strong></div><div><span>{t('Критериев')}</span><strong>{criteria.length}</strong></div></section>
      {evaluation.total == null && <p className="print-notice">{t('Нет применимых критериев для расчёта')}</p>}
      {evaluation.gross_error && <p className="print-notice print-critical"><strong>{t('Выявлена грубая ошибка')}</strong><br/>{t('Проверьте раздел нарушений. Эта отметка рассматривается отдельно от итогового балла.')}</p>}
      {criteria.some(item => item.needs_review) && <p className="print-notice">{t('Есть ответы, требующие проверки человеком. Проверьте обоснования перед использованием оценки.')}</p>}
      {!checklist && <p className="print-notice">{t('Версия чек-листа недоступна. Показаны сохранённые ответы и баллы.')}</p>}
      {(typeof evaluation.original_total === 'number' || decisions.length > 0) && <section className="print-revision"><h2>{t('Пересмотр результата')}</h2><p>{t('Исходная оценка')}: <strong>{number(evaluation.original_total)}</strong> · {t('Итоговая оценка')}: <strong>{number(evaluation.total)}</strong></p></section>}
      {Array.isArray(evaluation.sections) && evaluation.sections.length > 0 && <section><h2>{t('Баллы по секциям')}</h2><dl className="print-section-scores">{evaluation.sections.map((section, index) => <div key={`${section.id}-${index}`}><dt>{section.name || sections.find(item => item.id === section.id)?.name || section.id}</dt><dd>{number(section.score)}</dd></div>)}</dl></section>}
      <h2>{t('Критерии оценки')}</h2>
      {criteria.map((item, index) => {
        const definition = definitions.find(criterion => criterion.id === item.criterion_id);
        const section = sections.find(section => section.id === definition?.section_id);
        const criterionAppeals = appeals.filter(appeal => appeal.evaluation_id === evaluation.id && appeal.criterion_id === item.criterion_id);
        const evidence = Array.isArray(item.evidence) ? item.evidence : [];
        const range = item.checked_range;
        const scale = definition?.scale;
        const baseWeight = item.weight ?? definition?.weight;
        const adjustedWeight = Number.isFinite(baseWeight) && Number.isFinite(item.effective_weight) && baseWeight !== item.effective_weight;
        return <section className="print-criterion" key={`${item.criterion_id}-${index}`}>
          {section?.name && <p className="print-section-name">{section.name}</p>}
          <h3>{String(index + 1).padStart(2, '0')} · {definition?.title || item.criterion_id}</h3>
          <p className="print-answer"><strong>{reportedAnswer(item, definition)}</strong>{item.needs_review && <span> · {t('Нужна проверка')}</span>}</p>
          {definition?.gross_error && <p>{t('Отмечается отдельно от итогового балла.')}</p>}
          {item.answer === 'na' ? <div><h4>{t('Почему критерий не применяется')}</h4><p>{item.na_reason || t('Причина не указана в результате.')}</p></div> : !definition?.gross_error && <>
            <p className="print-calculation">{t('Баллы в итог')}: <strong>{number(item.points ?? item.score)} / {number(item.effective_weight ?? baseWeight)}</strong> · {t('Базовый вес')}: {number(baseWeight)}{item.effective_weight != null && <> · {t(adjustedWeight ? 'Вес после N/A' : 'Максимум баллов')}: {number(item.effective_weight)}</>}</p>
            {definition?.answer_type === 'scale' && scale && <p>{t('Оценка по шкале')}: {number(item.answer)} / {number(scale.max)}{scale.steps?.find(step => step.value === item.answer)?.label && <> — {scale.steps.find(step => step.value === item.answer)!.label}</>}</p>}
          </>}
          <h4>{t('Обоснование')}</h4><p>{item.explanation || t('Обоснование не получено.')}</p>
          {evidence.map((entry, evidenceIndex) => <div className="print-evidence" key={evidenceIndex}><h4>{validTurn(entry.turn) ? t('Реплика {n}', { n: entry.turn + 1 }) : t('Цитата из диалога')}</h4><blockquote>«{entry.quote}»</blockquote>{!validTurn(entry.turn) && <p>{t('Корректный номер реплики не указан')}</p>}</div>)}
          {range && <p><strong>{t('Проверенный участок разговора')}: </strong>{validTurn(range.from) && validTurn(range.to) && range.to >= range.from ? t('Реплики {from}–{to}', { from: range.from + 1, to: range.to + 1 }) : t('Некорректный диапазон доказательства')}</p>}
          {definition && <div className="print-rule"><h4>{t('Правило и условия критерия')}</h4><p>{definition.description}</p>{definition.na_allowed && <p>N/A: {definition.na_rule || t('Не указан')}</p>}{definition.notes && <p>{definition.notes}</p>}</div>}
          {criterionAppeals.map((appeal, appealIndex) => <div className="print-appeal" key={`${appeal.id}-${appealIndex}`}><h4>{t('Апелляция')} · {label(appeal.status)}</h4><p>{appeal.comment}</p>{appeal.decision && <><p>{t('Исходный ответ')}: <strong>{item.original_answer !== undefined ? answerText(item.original_answer) : t('Не указан')}</strong> · {t('После пересмотра')}: <strong>{answerText(appeal.decision.answer)}</strong></p><p><strong>{t('Решение проверяющего')}: </strong>{appeal.decision.reason}</p></>}</div>)}
        </section>;
      })}
    </> : <p className="print-notice">{t('Оценка ещё не выполнена')}</p>}
    <section className="print-transcript"><h2>{t('Транскрипт')}</h2><p>{t('Оценивается оператор. Бот и система дают контекст.')}</p>{transcript.map((turn, index) => <div className="print-turn" key={index}><h4>{index + 1} · {roles[turn.speaker] || turn.speaker}{turn.timestamp && ` · ${turn.timestamp}`}</h4><p>{turn.text}</p></div>)}</section>
    <footer className="print-footer">Freedom · Conversation Quality Analytics · {record.conversation_id}</footer>
  </article>;
}
