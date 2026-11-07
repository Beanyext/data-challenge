import { useEffect } from 'react';
import { evaluationChecklist } from '../dialog-utils.mjs';
import { translate as t, formatNumber, getLocale } from './i18n';
import { Icon } from './shared';
import { stopMotion } from './motion';
import { evaluationWasReviewed, incompleteEvaluation } from './evaluation-state';
import type { Appeal, Checklist, Criterion, CriterionResult, DialogRecord, Evaluation, Turn } from './types';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const objects = <T,>(value: unknown): T[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Report text is still untrusted data; never print credential-bearing links. */
export function reportText(value: unknown): string {
  return String(value ?? '').replace(/https?:\/\/[^\s<>"'«»]+/gi, url => {
    try {
      const parsed = new URL(url);
      return parsed.username || parsed.password || [...parsed.searchParams.keys()].some(key => /^(?:sig|signature|token|access_token|api[_-]?key|key|authorization|password|x-amz-.+|x-goog-signature|se)$/i.test(key)) ? t('[ссылка с данными доступа скрыта]') : url;
    } catch { return t('[ссылка с данными доступа скрыта]'); }
  }).replace(/((["']?)(\b[A-Za-z0-9_-]*(?:sig|signature|token|api[_-]?key|authorization|password|secret))\2\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi,
    (_whole:string,prefix:string)=>prefix+t('[данные доступа скрыты]')
  ).replace(/\bBearer\s+[^\s,;]+/gi, t('[данные доступа скрыты]')).replace(/\bsk[-_][A-Za-z0-9._-]{12,}/g, t('[данные доступа скрыты]'));
}
function valueNumber(value: unknown) { return finite(value) ? formatNumber(value) : t('Не передано'); }
function answer(value: unknown): string {
  if (value === 'yes') return t('Да');
  if (value === 'no') return t('Нет');
  if (value === 'na') return 'N/A';
  return finite(value) ? formatNumber(value) : t('Ответ не получен');
}
function time(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return t('Не указано');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t('Не указано');
  return new Intl.DateTimeFormat({ ru: 'ru-RU', en: 'en-US', kk: 'kk-KZ' }[getLocale()], { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Almaty' }).format(date);
}
function validTurn(index: unknown, transcript: Turn[]): index is number {
  return Number.isInteger(index) && Number(index) >= 0 && Number(index) < transcript.length && Boolean(transcript[Number(index)] && typeof transcript[Number(index)] === 'object');
}
function Score({ value }: { value: unknown }) {
  return value === null ? <>{t('Не рассчитан')}</> : finite(value) ? <>{formatNumber(value)} <span>/ 100</span></> : <>{t('Не передано')}</>;
}
function TranscriptList({ transcript, indices = transcript.map((_, index) => index) }: { transcript: Turn[]; indices?: number[] }) {
  const roles: Record<string, string> = { operator: t('Оператор'), client: t('Клиент'), bot: t('Бот'), system: t('Система') };
  return <ol className="report-turns">{indices.filter(index => validTurn(index, transcript)).map(index => {
    const turn = transcript[index];
    return <li key={index}><div className="report-turn-label">{t('Реплика {index} · {role} · {time}', { index: index + 1, role: reportText(roles[turn.speaker] || turn.speaker || t('Роль не указана')), time: reportText(turn.timestamp || t('Время не указано')) })}</div><p>{reportText(turn.text)}</p></li>;
  })}</ol>;
}
function Evidence({ item, transcript }: { item: CriterionResult; transcript: Turn[] }) {
  const evidence = objects<{ turn: unknown; quote?: unknown }>(item.evidence), range = item.checked_range;
  const indices = new Set<number>(); let invalid = false;
  for (const entry of evidence) {
    if (validTurn(entry.turn, transcript)) for (let index = Math.max(0, entry.turn - 1); index <= Math.min(transcript.length - 1, entry.turn + 1); index++) { if (validTurn(index, transcript)) indices.add(index); }
    else invalid = true;
  }
  const rangeValid = Boolean(range && validTurn(range.from, transcript) && validTurn(range.to, transcript) && range.to >= range.from);
  if (range) {
    if (rangeValid) {
      if (range.to - range.from <= 5) for (let index = range.from; index <= range.to; index++) { if (validTurn(index, transcript)) indices.add(index); else invalid = true; }
      else for (const index of [range.from, range.from + 1, range.to - 1, range.to]) { if (validTurn(index, transcript)) indices.add(index); }
    } else invalid = true;
  }
  if (!evidence.length && !range) return item.answer === 'na' ? null : <p className="report-muted">{t('Доказательства в результате не переданы.')}</p>;
  return <div className="report-evidence"><h4>{t('Доказательства и контекст')}</h4>{evidence.map((entry, index) => <div className="report-quote" key={index}><p className="report-evidence-label">{validTurn(entry.turn, transcript) ? t('Реплика {index} · {time}', { index: entry.turn + 1, time: reportText(transcript[entry.turn].timestamp || t('Время не указано')) }) : t('Ссылка на реплику недействительна')}</p><blockquote>{entry.quote ? `«${reportText(entry.quote)}»` : t('Цитата не передана')}</blockquote></div>)}
    {rangeValid && range && <><p className="report-evidence-label">{t('Проверенный участок: реплики {from}–{to}.', { from: range.from + 1, to: range.to + 1 })}</p>{range.to - range.from > 5 && <p className="report-muted">{t('Показаны начало и конец проверенного участка.')}</p>}</>}
    {invalid && <p className="report-warning">{t('В результате есть некорректная ссылка или диапазон. Требуется проверка.')}</p>}
    {indices.size > 0 && <TranscriptList transcript={transcript} indices={[...indices].sort((a, b) => a - b)}/>}
  </div>;
}
function CriterionReport({ item, criterion, index, transcript, originals }: { item: CriterionResult; criterion?: Criterion; index: number; transcript: Turn[]; originals: CriterionResult[] }) {
  const gross = criterion?.gross_error === true || (item as CriterionResult & { gross_error?: boolean }).gross_error === true;
  const original = originals.find(value => value.criterion_id === item.criterion_id);
  const originalAnswer = own(item, 'original_answer') ? item.original_answer : original?.answer;
  const base = finite(item.weight) ? item.weight : criterion?.weight;
  const points = finite(item.points) ? item.points : finite(item.weighted_score) ? item.weighted_score : item.score;
  return <article className="report-criterion"><header className="report-criterion-heading"><div><p className="report-kicker">{t('Критерий {index} · {id}', { index: index + 1, id: reportText(item.criterion_id || t('ID не указан')) })}</p><h3>{reportText(criterion?.title || item.criterion_id || t('Название не передано'))}</h3></div><strong className="report-answer">{answer(item.answer)}</strong></header>
    <dl className="report-criterion-metrics">{gross ? <div><dt>{t('Тип критерия')}</dt><dd>{t('Грубое нарушение, без баллов')}</dd></div> : <><div><dt>{t('Баллы')}</dt><dd>{item.answer === 'na' ? t('Не применяется') : valueNumber(points)}</dd></div><div><dt>{t('Базовый вес')}</dt><dd>{valueNumber(base)}</dd></div><div><dt>{t('Действующий вес')}</dt><dd>{item.answer === 'na' ? t('Исключён') : valueNumber(item.effective_weight)}</dd></div></>}{originalAnswer !== undefined && <div><dt>{t('Исходный ответ')}</dt><dd>{answer(originalAnswer)}</dd></div>}</dl>
    {criterion?.description && <p className="report-rule"><strong>{t('Правило')}:</strong> {reportText(criterion.description)}</p>}<p>{reportText(item.explanation || t('Обоснование не передано.'))}</p>
    {item.answer === 'na' && <p className="report-na"><strong>{t('Причина N/A')}:</strong> {reportText(item.na_reason || t('Причина не передана; требуется проверка.'))}</p>}{item.needs_review && <p className="report-warning">{t('Нужна проверка человеком.')}</p>}{own(item, 'review_reason') && <p className="report-decision"><strong>{t('Причина пересмотра')}:</strong> {reportText(item.review_reason)}</p>}<Evidence item={item} transcript={transcript}/>
  </article>;
}
function AppealReport({ appeal, criteria }: { appeal: Appeal; criteria: Criterion[] }) {
  const criterion = criteria.find(value => value.id === appeal.criterion_id);
  const status = { open: 'Открыта', confirmed: 'Оценка подтверждена', changed: 'Оценка изменена' }[appeal.status] || 'Статус не передан';
  return <article className="report-appeal"><header><h3>{reportText(criterion?.title || appeal.criterion_id || t('Критерий не указан'))}</h3><p className="report-muted">{t(status)}</p></header><p><strong>{t('Комментарий')}:</strong> {reportText(appeal.comment || t('Не передан'))}</p>{appeal.decision && typeof appeal.decision === 'object' ? <><dl className="report-criterion-metrics"><div><dt>{t('Ответ проверяющего')}</dt><dd>{answer(appeal.decision.answer)}</dd></div><div><dt>{t('Время решения')}</dt><dd>{time(appeal.decision.decided_at)}</dd></div></dl><p><strong>{t('Причина решения')}:</strong> {reportText(appeal.decision.reason || t('Не передана'))}</p></> : <p className="report-muted">{t('Решение ещё не принято.')}</p>}</article>;
}

export function ReportView({ dialog, evaluation, checklist, appeals, demo, onBack }: { dialog: DialogRecord; evaluation: Evaluation | null; checklist: Checklist | null; appeals: Appeal[]; demo: boolean; onBack: () => void }) {
  useEffect(() => { window.addEventListener('beforeprint', stopMotion); return () => window.removeEventListener('beforeprint', stopMotion); }, []);
  const snapshot = evaluationChecklist(evaluation, checklist ? [checklist] : []) as Checklist | null;
  const incomplete = incompleteEvaluation(evaluation, snapshot);
  const transcript = Array.isArray(dialog.transcript) ? dialog.transcript : [];
  const definitions = objects<Criterion>(snapshot?.criteria), results = objects<CriterionResult>(evaluation?.criteria), originals = objects<CriterionResult>(evaluation?.original_criteria), sections = objects<{ id: string; name?: string; score?: number | null }>(evaluation?.sections), snapshotSections = objects<{ id: string; name?: string }>(snapshot?.sections);
  const matchingAppeals = evaluation?.id != null ? objects<Appeal>(appeals).filter(appeal => appeal.evaluation_id === evaluation.id) : [];
  const reviewed = evaluation ? evaluationWasReviewed(evaluation, matchingAppeals) : false;
  const demonstration = demo || evaluation?.demo === true || ['mock', 'demo'].includes(String(evaluation?.provider).toLowerCase()) || evaluation?.model === 'mock';
  return <><div className="print-toolbar"><button className="btn btn-ghost" onClick={onBack}><Icon name="arrow-left"/>{t('Вернуться к диалогу')}</button><button className="btn btn-primary" data-action="print-report" onClick={() => { stopMotion(); window.print(); }}><Icon name="download"/>{t('Печать / PDF')}</button></div><section className="quality-report" aria-label={t('Отчёт о качестве диалога')}>
    <header className="report-header"><div className="report-brand-row"><img className="report-logo" src="./assets/freedom-logo-print.svg" width="168" height="40" alt="Freedom"/><p className="report-brand">{t('CQA · Контроль качества')}</p></div><h1>{t('Отчёт о качестве диалога')}</h1><p className="report-subtitle">{reportText(dialog.title || dialog.subject || dialog.conversation_id || t('Диалог не указан'))}</p></header>
    {demonstration && <p className="report-demo"><strong>{t('Учебный отчёт.')}</strong> {t(demo?'Вымышленные данные и оценки. Модель не вызывается; результаты не отражают точность AI.':'Оценки получены в тестовом режиме. Модель не вызывалась; результаты не отражают точность AI.')}</p>}
    <dl className="report-metadata"><div><dt>{t('Диалог')}</dt><dd>{reportText(dialog.conversation_id || evaluation?.conversation_id || t('Не указан'))}</dd></div><div><dt>{t('Канал')}</dt><dd>{t(dialog.channel === 'voice call' ? 'Звонок' : dialog.channel === 'agent chat' ? 'Чат' : 'Не указан')}</dd></div><div><dt>{t('Язык')}</dt><dd>{reportText(dialog.language || t('Не указан'))}</dd></div><div><dt>{t('Чек-лист')}</dt><dd>{reportText(snapshot?.name || evaluation?.checklist_id || t('Не указан'))} · {t('версия')} {reportText(evaluation?.checklist_version ?? t('Не указана'))}</dd></div><div><dt>{t('Модель')}</dt><dd>{reportText(evaluation?.model || t('Не указана'))}</dd></div><div><dt>{t('Время оценки, Алматы')}</dt><dd>{time(evaluation?.evaluated_at)}</dd></div></dl>
    {dialog.channel === 'voice call' && <p className="report-muted report-audio-note">{t('Запись доступна в карточке диалога.')}</p>}
    {!evaluation ? <p className="report-warning">{t('Оценка ещё не выполнена. Баллы и обоснования не сформированы.')}</p> : <>{incomplete && <p className="report-warning">{t('Оценка неполная: есть критерии без ответа. Проверьте диалог или повторите оценку.')}</p>}<section className="report-summary" aria-label={t('Итог оценки')}><div><h2>{t(incomplete ? 'Предварительный балл' : 'Итоговый балл')}</h2><p className="report-total"><Score value={evaluation.total}/></p></div><div><h2>{t('Исходный балл')}</h2><p className="report-original">{evaluation.original_total == null && !reviewed ? t('Пересмотр не проводился') : <Score value={evaluation.original_total}/>}</p></div><div><h2>{t('Грубые ошибки')}</h2><p>{t(evaluation.gross_error === true ? 'Обнаружены' : evaluation.gross_error === false ? 'Не обнаружены' : 'Сведения не переданы')}</p><p className="report-muted">{t('Отметка отдельно от итогового балла.')}</p></div></section>
      {results.some(item => item.needs_review) && <p className="report-warning">{t('В оценке есть ответы, требующие проверки человеком.')}</p>}{!snapshot && <p className="report-warning">{t('Снимок использованной версии чек-листа недоступен. Названия и правила другой версии не подставлялись.')}</p>}
      {sections.length > 0 && <section className="report-section"><h2>{t('Баллы по разделам')}</h2><dl className="report-section-scores">{sections.map((section, index) => <div key={`${section.id}-${index}`}><dt>{reportText(section.name || snapshotSections.find(value => value.id === section.id)?.name || section.id || t('Раздел'))}</dt><dd>{valueNumber(section.score)}</dd></div>)}</dl></section>}
      <section className="report-section"><h2>{t('Оценка по критериям')}</h2>{results.length ? results.map((item, index) => <CriterionReport key={`${item.criterion_id}-${index}`} item={item} criterion={definitions.find(value => value.id === item.criterion_id)} index={index} transcript={transcript} originals={originals}/>) : <p className="report-muted">{t('Ответы по критериям не переданы.')}</p>}</section>
      <section className="report-section"><h2>{t('Апелляции и решения')}</h2>{matchingAppeals.length ? matchingAppeals.map((appeal, index) => <AppealReport key={`${appeal.id}-${index}`} appeal={appeal} criteria={definitions}/>) : <p className="report-muted">{t('Для этой оценки апелляции отсутствуют.')}</p>}</section>
    </>}
    {transcript.length > 0 && <>
      <details className="report-section report-full-transcript-screen"><summary>{t('Полный транскрипт')} · {t('{count} реплик', { count: transcript.length })}</summary><TranscriptList transcript={transcript}/></details>
      <section className="report-section report-full-transcript-print" aria-label={t('Полный транскрипт')}><h2>{t('Полный транскрипт')}</h2><TranscriptList transcript={transcript}/></section>
    </>}
    <footer className="report-footer">{t('CQA · Прототип команды. Отчёт по сохранённым результатам; пересчёт AI-оценки при печати не выполняется.')}</footer>
  </section></>;
}
