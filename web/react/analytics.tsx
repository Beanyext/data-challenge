import { useEffect, useState } from 'react';
import type { Api, DialogRecord } from './types';
import { translate as t, formatNumber } from './i18n';
import { Icon } from './shared';
import { loadAnalytics, summarizeAnalytics } from '../analytics.mjs';

type AnalyticsData = Awaited<ReturnType<typeof loadAnalytics>>;
interface CriterionSummary {
  id: string; title: string; code: string; gross: boolean; valid: number; na: number; unknown: number;
  losses: number; grossCount: number; averageLoss: number | null; lossRate: number | null; dialogIds: string[];
}
interface Summary { records: number; average: number | null; scored: number; gross: number; criteria: CriterionSummary[] }
export interface AnalyticsWorkspaceProps {
  api: Pick<Api, 'demo' | 'getEvaluation'>; rows: DialogRecord[]; active?: boolean;
  onOpenDialog: (id: string) => void; refreshKey?: number | string;
}
export function AnalyticsWorkspace({ api, rows, active = true, onOpenDialog, refreshKey = 0 }: AnalyticsWorkspaceProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState('');
  const [language, setLanguage] = useState('');
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true); setError(false); setData(null);
    loadAnalytics(rows, (id: string) => api.getEvaluation(id)).then((next: AnalyticsData) => {
      if (!cancelled) { setData(next); setLoading(false); }
    }).catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [api, rows, active, refreshKey, reload]);
  if (!active) return null;
  const key = data?.groups.some((group: { key: string }) => group.key === selected) ? selected : data?.groups[0]?.key || '';
  const summary: Summary | null = data ? summarizeAnalytics(data, key, language) : null;
  const affected = [...new Set(summary?.criteria.flatMap(item => item.dialogIds) || [])];
  const failures = data ? Object.values(data.failures).reduce((sum: number, value) => sum + Number(value), 0) : 0;
  return <div className="analytics-workspace">
    <div className="page-heading"><div><h1>{t('Аналитика')}</h1><p>{t('Последние сохранённые оценки по критериям и языкам.')}</p></div><div className="actions"><button className="btn" disabled={loading} onClick={() => setReload(value => value + 1)}><Icon name="rotate"/>{t('Обновить аналитику')}</button></div></div>
    <p className="stats-caption">{t('Сводка использует финальные ответы с учётом решений по апелляциям. Новая оценка не запускается.')}</p>
    {(api.demo || data?.records.some((record: { educational: boolean }) => record.educational)) && <div className="notice analytics-notice">{t('Учебные результаты. Они не измеряют точность модели и не подходят для сдачи.')}</div>}
    {loading && <p role="status">{t('Загружаем сохранённые оценки…')}</p>}
    {error && <p role="alert" className="notice">{t('Не удалось загрузить аналитику. Повторите обновление.')}</p>}
    {data && <>
      <div className="analytics-coverage" aria-live="polite"><p>{t('Загружено {loaded} из {total} диалогов.', { loaded: data.records.length, total: data.total })}</p><p>{t('Пропущено: без оценки — {new}, в обработке — {pending}, с ошибкой — {error}.', { new: data.skipped.unevaluated, pending: data.skipped.pending, error: data.skipped.error })}</p></div>
      {failures > 0 && <div role="status" className="notice analytics-notice">{t('Не включено: ошибка чтения — {request}, несовпадение ID — {identity}, нет снимка чек-листа — {snapshot}, несовместимые снимки — {conflict}.', data.failures)}</div>}
      {!data.groups.length ? <section className="panel"><div className="empty-state"><Icon name="chart"/><p>{t('Пока нет подходящих сохранённых оценок.')}</p></div></section> : <>
        <div className="analytics-filters"><label>{t('Чек-лист и версия')}<select aria-label={t('Чек-лист и версия')} value={key} onChange={event => setSelected(event.target.value)}>{data.groups.map((group: { key: string; name: string; id: string; version: number }) => <option key={group.key} value={group.key}>{group.name} · {group.id} · v{group.version}</option>)}</select></label><label>{t('Язык диалогов')}<select aria-label={t('Язык диалогов')} value={language} onChange={event => setLanguage(event.target.value)}><option value="">{t('Все языки')}</option>{['RU', 'KZ', 'EN'].map(value => <option key={value} value={value}>{value === 'KZ' ? 'KK / KZ' : value}</option>)}<option value="other">{t('Другой / не указан')}</option></select></label></div>
        <section className="stats-strip" aria-label={t('Аналитика')}><div className="stat"><span className="stat-label">{t('Диалогов в группе')}</span><span className="stat-value">{formatNumber(summary!.records)}</span></div><div className="stat"><span className="stat-label">{t('Средний полный балл')}</span><span className="stat-value">{formatNumber(summary!.average)}</span><span className="stat-label">{t('Полных итогов: {count}', { count: summary!.scored })}</span></div><div className="stat"><span className="stat-label">{t('Диалогов с грубой ошибкой')}</span><span className="stat-value">{formatNumber(summary!.gross)}</span></div></section>
        {!summary!.records ? <p role="status">{t('Без оценок для выбранного языка.')}</p> : <section className="panel"><div className="panel-heading"><h2>{t('Потери по критериям')}</h2></div><p className="analytics-panel-caption">{t('Доля потерь — доля применимых проверенных ответов с потерей баллов. N/A и непроверенные ответы исключены из знаменателя. Грубые ошибки считаются отдельно.')}</p><div className="analytics-table-wrap" tabIndex={0} role="region" aria-label={t('Потери по критериям')}><table className="analytics-table"><thead><tr><th scope="col">{t('Критерий')}</th><th scope="col">{t('Доля потерь / грубых ошибок')}</th><th scope="col">{t('Средняя потеря баллов')}</th><th scope="col">{t('Учтено ответов')}</th><th scope="col">N/A</th><th scope="col">{t('Нет проверенного ответа')}</th></tr></thead><tbody>{summary!.criteria.map(item => <tr key={item.id} data-analytics-criterion={item.id}><th scope="row">{item.title}<span className="analytics-code">{item.code}{item.gross ? ` · ${t('Грубая ошибка')}` : ''}</span></th><td><div className="analytics-rate"><span>{item.lossRate === null ? '—' : `${formatNumber(item.lossRate * 100)}%`} <span className="muted">({item.gross ? item.grossCount : item.losses}/{item.valid})</span></span>{item.lossRate !== null && <span aria-hidden="true" className={`analytics-bar ${item.gross ? 'is-gross' : ''}`}><span style={{ width: `${item.lossRate * 100}%` }}/></span>}</div></td><td>{formatNumber(item.averageLoss)}</td><td>{formatNumber(item.valid)}</td><td>{formatNumber(item.na)}</td><td>{formatNumber(item.unknown)}</td></tr>)}</tbody></table></div>{affected.length > 0 && <details className="analytics-dialogs"><summary>{t('Диалоги с потерями или грубыми ошибками')} · {affected.length}</summary><div className="actions">{affected.map(id => <button key={id} className="btn" onClick={() => onOpenDialog(id)}>{t('Открыть {id}', { id })}</button>)}</div></details>}</section>}
      </>}
    </>}
  </div>;
}
