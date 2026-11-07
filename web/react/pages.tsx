import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Api, Appeal, AudioData, Checklist, DialogRecord, Evaluation, Filters, ListState, Notify } from './types';
import { Icon, EmptyState, channel, label, number } from './shared';
import { EvaluationView } from './result';
import { ActiveFilters, DensitySwitch, readDensity, SelectionSummary } from './list-tools';
import { translate as t } from './i18n';
import { audioUrl, errorText } from './runtime';
import { attentionReasons, filterDialogs, hasEvaluation, summarizeDialogs } from '../dialog-utils.mjs';
import { ReviewSummary } from './review-tools';

export function StatusBadge({ record }: { record: DialogRecord }) {
  const status=record.status || (hasEvaluation(record)?'completed':'pending');
  return <span className={`badge ${['completed','done','evaluated'].includes(status)?'badge-green':status==='failed'?'badge-red':''}`}><span className="mini-dot" aria-hidden="true"/>{label(status)}</span>;
}
function AttentionBadges({ record, appeals }: { record:DialogRecord; appeals:Appeal[] }) {
  const names:Record<string,string>={gross:'Грубая ошибка',review:'Нужна проверка',appeal:'Открытая апелляция'};
  return <>{(attentionReasons(record,appeals) as string[]).map(reason=><span key={reason} className={`badge ${reason==='gross'?'badge-red':'badge-amber'}`}>{reason==='gross'&&<Icon name="alert"/>}{t(names[reason])}</span>)}</>;
}
export function DialogRows({ rows, selected, appeals=[], onSelect, onOpen }: { rows:DialogRecord[]; selected:Set<string>; appeals?:Appeal[]; onSelect:(id:string,checked:boolean)=>void; onOpen:(id:string)=>void }) {
  return <>{rows.map(record=><tr key={record.conversation_id} className={selected.has(record.conversation_id)?'selected':''}>
    <td><input type="checkbox" data-select={record.conversation_id} aria-label={t('Выбрать {id}',{id:record.conversation_id})} checked={selected.has(record.conversation_id)} onChange={event=>onSelect(record.conversation_id,event.target.checked)}/></td>
    <td><button className="dialog-title" data-open={record.conversation_id} onClick={()=>onOpen(record.conversation_id)}>{record.title || record.subject || record.transcript?.find(turn=>turn.speaker==='client')?.text || t('Диалог поддержки')}</button><span className="dialog-subtitle">{record.conversation_id}</span></td>
    <td><span className="channel-icon" aria-hidden="true"><Icon name={record.channel==='voice call'?'phone':'dialogs'}/></span>{channel(record.channel)}</td>
    <td><span className="badge">{record.language}</span></td><td><div className="row-statuses"><StatusBadge record={record}/><AttentionBadges record={record} appeals={appeals}/></div></td>
    <td className="score-cell">{number(record.total)} {Number.isFinite(record.total)&&<span>/ 100</span>}</td>
    <td><button className="icon-btn" data-open={record.conversation_id} aria-label={t('Открыть {id}',{id:record.conversation_id})} onClick={()=>onOpen(record.conversation_id)}><Icon name="chevron"/></button></td>
  </tr>)}</>;
}

