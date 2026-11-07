import { useEffect, useState } from 'react';
import type { Api, DialogRecord, EvaluationSummary } from './types';
import { formatNumber, getLocale, translate as t } from './i18n';
import { EvaluationComparison } from './comparison';

interface Props {api:Api;conversationId:string;record?:DialogRecord;currentEvaluationId?:string;latestEvaluationId?:string|null;onOpen:(id:string)=>void;refreshKey?:number}
interface HistoryState {api:Api;conversationId:string;loading:boolean;rows:EvaluationSummary[];error:boolean}

function historyDate(value:string|null|undefined) {
  if(!value)return null;
  const normalized=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)?`${value}Z`:value;
  const date=new Date(normalized);
  if(!Number.isFinite(date.getTime()))return null;
  return {iso:date.toISOString(),text:new Intl.DateTimeFormat({ru:'ru-RU',en:'en-GB',kk:'kk-KZ'}[getLocale()],{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(date)};
}

export function EvaluationHistory({api,conversationId,record,currentEvaluationId,latestEvaluationId,onOpen,refreshKey}:Props) {
  const [state,setState]=useState<HistoryState|null>(null),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;
    setState({api,conversationId,loading:Boolean(api.listEvaluations),rows:[],error:false});
    if(api.listEvaluations)void (async()=>{
      try {
        const rows=await api.listEvaluations!(conversationId);
        if(!Array.isArray(rows) || rows.some(row=>!row || typeof row.id!=='string' || !row.id || typeof row.status!=='string') || new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('Invalid history');
        if(active)setState({api,conversationId,loading:false,rows,error:false});
      } catch {if(active)setState({api,conversationId,loading:false,rows:[],error:true});}
    })();
    return()=>{active=false;};
  },[api,conversationId,latestEvaluationId,refreshKey,retry]);
  const current=state?.api===api && state.conversationId===conversationId?state:null;
  const loading=Boolean(api.listEvaluations) && (!current || current.loading);
  return <details className="evaluation-history" data-evaluation-history>
    <summary>{t('История оценок')}{current && !current.loading && !current.error && api.listEvaluations?<span className="muted"> · {formatNumber(current.rows.length)}</span>:null}</summary>
    <div className="history-body" aria-busy={loading}>
      <p className="small muted">{t('Сохранённые запуски. Просмотр не запускает новую оценку. Время — Алматы.')}</p>
      {!api.listEvaluations?<p className="history-message" role="status">{t('История недоступна в этой версии сервера.')}</p>:loading?<p className="history-message" role="status">{t('Загрузка истории оценок…')}</p>:current?.error?<div className="history-message notice error" role="alert"><p>{t('Не удалось загрузить историю оценок.')}</p><button type="button" className="btn btn-small" onClick={()=>setRetry(value=>value+1)}>{t('Повторить загрузку')}</button></div>:!current?.rows.length?<p className="history-message" role="status">{t('Сохранённых оценок пока нет.')}</p>:<ol className="history-list">{current.rows.map(row=>{
        const done=row.status==='done',failed=row.status==='error',date=historyDate(row.created_at),selected=row.id===currentEvaluationId;
        const hasScore=done && typeof row.total==='number' && Number.isFinite(row.total);
        const preliminary=done && (row.complete===false || (row.needs_review_count || 0)>0);
        return <li className={`history-row ${selected?'is-current':''}`} key={row.id} data-history-id={row.id} aria-current={selected?'true':undefined}>
          <div className="history-run"><div className="history-badges"><span className={`badge ${failed?'badge-red':done?'badge-green':'badge-amber'}`}>{t(done?'Оценка завершена':failed?'Ошибка оценки':row.status==='pending'?'Оценка выполняется':'Статус оценки неизвестен')}</span>{selected&&<span className="badge">{t('Просматривается')}</span>}{row.id===latestEvaluationId&&<span className="badge">{t('Последний запуск')}</span>}</div>{date?<time className="small muted" dateTime={date.iso}>{date.text}</time>:<span className="small muted">{t('Время не указано')}</span>}<code className="history-id small muted">{row.id}</code></div>
          <dl className="history-metadata"><div><dt>{t('Модель')}</dt><dd>{row.model || '—'}</dd></div><div><dt>{t('Чек-лист')}</dt><dd>{row.checklist_id || '—'}{typeof row.checklist_version==='number' && Number.isFinite(row.checklist_version)?` · v${row.checklist_version}`:''}</dd></div></dl>
          <div className="history-score"><span className="small muted">{t(preliminary?'Предварительный балл':'Итог')}</span><strong>{hasScore?formatNumber(row.total):'—'}</strong>{done && !hasScore&&<span className="small muted">{t('Нет итогового балла')}</span>}{preliminary&&<span className="badge badge-amber">{t('Нужна проверка')}</span>}{hasScore && typeof row.original_total==='number' && Number.isFinite(row.original_total) && row.original_total!==row.total&&<span className="small muted">{t('До апелляции: {score}',{score:formatNumber(row.original_total)})}</span>}{done && row.gross_error&&<span className="badge badge-red">{t('Грубая ошибка')}</span>}</div>
          <button type="button" className="btn btn-small" disabled={!done || selected} aria-label={t('Открыть оценку {id}',{id:row.id})} onClick={()=>onOpen(row.id)}>{t('Открыть оценку')}</button>
        </li>;
      })}</ol>}
      {current && !current.loading && !current.error && current.rows.length>0 && <EvaluationComparison api={api} conversationId={conversationId} record={record} rows={current.rows} onOpen={onOpen} refreshKey={refreshKey} formatDate={historyDate}/>}
    </div>
  </details>;
}
