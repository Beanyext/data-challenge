import { useEffect, useRef, useState, type FormEvent } from 'react';
import { compareEvaluations } from '../evaluation-comparison.mjs';
import { reviewExcerpt } from '../dialog-utils.mjs';
import { translate as t, formatNumber } from './i18n';
import { label } from './shared';
import { reportText } from './report';
import type { Api, CriterionResult, DialogRecord, Evaluation, EvaluationSummary } from './types';

interface Props {
  api: Api; conversationId: string; rows: EvaluationSummary[]; record?: DialogRecord;
  onOpen: (id: string) => void; refreshKey?: number;
  formatDate: (value: string | null | undefined) => {iso: string; text: string} | null;
}
type Comparison = ReturnType<typeof compareEvaluations>;
interface Loaded { api: Api; conversationId: string; beforeId: string; afterId: string; data: Comparison | null; beforeEvaluation?: Evaluation; afterEvaluation?: Evaluation; error: boolean; loading: boolean }
const sameVersion = (a: EvaluationSummary, b: EvaluationSummary) => Boolean(a.checklist_id && a.checklist_id === b.checklist_id
  && Number.isInteger(a.checklist_version) && a.checklist_version === b.checklist_version);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function ResultSide({ item, record, side }: {item: CriterionResult | null; record?: DialogRecord; side: string}) {
  if (!item) return <div className="comparison-side"><h5>{side}</h5><p className="notice">{t('Ответ отсутствует в сохранённой оценке.')}</p></div>;
  const excerpt = reviewExcerpt(record, item, 0);
  const answer = item.answer === 'yes' || item.answer === 'no' || item.answer === 'na' ? label(item.answer)
    : finite(item.answer) ? formatNumber(item.answer) : t('Ответ не получен');
  return <div className="comparison-side">
    <h5>{side}</h5>
    <dl className="comparison-values"><div><dt>{t('Ответ')}</dt><dd>{answer}</dd></div><div><dt>{t('Баллы')}</dt><dd>{formatNumber(item.points === undefined ? item.score : item.points)} / {formatNumber(item.effective_weight)}</dd></div></dl>
    {item.needs_review && <span className="badge badge-amber">{t('Нужна проверка')}</span>}
    <p>{reportText(item.explanation || t('Обоснование не передано.'))}</p>
    {item.na_reason && <p className="small"><strong>{t('Причина N/A')}:</strong> {reportText(item.na_reason)}</p>}
    {(item.review_reason || item.decision?.reason) && <p className="small"><strong>{t('Причина пересмотра')}:</strong> {reportText(item.review_reason || item.decision?.reason)}</p>}
    <details className="comparison-evidence"><summary>{t('Доказательства')}</summary>
      {excerpt.invalidEvidence && <p className="notice">{t('Есть некорректные ссылки на реплики.')}</p>}
      {!excerpt.turns.length && <p className="small muted">{t('Нет доступных реплик по ссылкам оценки.')}</p>}
      {excerpt.turns.map((turn: {index: number; text?: string}) => <blockquote key={turn.index}><strong>{t('Реплика № {n}', {n: turn.index + 1})}</strong><p>{reportText(turn.text)}</p></blockquote>)}
      {(item.evidence || []).filter(proof => proof.quote).map((proof, index) => <p className="small comparison-quote" key={index}><strong>{t('Цитата в оценке')}:</strong> {reportText(proof.quote)}</p>)}
    </details>
  </div>;
}