export interface DialogsWorkspaceProps {
  rows:DialogRecord[]; appeals:Appeal[]; state:ListState; onState:(next:ListState)=>void; busy:boolean;
  onEvaluate:(ids:string[])=>void; onOpenDialog:(id:string)=>void; onImport:()=>void; onUpload:()=>void; onSubmission:()=>void;
}
export function DialogsWorkspace({ rows, appeals, state, onState, busy, onEvaluate, onOpenDialog, onImport, onUpload, onSubmission }: DialogsWorkspaceProps) {
  const [density,setDensity]=useState(readDensity);
  const selectAll=useRef<HTMLInputElement>(null);
  const visible=filterDialogs(rows,{...state.filters,queue:state.queue},appeals) as DialogRecord[];
  const summary=summarizeDialogs(state.summaryScope==='all'?rows:visible,appeals);
  const attention=rows.filter(row=>(attentionReasons(row,appeals) as string[]).length>0).length;
  const visibleIds=new Set(visible.map(row=>row.conversation_id));
  const hiddenSelected=[...state.selected].filter(id=>!visibleIds.has(id)).length;
  const checked=visible.length>0&&visible.every(row=>state.selected.has(row.conversation_id));
  useEffect(()=>{if(selectAll.current)selectAll.current.indeterminate=!checked&&visible.some(row=>state.selected.has(row.conversation_id));},[checked,visible,state.selected]);
  const setFilter=(key:keyof Filters,value:string)=>onState({...state,filters:{...state.filters,[key]:value}});
  const resetFilters=()=>onState({...state,queue:'all',filters:{query:'',channel:'',language:'',status:''}});
  const select=(id:string,selected:boolean)=>{const next=new Set(state.selected);if(selected)next.add(id);else next.delete(id);onState({...state,selected:next});};
  const selectVisible=(selected:boolean)=>{const next=new Set(state.selected);visible.forEach(row=>selected?next.add(row.conversation_id):next.delete(row.conversation_id));onState({...state,selected:next});};
  const stats=[{title:'Диалогов в выборке',value:summary.total,tone:''},{title:'С оценкой',value:summary.evaluated,tone:'green'},{title:'Средний балл',value:summary.average,tone:''},{title:'Грубые ошибки',value:summary.gross,tone:summary.gross?'red':''}];
  return <div className="dialogs-workspace">
    <div className="page-heading" data-reveal><div><h1>{t('Диалоги')}</h1><p>{t('Проверяйте качество работы операторов и обоснования оценок.')}</p></div><div className="actions"><button className="btn" onClick={onSubmission}><Icon name="download"/>{t('Выгрузить для сдачи')}</button><button className="btn" data-action="import" onClick={onImport}><Icon name="download"/>{t('Импорт набора')}</button><button className="btn" data-action="upload" onClick={onUpload}><Icon name="upload"/>{t('Загрузить JSON')}</button></div></div>
    <div className="summary-toolbar"><p id="summary-caption" className="stats-caption">{state.summaryScope==='all'?t('Сводка по всему набору, независимо от фильтров.'):t('Сводка по текущей выборке: {visible} из {total} диалогов. Учитываются очередь и все фильтры.',{visible:visible.length,total:rows.length})}</p><label>{t('Охват сводки')}<select id="summary-scope" value={state.summaryScope} onChange={event=>onState({...state,summaryScope:event.target.value as ListState['summaryScope']})}><option value="filtered">{t('Текущая выборка')}</option><option value="all">{t('Весь набор')}</option></select></label></div>
    <section id="dialog-summary" className="stats-strip" aria-label={t(state.summaryScope==='all'?'Сводка по всему набору':'Сводка по текущей выборке')}>{stats.map(stat=><div className="stat" key={stat.title}><span className="stat-label">{t(stat.title)}</span><span className={`stat-value ${stat.tone}`}>{number(stat.value)}</span></div>)}</section>
    <div className="view-tabs queue-tabs" role="group" aria-label={t('Очередь диалогов')}><button className={`btn ${state.queue==='all'?'btn-dark':''}`} data-queue="all" aria-pressed={state.queue==='all'} onClick={()=>onState({...state,queue:'all'})}>{t('Все диалоги')} · {rows.length}</button><button className={`btn ${state.queue==='attention'?'btn-dark':''}`} data-queue="attention" aria-pressed={state.queue==='attention'} onClick={()=>onState({...state,queue:'attention'})}>{t('Требует внимания')} · {attention}</button></div>
    {appeals.some(appeal=>appeal.status==='open'&&appeal.context_unavailable)&&<div className="notice queue-notice">{t('У части апелляций не удалось получить связанный диалог. Они остаются в разделе «Апелляции».')}</div>}
    <section className="panel dialog-list" data-density={density} data-reveal><div className="panel-heading"><h2>{t(state.queue==='attention'?'Очередь проверки':'Все разговоры')} <span id="list-heading-count" className="muted small">{t('{visible} из {total}',{visible:visible.length,total:rows.length})}</span></h2><DensitySwitch value={density} onChange={setDensity}/></div>
      <div className="filters"><label className="search-field"><span className="filter-label">{t('Поиск диалога')}</span><span className="search-input"><span aria-hidden="true"><Icon name="search"/></span><input id="search-dialogs" type="search" placeholder={t('Найти по ID или содержимому')} value={state.filters.query} onChange={event=>setFilter('query',event.target.value)}/></span></label>
        <label><span className="filter-label">{t('Канал')}</span><select data-filter="channel" value={state.filters.channel} onChange={event=>setFilter('channel',event.target.value)}><option value="">{t('Все каналы')}</option><option value="agent chat">{t('Чаты')}</option><option value="voice call">{t('Звонки')}</option></select></label>
        <label><span className="filter-label">{t('Язык')}</span><select data-filter="language" value={state.filters.language} onChange={event=>setFilter('language',event.target.value)}><option value="">{t('Все языки')}</option><option value="RU">{t('Русский')}</option><option value="KZ">{t('Қазақша')}</option><option value="EN">{t('English')}</option></select></label>
        <label><span className="filter-label">{t('Статус оценки')}</span><select data-filter="status" value={state.filters.status} onChange={event=>setFilter('status',event.target.value)}><option value="">{t('Все статусы')}</option><option value="completed">{t('С оценкой')}</option><option value="pending">{t('Без оценки')}</option><option value="gross">{t('Грубая ошибка')}</option><option value="review">{t('Нужна проверка')}</option><option value="appeal">{t('Открытая апелляция')}</option></select></label>
      </div><ActiveFilters filters={state.filters} onRemove={key=>setFilter(key,'')} onReset={resetFilters}/>
      <div className="list-toolbar"><SelectionSummary count={state.selected.size} onClear={()=>onState({...state,selected:new Set()})}/><button id="evaluate-selected" className="btn btn-primary" data-action="evaluate-selected" disabled={busy||!state.selected.size} onClick={()=>{if(!busy&&state.selected.size)onEvaluate([...state.selected]);}}>{state.selected.size?t('Оценить выбранные ({count})',{count:state.selected.size}):t('Оценить выбранные')} <Icon name="arrow-right"/></button></div>
      <div className="table-scroll" role="region" aria-label={t('Список диалогов')} tabIndex={0}><table><thead><tr><th data-select-label={t('Выбрать все диалоги')}><input ref={selectAll} id="select-all" type="checkbox" aria-label={t('Выбрать все видимые диалоги')} checked={checked} onChange={event=>selectVisible(event.target.checked)}/></th><th>{t('Диалог')}</th><th>{t('Канал')}</th><th>{t('Язык')}</th><th>{t('Статус')}</th><th>{t('Балл')}</th><th><span className="sr-only">{t('Открыть')}</span></th></tr></thead><tbody id="dialog-rows"><DialogRows rows={visible} selected={state.selected} appeals={appeals} onSelect={select} onOpen={onOpenDialog}/></tbody></table></div>
      <div id="list-empty" hidden={visible.length>0}>{rows.length?<EmptyState title={t('Ничего не найдено')} text={t('Измените запрос, очередь или сбросьте фильтры.')} actions={<button className="btn" data-action="reset-filters" onClick={resetFilters}>{t('Сбросить фильтры')}</button>}/>:<EmptyState title={t('Добавьте первый диалог')} text={t('Импортируйте набор по group_id или загрузите транскрипт в JSON.')} actions={<><button className="btn btn-primary" data-action="import" onClick={onImport}>{t('Импорт набора')}</button><button className="btn" data-action="upload" onClick={onUpload}>{t('Загрузить JSON')}</button></>}/>}</div>
      <div className="table-foot"><span id="visible-count" aria-live="polite">{t('Показано {visible} из {total}',{visible:visible.length,total:rows.length})}{hiddenSelected>0?` · ${t('Выбрано вне фильтра: {count}',{count:hiddenSelected})}`:''}</span><span>{t(state.queue==='attention'?'Приоритет: грубые ошибки, проверка, апелляции':'Оценка по выбранному чек-листу')}</span></div>
    </section>
  </div>;
}