export function EvaluationComparison({api, conversationId, rows, record, onOpen, refreshKey, formatDate}: Props) {
  const completed = rows.filter(row => row.status === 'done');
  const latest = completed.find(row => completed.some(other => other.id !== row.id && sameVersion(row, other)));
  const previous = latest && completed.findLast(row => row.id !== latest.id && sameVersion(row, latest));
  const [before, setBefore] = useState(''), [after, setAfter] = useState(''), [onlyChanges, setOnlyChanges] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const request = useRef(0);
  const beforeId = completed.some(row => row.id === before) ? before : previous?.id || completed[0]?.id || '';
  const first = completed.find(row => row.id === beforeId);
  const candidates = first ? completed.filter(row => row.id !== beforeId && sameVersion(first, row)) : [];
  const afterId = candidates.some(row => row.id === after) ? after : candidates[0]?.id || '';
  const second = candidates.find(row => row.id === afterId);
  const current = loaded?.api === api && loaded.conversationId === conversationId && loaded.beforeId === beforeId && loaded.afterId === afterId ? loaded : null;
  useEffect(() => {
    request.current++; setLoaded(null);
    return () => {request.current++;};
  }, [api, conversationId, rows, refreshKey]);
  const change = (side: 'before' | 'after', value: string) => {
    request.current++; setLoaded(null);
    if (side === 'before') {setBefore(value); setAfter('');} else setAfter(value);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!first || !second || current?.loading) return;
    const sequence = ++request.current;
    const state = {api, conversationId, beforeId, afterId};
    setLoaded({...state, data: null, error: false, loading: true});
    try {
      const [left, right] = await Promise.all([api.getEvaluation(beforeId), api.getEvaluation(afterId)]);
      const data = compareEvaluations(left, right, {conversationId, beforeId, afterId});
      if (sequence === request.current) setLoaded({...state, data, beforeEvaluation: left, afterEvaluation: right, error: false, loading: false});
    } catch {if (sequence === request.current) setLoaded({...state, data: null, error: true, loading: false});}
  };
  const data = current?.data;
  const errors: Record<string, string> = {
    identity: 'Оценки не относятся к выбранному диалогу или запуску.',
    version: 'Для сравнения выберите одну версию чек-листа.',
    snapshot: 'Снимки правил отсутствуют или различаются. Сравнение недоступно.',
    criteria: 'Сохранённые ответы имеют неоднозначный формат. Сравнение недоступно.',
  };
  const run = (row: EvaluationSummary, evaluation: Evaluation, title: string) => {
    const date = formatDate(row.created_at);
    return <div className="comparison-run"><h4>{title}</h4><strong>{reportText(evaluation.model || row.model || t('Модель не указана'))}</strong>
      <span className="small muted">{date ? <time dateTime={date.iso}>{date.text}</time> : t('Время не указано')}</span>
      <code className="small">{row.id}</code><span>{t('Итог')}: <strong>{formatNumber(evaluation.total)}</strong></span>
      <button type="button" className="btn btn-small" onClick={() => onOpen(row.id)}>{t('Открыть оценку')}</button></div>;
  };
  const visible = data?.rows.filter((row: {changed: boolean}) => !onlyChanges || row.changed) || [];
  const optionLabel = (row: EvaluationSummary) => `${formatDate(row.created_at)?.text || t('Время не указано')} · ${reportText(row.model || t('Модель не указана'))} · v${row.checklist_version} · ${row.id.slice(-8)}`;
  return <section className="evaluation-comparison" aria-labelledby="comparison-heading" data-evaluation-comparison>
    <h3 id="comparison-heading">{t('Сравнение оценок')}</h3>
    <p className="small muted">{t('Сравниваются сохранённые ответы одной версии чек-листа с учётом апелляций. Новая оценка не запускается.')}</p>
    {!latest ? <p role="status">{t('Для сравнения нужны два завершённых запуска одной версии чек-листа.')}</p> : <>
      <form className="comparison-controls" onSubmit={submit}>
        <label>{t('Первый запуск')}<select aria-label={t('Первый запуск')} value={beforeId} onChange={event => change('before', event.target.value)}>{completed.map(row => <option key={row.id} value={row.id}>{optionLabel(row)}</option>)}</select>{first && <span className="comparison-choice small muted">{reportText(first.checklist_id)} · <code>{first.id}</code></span>}</label>
        <label>{t('Второй запуск')}<select aria-label={t('Второй запуск')} value={afterId} disabled={!candidates.length} onChange={event => change('after', event.target.value)}>{!candidates.length && <option value="">{t('Нет второго запуска этой версии')}</option>}{candidates.map(row => <option key={row.id} value={row.id}>{optionLabel(row)}</option>)}</select>{second && <span className="comparison-choice small muted">{reportText(second.checklist_id)} · <code>{second.id}</code></span>}</label>
        <button type="submit" className="btn btn-primary" disabled={!second || current?.loading} aria-busy={current?.loading}>{t(current?.loading ? 'Загрузка сравнения…' : 'Сравнить оценки')}</button>
      </form>
      {(current?.error || data?.error) && <p role="alert" className="notice error">{t(current?.error ? 'Не удалось загрузить сравнение. Нажмите «Сравнить оценки» ещё раз.' : errors[data!.error!] || errors.criteria)}</p>}
      {data && !data.error && first && second && current?.beforeEvaluation && current.afterEvaluation && <div className="comparison-result" aria-live="polite">
        {(api.demo || data.educational) && <p className="notice">{t('Учебное сравнение. Оно не измеряет точность модели.')}</p>}
        <p className="small">{reportText(first.checklist_id)} · v{first.checklist_version} · {t('Время — Алматы.')}</p>
        <div className="comparison-columns">{run(first, current.beforeEvaluation, t('Первый запуск'))}{run(second, current.afterEvaluation, t('Второй запуск'))}</div>
        <div className="comparison-summary"><strong>{t('Изменено критериев: {changed} из {total}.', {changed: data.changedCount, total: data.rows.length})}</strong><span>{t('Разница баллов')}: <strong>{data.totalDelta === null ? '—' : `${data.totalDelta > 0 ? '+' : ''}${formatNumber(data.totalDelta)}`}</strong></span></div>
        {(data.partialBefore || data.partialAfter) && <p className="notice">{t('Есть неполные оценки. Разница итогов не рассчитывается.')}</p>}
        <label className="comparison-filter"><input type="checkbox" checked={onlyChanges} onChange={event => setOnlyChanges(event.target.checked)}/>{t('Только изменения')}</label>
        {!visible.length && <p role="status">{t('Изменений по критериям нет.')}</p>}
        {visible.map((row: {criterion: {id: string; title: string; gross_error?: boolean}; before: CriterionResult | null; after: CriterionResult | null; changed: boolean}) => <article className="comparison-criterion" key={row.criterion.id} data-comparison-criterion={row.criterion.id} data-changed={row.changed}>
          <header><h4>{reportText(row.criterion.title)}</h4><span className={`badge ${row.changed ? 'badge-amber' : ''}`}>{t(row.changed ? 'Изменено' : 'Без изменений')}</span>{row.criterion.gross_error && <span className="badge">{t('Грубая ошибка')}</span>}</header>
          <div className="comparison-columns"><ResultSide side={t('Первый запуск')} item={row.before} record={record}/><ResultSide side={t('Второй запуск')} item={row.after} record={record}/></div>
        </article>)}
      </div>}
    </>}
  </section>;
}