export interface DialogWorkspaceProps {
  record:DialogRecord; evaluation:Evaluation|null; checklist:Checklist|null; checklists:Checklist[]; appeals:Appeal[]; api:Api; demo:boolean; busy:boolean;
  onEvaluate:(ids:string[],checklistId?:string)=>void; onAppeal:(criterionId:string)=>void; onReport:()=>void; notify:Notify;
}
export function DialogWorkspace({record,evaluation,checklist,checklists,appeals,api,demo,busy,onEvaluate,onAppeal,onReport,notify}:DialogWorkspaceProps) {
  const [selectedChecklist,setSelectedChecklist]=useState(evaluation?.checklist_id || checklists[0]?.id || '');
  const [audio,setAudio]=useState<AudioData|null>(null),[audioLoading,setAudioLoading]=useState(false),[audioError,setAudioError]=useState('');
  const [highlight,setHighlight]=useState<{from:number;to:number}|null>(null);
  const [evidenceCriterion,setEvidenceCriterion]=useState<string|null>(null);
  const audioRef=useRef<HTMLAudioElement>(null),transcriptRef=useRef<HTMLDivElement>(null),pendingSeek=useRef<number|null>(null),revision=useRef(0),inFlight=useRef<Promise<AudioData|undefined>|null>(null);
  const transcript=Array.isArray(record.transcript)?record.transcript:[];
  const roles:Record<string,string>={operator:t('Оператор'),client:t('Клиент'),bot:t('Бот'),system:t('Система')};
  useEffect(()=>{revision.current++;setAudio(null);setAudioError('');setAudioLoading(false);setHighlight(null);setEvidenceCriterion(null);setSelectedChecklist(evaluation?.checklist_id && checklists.some(item=>item.id===evaluation.checklist_id)?evaluation.checklist_id:checklists[0]?.id || '');pendingSeek.current=null;inFlight.current=null;return()=>{revision.current++;};},[record.conversation_id,api]);
  useEffect(()=>{if(!checklists.some(item=>item.id===selectedChecklist))setSelectedChecklist(evaluation?.checklist_id && checklists.some(item=>item.id===evaluation.checklist_id)?evaluation.checklist_id:checklists[0]?.id || '');},[checklists,evaluation?.checklist_id,selectedChecklist]);
  useEffect(()=>{if(!highlight)return;const target=transcriptRef.current?.querySelector<HTMLElement>(`#turn-${highlight.from}`);target?.focus({preventScroll:true});target?.scrollIntoView?.({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});},[highlight]);
  function applySeek() {if(audioRef.current&&pendingSeek.current!==null){try{audioRef.current.currentTime=pendingSeek.current;}catch{/* Retry when metadata is available. */}}}
  useEffect(applySeek,[audio]);
  async function loadAudio(refresh=false):Promise<AudioData|undefined> {
    if(!refresh&&audio)return audio;
    if(inFlight.current)return inFlight.current;
    const token=revision.current;setAudioLoading(true);setAudioError('');
    const request=Promise.resolve().then(async()=>{try{const result=await api.getAudio(record.conversation_id);const url=audioUrl(result,demo);if(token!==revision.current)return;const next={...result,url};setAudio(next);return next;}catch(error){if(token===revision.current)setAudioError(errorText(error));return undefined;}finally{if(token===revision.current){setAudioLoading(false);inFlight.current=null;}}});
    inFlight.current=request;return request;
  }
  async function showTurn(from:number,to=from) {
    if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<from||to>=transcript.length){notify(t('Некорректная ссылка на реплику.'),true);return;}
    setHighlight({from,to});
    if(record.channel==='voice call') {
      const token=revision.current;const result=await loadAudio();if(token!==revision.current)return;
      const offset=result?.turn_offsets?.[String(from)];
      if(typeof offset==='number'&&Number.isFinite(offset)){pendingSeek.current=Math.max(0,offset-3);applySeek();}
      else if(result)notify(t('Для этой реплики сервер не передал позицию в записи.'));
    }
  }
  function onResultClick(event:MouseEvent<HTMLElement>) {
    const button=(event.target as Element).closest<HTMLButtonElement>('button');if(!button||button.disabled)return;
    if(button.dataset.appeal!==undefined){onAppeal(button.dataset.appeal);return;}
    if(button.dataset.turn!==undefined){const start=button.dataset.turn,end=button.dataset.rangeEnd;if(!/^\d+$/.test(start)||end!==undefined&&!/^\d+$/.test(end)){notify(t('Некорректная ссылка на реплику.'),true);return;}setEvidenceCriterion(button.closest('.result-criterion')?.id.slice('criterion-'.length) || null);void showTurn(Number(start),end===undefined?Number(start):Number(end));}
  }
  return <div className="dialog-workspace">
    <a href="#dialogs" className="back-link"><Icon name="arrow-left"/>{t('Все диалоги')}</a>
    <div className="detail-heading" data-reveal><div><h1>{record.title || t('Карточка диалога')}</h1><div className="detail-meta"><span className="muted small mono">{record.conversation_id}</span><span className="badge">{channel(record.channel)}</span><span className="badge">{record.language}</span><StatusBadge record={{...record,evaluation_id:evaluation?.id,total:evaluation?.total}}/></div></div><div className="detail-actions">{evaluation&&<a className="btn" href={`#report/${encodeURIComponent(record.conversation_id)}`} onClick={event=>{event.preventDefault();onReport();}}><Icon name="download"/>{t('Отчёт')}</a>}<label><span className="sr-only">{t('Чек-лист для оценки')}</span><select id="evaluation-checklist" value={selectedChecklist} onChange={event=>setSelectedChecklist(event.target.value)}>{checklists.map(item=><option key={`${item.id}@${item.version}`} value={item.id}>{item.name} · v{item.version}</option>)}</select></label><button className="btn btn-primary" data-action="evaluate-dialog" disabled={busy||!selectedChecklist} onClick={()=>{if(!busy&&selectedChecklist)onEvaluate([record.conversation_id],selectedChecklist);}}>{t(evaluation?'Оценить заново':'Оценить диалог')}<Icon name="arrow-right"/></button></div></div>
    {evaluation&&<ReviewSummary evaluation={evaluation} checklist={checklist} onBackToMap={()=>{setHighlight(null);setEvidenceCriterion(null);}}/>}
    <div className="split-view detail-top"><section className="panel" data-reveal><div className="panel-heading"><h2>{t('Транскрипт')}</h2><span className="muted small">{t('{count} реплик',{count:transcript.length})}</span></div>
      {record.channel==='voice call'&&<div className="audio-block" id="audio-block">{audio?<><label className="small">{t(demo?'Учебный звуковой сигнал, не запись разговора':'Запись разговора')}</label><audio ref={audioRef} id="call-audio" controls preload="metadata" src={audio.url} onLoadedMetadata={applySeek}/><p className="audio-caption">{t('Кнопка доказательства перематывает запись. Автовоспроизведение отключено.')}</p><button className="text-btn" data-action="refresh-audio" disabled={audioLoading} onClick={()=>{pendingSeek.current=null;void loadAudio(true);}}>{t('Обновить ссылку')}</button></>:<><button className="btn btn-small" data-action="audio" disabled={audioLoading} onClick={()=>void loadAudio()}>{t(audioLoading?'Получаем свежую ссылку на запись…':'Загрузить запись')}</button><p className="audio-caption">{t('Запись загружается по свежей ссылке.')}</p></>}{audioError&&<p className="danger small" role="alert">{t(audioError)}</p>}</div>}
      <div className="quiet-line">{t('Оценивается оператор. Бот и система дают контекст.')}</div><div className="transcript" id="transcript" ref={transcriptRef}>{transcript.length?transcript.map((turn,index)=><article id={`turn-${index}`} key={index} className={`turn turn-${Object.hasOwn(roles,turn.speaker)?turn.speaker:'system'} ${highlight&&index>=highlight.from&&index<=highlight.to?'highlight':''}`} tabIndex={-1}><div className="turn-meta"><strong>{roles[turn.speaker] || turn.speaker}</strong><span>№ {index+1}{turn.timestamp?` · ${turn.timestamp}`:''}</span>{highlight&&index>=highlight.from&&index<=highlight.to&&<span className="turn-evidence-label">{t('Доказательство')}</span>}</div><p>{turn.text}</p></article>):<p className="muted small">{t('Транскрипт не содержит реплик.')}</p>}</div>
    </section><section className="panel" id="evaluation-panel" data-reveal onClick={onResultClick}><EvaluationView evaluation={evaluation} checklist={checklist} appeals={appeals} dialog={record} demo={demo} selectedCriterion={evidenceCriterion} onCriterionNavigate={()=>{setHighlight(null);setEvidenceCriterion(null);}}/></section></div>
  </div>;
}

export function LoadingView() {return <div className="panel loading" aria-label={t('Загрузка')} aria-busy="true"><div className="skeleton wide"/><div className="skeleton"/><div className="skeleton"/><div className="skeleton wide"/></div>;}
export function ErrorView({message,onRetry,onSettings,onDemo}:{message:string;onRetry?:()=>void;onSettings?:()=>void;onDemo?:()=>void}) {return <><div className="page-heading"><div><h1>{t('Нет подключения к данным')}</h1><p>{t('Интерфейс работает, но сервер пока не ответил.')}</p></div></div><section className="panel"><EmptyState title={t('Не удалось получить данные')} text={message} actions={<><button className="btn btn-primary" data-action="retry" onClick={onRetry}>{t('Повторить')}</button><button className="btn" data-action="settings" onClick={onSettings}>{t('Настроить API')}</button><button className="btn btn-ghost" data-action="demo" onClick={onDemo}>{t('Открыть учебный пример')}</button></>}/></section></>;}
