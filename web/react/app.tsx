import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createApi } from '../api.mjs';
import { evaluationChecklist, failedDialogIds } from '../dialog-utils.mjs';
import { DialogsWorkspace, DialogWorkspace, EstimateNote } from './pages';
import { ChecklistWorkspace } from './forms';
import { AppealsWorkspace } from './review';
import { SubmissionWorkspace } from './submission';
import { AnalyticsWorkspace } from './analytics';
import { EvaluationHistory } from './history';
import { ReportView } from './report';
import { LanguageSwitcher } from './language-switcher';
import { FocusToggle } from './review-tools';
import { EmptyState, Icon, Modal } from './shared';
import { MotionFrame, installInteractionMotion } from './motion';
import { getLocale, localizeMessage, persistLocale, translate as t, type Locale } from './i18n';
import { errorText, navigate } from './runtime';
import type { Api, Appeal, Checklist, DialogRecord, Evaluation, ListState, Notify, Health } from './types';

type Connection = { baseUrl:string; demo:boolean };
type Route = { page:string; id:string; evaluationId:string; invalidEvaluation:boolean };
type ModalState = { kind:'settings' } | { kind:'import' } | { kind:'evaluate'; ids:string[]; checklistId?:string; retry?:boolean } | { kind:'appeal'; evaluationId:string; criterionId:string; title:string };
type JobProgress = { completed:number; total:number; error?:string; paused?:boolean };
const readRoute = ():Route => {
  const [page='dialogs',value='',child='',saved='']=location.hash.slice(1).split('/');
  let id='';try{id=decodeURIComponent(value);}catch{/* Invalid route IDs are never sent to the API. */}
  let evaluationId='',invalidEvaluation=false;
  if(child==='evaluation'){try{evaluationId=decodeURIComponent(saved);invalidEvaluation=!evaluationId;}catch{invalidEvaluation=true;}}
  return {page:page || 'dialogs',id,evaluationId,invalidEvaluation};
};
function initialConnection():Connection {
  let saved:Partial<Connection>={};try{saved=JSON.parse(localStorage.getItem('cqa-connection') || '{}');}catch{/* Optional persistence. */}
  const config=window.CQA_CONFIG || {};
  return {baseUrl:typeof saved.baseUrl==='string'?saved.baseUrl:config.apiBase || '/api',demo:new URLSearchParams(location.search).get('demo')==='1' || (saved.demo ?? config.demo ?? false)};
}
function rememberedJob(connection:Connection):string|null {
  try{const value=JSON.parse(sessionStorage.getItem('cqa-active-job') || 'null');return value?.id && value.baseUrl===connection.baseUrl && value.demo===connection.demo?String(value.id):null;}catch{return null;}
}
function rememberJob(id:string|null,connection:Connection) {
  try{if(id)sessionStorage.setItem('cqa-active-job',JSON.stringify({id,...connection}));else sessionStorage.removeItem('cqa-active-job');}catch{/* Polling still works without storage. */}
}
function blockedApi(message:string):Api {
  const unavailable=async()=>{throw new Error(message);};
  return {demo:false,listDialogs:unavailable,getDialog:unavailable,listChecklists:unavailable,saveChecklist:unavailable,importDialogs:unavailable,uploadDialog:unavailable,evaluate:unavailable,getJob:unavailable,getEvaluation:unavailable,listEvaluations:unavailable,listAppeals:unavailable,createAppeal:unavailable,decideAppeal:unavailable,getAudio:unavailable};
}

export function App() {
  const [connection,setConnection]=useState(initialConnection);
  const [route,setRoute]=useState(readRoute);
  const [locale,setLanguage]=useState<Locale>(getLocale);
  const [refreshVersion,setRefreshVersion]=useState(0);
  const [data,setData]=useState<{rows:DialogRecord[];checklists:Checklist[];appeals:Appeal[]}>({rows:[],checklists:[],appeals:[]});
  const [detail,setDetail]=useState<{record:DialogRecord;evaluation:Evaluation|null}|null>(null);
  const [loading,setLoading]=useState(route.page!=='submission');
  const [loadError,setLoadError]=useState('');
  const [modal,setModal]=useState<ModalState|null>(null);
  const [toast,setToast]=useState<{text:string;error:boolean;revision:number}|null>(null);
  const [listState,setListState]=useState<ListState>({filters:{query:'',language:'',channel:'',status:''},queue:'all',summaryScope:'filtered',selected:new Set()});
  const [editorDirty,setEditorDirty]=useState(false),[reviewDirty,setReviewDirty]=useState(false);
  const [jobId,setJobId]=useState<string|null>(()=>rememberedJob(connection));
  const [jobProgress,setJobProgress]=useState<JobProgress|null>(null);
  const [starting,setStarting]=useState(false),[pollRevision,setPollRevision]=useState(0);
  const startingRef=useRef(false),currentJob=useRef(jobId),mainRef=useRef<HTMLElement>(null);
  currentJob.current=jobId;
  const service=useMemo(()=>{
    try{return {api:createApi(connection) as Api,error:''};}
    catch(error){const message=errorText(error);return {api:blockedApi(message),error:message};}
  },[connection]);
  const api=service.api,busy=starting || Boolean(jobId);
  const notify:Notify=useCallback((text,error=false)=>setToast(previous=>({text,error,revision:(previous?.revision || 0)+1})),[]);
  const refresh=useCallback(()=>setRefreshVersion(value=>value+1),[]);
  const openDialog=useCallback((id:string)=>navigate(`dialog/${encodeURIComponent(id)}`),[]);
  const openEvaluation=useCallback((conversationId:string,id:string)=>navigate(`dialog/${encodeURIComponent(conversationId)}/evaluation/${encodeURIComponent(id)}`),[]);
  const navPage=['dialog','report'].includes(route.page)?'dialogs':route.page;
  const breadcrumb=t(({dialogs:'Диалоги',dialog:'Карточка диалога',report:'Отчёт',checklists:'Чек-листы',appeals:'Апелляции',submission:'Выгрузка',analytics:'Аналитика'} as Record<string,string>)[route.page] || 'Диалоги');

  useEffect(()=>{
    const changed=()=>{setRoute(readRoute());setToast(previous=>previous?.error?previous:null);window.scrollTo({top:0});requestAnimationFrame(()=>mainRef.current?.focus({preventScroll:true}));};
    window.addEventListener('hashchange',changed);return ()=>window.removeEventListener('hashchange',changed);
  },[]);
  useEffect(()=>{document.documentElement.lang=locale;document.title=`CQA · ${breadcrumb}`;},[locale,breadcrumb]);
  useEffect(()=>installInteractionMotion(),[]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),toast.error?6500:3500);return ()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{
    const guard=(event:BeforeUnloadEvent)=>{if(editorDirty || reviewDirty){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',guard);return ()=>window.removeEventListener('beforeunload',guard);
  },[editorDirty,reviewDirty]);
  useEffect(()=>{
    if(route.page==='submission'){setLoading(false);setLoadError('');return;}
    if(service.error){setLoadError(service.error);setLoading(false);return;}
    let ignored=false;setLoading(true);setLoadError('');
    (async()=>{
      try {
        const [rows,checklists,appeals]=await Promise.all([api.listDialogs(),api.listChecklists(),api.listAppeals()]);
        const resolved=await Promise.all(appeals.map(async appeal=>{
          if(appeal.conversation_id)return appeal;
          const row=rows.find(item=>item.evaluation_id===appeal.evaluation_id);
          if(row)return {...appeal,conversation_id:row.conversation_id};
          try{const evaluation=await api.getEvaluation(appeal.evaluation_id);return {...appeal,conversation_id:evaluation.conversation_id};}
          catch{return {...appeal,context_unavailable:true};}
        }));
        let loadedDetail:typeof detail=null;
        if(['dialog','report'].includes(route.page) && route.id) {
          const record=await api.getDialog(route.id);
          if(route.invalidEvaluation)throw new Error('Не удалось открыть сохранённую оценку. Проверьте ссылку.');
          const evaluationId=route.evaluationId || record.evaluation_id || rows.find(item=>item.conversation_id===record.conversation_id)?.evaluation_id;
          const evaluation=evaluationId?await api.getEvaluation(evaluationId):null;
          if(route.evaluationId && (!evaluation || evaluation.id!==route.evaluationId || evaluation.conversation_id!==record.conversation_id))throw new Error('Оценка не относится к выбранному диалогу.');
          loadedDetail={record,evaluation};
        }
        if(ignored)return;
        setData({rows,checklists,appeals:resolved});setDetail(loadedDetail);
      } catch(error){if(!ignored)setLoadError(errorText(error));}
      finally{if(!ignored)setLoading(false);}
    })();
    return ()=>{ignored=true;};
  },[api,route.page,route.id,route.evaluationId,route.invalidEvaluation,refreshVersion,service.error]);
  useEffect(()=>{
    if(!jobId)return;
    let ignored=false,timer:ReturnType<typeof setTimeout>|undefined,wake:(()=>void)|undefined;
    rememberJob(jobId,connection);setJobProgress({completed:0,total:1});
    (async()=>{
      let failures=0;
      for(let attempt=0;attempt<300 && !ignored;attempt++) {
        try {
          const job=await api.getJob(jobId);if(ignored)return;failures=0;
          setJobProgress({completed:Number(job.completed) || 0,total:Number(job.total) || 1});
          if(['completed','done','finished','succeeded'].includes(job.status)) {
            rememberJob(null,connection);setJobId(null);setListState(previous=>({...previous,selected:new Set()}));refresh();
            if(Number(job.failed)>0 || job.errors?.length) {
              setJobProgress({completed:Number(job.completed) || 0,total:Number(job.total) || 1,error:'Часть диалогов не оценена. Обновите диалоги и повторите оценку записей с ошибкой.'});
            } else {setJobProgress(null);notify('Оценка завершена. Результаты обновлены.');}
            return;
          }
          if(['failed','error','cancelled','canceled'].includes(job.status)) {
            rememberJob(null,connection);setJobId(null);setJobProgress({completed:Number(job.completed) || 0,total:Number(job.total) || 1,error:'Оценка завершилась с ошибкой. Обновите диалоги и проверьте сервер.'});refresh();return;
          }
        } catch(error) {
          if(ignored)return;
          if(++failures>=3){setJobProgress({completed:0,total:1,error:errorText(error),paused:true});return;}
        }
        await new Promise<void>(resolve=>{wake=resolve;timer=setTimeout(resolve,api.demo?450:1500);});
      }
      if(!ignored)setJobProgress({completed:0,total:1,paused:true});
    })();
    return ()=>{ignored=true;if(timer)clearTimeout(timer);wake?.();};
  },[api,jobId,pollRevision,connection,refresh,notify]);

  const chooseLanguage=async(value:Locale)=>{
    const url=persistLocale(value,{currentUrl:location.href});setLanguage(value);history.replaceState(null,'',url);
    return true;
  };
  const openEvaluate=(ids:string[],checklistId?:string,retry=false)=>{
    if(busy || startingRef.current){notify('Предыдущее задание ещё выполняется. Дождитесь результата.');return;}
    if(!ids.length){notify('Сначала выберите диалог.',true);return;}
    if(!data.checklists.length){notify('Сначала создайте чек-лист.',true);return;}
    setModal({kind:'evaluate',ids,checklistId,retry});
  };
  const openSettings=()=>{if(busy)notify('Дождитесь завершения оценки перед сменой источника данных.');else setModal({kind:'settings'});};
  const upload=async(file:File)=>{
    try {
      if(file.size>5*1024*1024)throw new Error('Файл больше 5 МБ. Загрузите меньший JSON.');
      try{JSON.parse(await file.text());}catch{throw new Error('Файл должен содержать корректный JSON.');}
      await api.uploadDialog(file);setListState(previous=>({...previous,selected:new Set()}));navigate('dialogs');refresh();notify('Транскрипт загружен.');
    }catch(error){notify(errorText(error),true);}
  };
  const submitModal=async(values:FormData):Promise<boolean>=>{
    if(!modal)return false;
    try {
      if(modal.kind==='settings') {
        const value=String(values.get('baseUrl') || '').trim();let parsed:URL;
        try{parsed=new URL(value,location.origin);}catch{throw new Error('Укажите корректный адрес API.');}
        if(!value || value.startsWith('//') || !['http:','https:'].includes(parsed.protocol) || parsed.search || parsed.hash || parsed.username || parsed.password)throw new Error('Используйте адрес API без ключей, параметров и пароля.');
        if((editorDirty || reviewDirty) && !window.confirm(t('Сменить источник и отменить несохранённые изменения?')))return false;
        const next={baseUrl:value.replace(/\/$/,''),demo:values.get('mode')==='demo'};
        try{localStorage.setItem('cqa-connection',JSON.stringify(next));}catch{notify('Браузер не разрешил сохранить настройки.');}
        const url=new URL(location.href);url.searchParams.delete('demo');history.replaceState(null,'',url);
        setData({rows:[],checklists:[],appeals:[]});setDetail(null);setEditorDirty(false);setReviewDirty(false);setListState(previous=>({...previous,selected:new Set()}));setConnection(next);
      } else if(modal.kind==='import') {
        const group=String(values.get('groupId') || '').trim();if(!group)throw new Error('Укажите group_id набора.');
        const result=await api.importDialogs(group);navigate('dialogs');refresh();notify(api.demo?(result.message || 'Учебный режим не загружает набор организаторов.'):'Набор импортирован.');
      } else if(modal.kind==='appeal') {
        const comment=String(values.get('comment') || '').trim();if(!comment)throw new Error('Добавьте причину апелляции.');
        await api.createAppeal({evaluation_id:modal.evaluationId,criterion_id:modal.criterionId,comment});refresh();notify('Апелляция сохранена. Она доступна в очереди проверяющего.');
      } else {
        if(values.get('confirm')!=='on')throw new Error('Подтвердите запуск оценки.');
        if(startingRef.current || currentJob.current)throw new Error('Предыдущее задание ещё выполняется.');
        startingRef.current=true;setStarting(true);
        try {
          if(modal.retry){
            const failed=new Set(failedDialogIds(await api.listDialogs()) as string[]);
            if(modal.ids.some(id=>!failed.has(id))){refresh();throw new Error('Список ошибок изменился. Обновите диалоги и выберите повтор заново.');}
          }
          const job=await api.evaluate(modal.ids,String(values.get('checklistId') || ''),modal.retry?{only_failed:true}:undefined);
          if(route.evaluationId && modal.ids.length===1)openDialog(modal.ids[0]);
          if(!job?.id)throw new Error('Сервер не вернул номер задания.');
          currentJob.current=String(job.id);rememberJob(String(job.id),connection);setJobId(String(job.id));
        }finally{startingRef.current=false;setStarting(false);}
      }
      setModal(null);return true;
    }catch(error){notify(errorText(error),true);return false;}
  };

  const onChecklistSaved=async(saved:Checklist)=>{setData(previous=>({...previous,checklists:[...previous.checklists.filter(item=>item.id!==saved.id),saved]}));refresh();};
  const openDemo=()=>{
    if(busy || startingRef.current){notify('Дождитесь завершения оценки перед сменой источника данных.');return;}
    if((editorDirty || reviewDirty) && !window.confirm(t('Сменить источник и отменить несохранённые изменения?')))return;
    const url=new URL(location.href);url.searchParams.set('demo','1');history.replaceState(null,'',url);
    setData({rows:[],checklists:[],appeals:[]});setDetail(null);setEditorDirty(false);setReviewDirty(false);
    setConnection(previous=>({...previous,demo:true}));setListState(previous=>({...previous,selected:new Set()}));navigate('dialogs');
  };
  const snapshot=detail?.evaluation?evaluationChecklist(detail.evaluation,data.checklists) as Checklist|null:null;
  const nav=[['dialogs','dialogs','Диалоги'],['checklists','list','Чек-листы'],['appeals','appeal','Апелляции'],['analytics','chart','Аналитика'],['submission','download','Выгрузка']];
  const errorActions=<><button className="btn btn-primary" data-action="retry" onClick={refresh}>{t('Повторить')}</button><button className="btn" data-action="settings" onClick={openSettings}>{t('Настроить API')}</button><button className="btn btn-ghost" data-action="demo" onClick={openDemo}>{t('Открыть учебный пример')}</button></>;
  return <>
    <a className="skip-link" href="#main" onClick={event=>{event.preventDefault();mainRef.current?.focus();}}>{t('К содержимому')}</a>
    <aside className="sidebar" aria-label={t('Главное меню')}><a className="brand" href="#dialogs" aria-label={t('Freedom CQA, диалоги')}><img className="brand-mark" src="./assets/freedom-mark.svg" width="34" height="40" alt="" aria-hidden="true"/><img className="brand-logo" src="./assets/freedom-logo.svg" width="168" height="40" alt="Freedom"/><span className="brand-caption">Conversation Quality</span></a><div className="workspace-label"><span>{t('Контроль качества')}</span><span>CQA</span></div><nav>{nav.map(([page,icon,text])=><a key={page} href={`#${page}`} data-nav={page} aria-current={navPage===page?'page':undefined}><span className="nav-icon"><Icon name={icon}/></span><span>{t(text)}</span>{page==='dialogs' && <span className="nav-count" id="dialog-count">{data.rows.length || ''}</span>}{page==='appeals' && <span className="nav-count" id="appeal-count">{data.appeals.filter(appeal=>appeal.status==='open').length || ''}</span>}</a>)}</nav><div className="sidebar-bottom"><div className="workspace-signature"><Icon name="shield"/><span>Conversation<br/><strong>Quality Analytics</strong></span></div><p>{t('Прототип команды')}<br/><span>Data Challenge 2026 · {window.CQA_CONFIG?.teamName || 'seeusoon'}</span></p><button className="connection-button" data-action="settings" onClick={openSettings}><span className="connection-dot" aria-hidden="true"/><span id="connection-label">{t(connection.demo?'Учебный пример':'Настройки подключения')}</span><Icon name="settings"/></button></div></aside>
    <div className="app-shell"><header className="topbar"><div><span className="topbar-parent">{t('Рабочее пространство')}</span><span className="breadcrumb-sep" aria-hidden="true">/</span><span id="breadcrumb">{breadcrumb}</span></div><div className="topbar-end"><span id="mode-label" className="mode-label">{t(connection.demo?'Учебный пример':'Данные сервера')}</span><div id="language-switcher"><LanguageSwitcher onSelect={chooseLanguage}/></div><div id="workspace-tools"><FocusToggle/></div><button className="icon-btn" data-action="settings" aria-label={t('Настройки подключения')} title={t('Настройки подключения')} onClick={openSettings}><Icon name="settings"/></button><span className="avatar" aria-hidden="true">QA</span></div></header>
    <div id="demo-banner" className="demo-banner" hidden={!connection.demo || route.page==='submission'}><span><strong>{t('Учебный пример.')}</strong> {t('Вымышленные диалоги и оценки, модель не вызывается.')}</span><button data-action="settings" onClick={openSettings}>{t('Подключить сервер')} <Icon name="arrow-right"/></button></div>
    <div id="job-banner" className="job-banner" role="status" hidden={!jobProgress}>{jobProgress && (jobProgress.paused?<><span className={jobProgress.error?'danger':''}>{jobProgress.error?localizeMessage(jobProgress.error):t('Задание ещё выполняется.')}</span><button className="text-btn" data-resume-job={jobId || undefined} onClick={()=>setPollRevision(value=>value+1)}>{t('Проверить прогресс')}</button></>:jobProgress.error?<><span className="danger">{t(jobProgress.error)}</span><button className="text-btn" data-action="retry" onClick={refresh}>{t('Обновить диалоги')}</button></>:<><strong>{t('Оценка диалогов')}</strong> · {t('{completed} из {total}',{completed:jobProgress.completed,total:jobProgress.total})}<progress aria-label={t('Прогресс оценки')} max={jobProgress.total} value={jobProgress.completed}/></>)}</div>
    <main id="main" ref={mainRef} tabIndex={-1}>
      {route.page!=='submission' && loading && <div className="panel loading" aria-label={t('Загрузка')} aria-busy="true"><div className="skeleton wide"/><div className="skeleton"/><div className="skeleton"/></div>}
      {route.page!=='submission' && !loading && loadError && <><div className="page-heading"><div><h1>{t('Нет подключения к данным')}</h1><p>{t('Интерфейс работает, но сервер пока не ответил.')}</p></div></div><section className="panel"><EmptyState title={t('Не удалось получить данные')} text={localizeMessage(loadError)} actions={errorActions}/></section></>}
      {!loading && !loadError && !['checklists','appeals','submission','analytics'].includes(route.page) && <MotionFrame key={`${route.page}/${route.id}`}>
      {['dialog','report'].includes(route.page) && detail?route.page==='report'?<ReportView dialog={detail.record} evaluation={detail.evaluation} checklist={snapshot} appeals={data.appeals} demo={connection.demo} onBack={()=>detail.evaluation?openEvaluation(detail.record.conversation_id,detail.evaluation.id):openDialog(detail.record.conversation_id)}/>:<><DialogWorkspace key={`${detail.record.conversation_id}:${detail.evaluation?.id || ''}`} record={detail.record} evaluation={detail.evaluation} checklist={snapshot} checklists={data.checklists} appeals={data.appeals} api={api} demo={connection.demo} busy={busy} onEvaluate={openEvaluate} onAppeal={criterionId=>{if(detail.evaluation)setModal({kind:'appeal',criterionId,evaluationId:detail.evaluation.id,title:snapshot?.criteria.find(criterion=>criterion.id===criterionId)?.title || criterionId});}} onReport={()=>navigate(detail.evaluation?`report/${encodeURIComponent(detail.record.conversation_id)}/evaluation/${encodeURIComponent(detail.evaluation.id)}`:`report/${encodeURIComponent(detail.record.conversation_id)}`)} notify={notify}/><EvaluationHistory api={api} conversationId={detail.record.conversation_id} record={detail.record} currentEvaluationId={detail.evaluation?.id} latestEvaluationId={detail.record.evaluation_id} onOpen={id=>openEvaluation(detail.record.conversation_id,id)} refreshKey={refreshVersion}/></>:<DialogsWorkspace rows={data.rows} appeals={data.appeals} state={listState} onState={setListState} busy={busy} onEvaluate={openEvaluate} onRetryFailed={ids=>openEvaluate(ids,undefined,true)} onOpenDialog={openDialog} onImport={()=>setModal({kind:'import'})} onUpload={()=>document.getElementById('upload-file')?.click()} onSubmission={()=>navigate('submission')}/>}
      </MotionFrame>}
      <AnalyticsWorkspace api={api} rows={data.rows} active={route.page==='analytics' && !loading && !loadError} onOpenDialog={openDialog} refreshKey={refreshVersion}/>
      <ChecklistWorkspace key={`editor-${connection.baseUrl}-${connection.demo}`} active={route.page==='checklists' && !loading && !loadError} api={api} checklists={data.checklists} onSaved={onChecklistSaved} notify={notify} onDirtyChange={setEditorDirty}/>
      <AppealsWorkspace key={`appeals-${connection.baseUrl}-${connection.demo}`} active={route.page==='appeals' && !loading && !loadError} api={api} appeals={data.appeals} checklists={data.checklists} rows={data.rows} onSaved={refresh} onOpenDialog={openDialog} notify={notify} onDirtyChange={setReviewDirty} demo={connection.demo}/>
      <SubmissionWorkspace active={route.page==='submission'} api={api} demo={connection.demo} teamName={window.CQA_CONFIG?.teamName || 'seeusoon'} notify={notify} connectionError={service.error} onSettings={openSettings}/>
    </main></div>
    <div id="notifications" className="notifications" aria-live="polite" aria-atomic="true">{toast && <MotionFrame kind="toast" key={toast.revision}><div className={`toast ${toast.error?'error':''}`}><span className="toast-symbol" aria-hidden="true"><Icon name={toast.error?'alert':'circleCheck'}/></span><span>{localizeMessage(toast.text)}</span><button type="button" className="icon-btn toast-dismiss" aria-label={t('Закрыть уведомление')} onClick={()=>setToast(null)}><Icon name="close"/></button></div></MotionFrame>}</div>
    {modal && <ApplicationModal key={modal.kind} modal={modal} api={api} connection={connection} checklists={data.checklists} onClose={()=>setModal(null)} onSubmit={submitModal} notify={notify}/>}
    <input type="file" id="upload-file" accept=".json,application/json" hidden onChange={event=>{const file=event.currentTarget.files?.[0];if(file)void upload(file);event.currentTarget.value='';}}/>
  </>;
}

function ApplicationModal({modal,api,connection,checklists,onClose,onSubmit,notify}:{modal:ModalState;api:Api;connection:Connection;checklists:Checklist[];onClose:()=>void;onSubmit:(values:FormData)=>Promise<boolean>;notify:Notify}) {
  const [sending,setSending]=useState(false),lock=useRef(false);
  const [health,setHealth]=useState<Health|null>(null);
  useEffect(()=>{if(modal.kind!=='evaluate' || !api.getHealth)return;let ignored=false;api.getHealth().then(value=>{if(!ignored)setHealth(value);}).catch(()=>{});return ()=>{ignored=true;};},[api,modal.kind]);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(lock.current){notify(modal.kind==='evaluate'?'Предыдущее задание ещё выполняется.':'Дождитесь завершения сохранения.');return;}lock.current=true;setSending(true);const success=await onSubmit(new FormData(event.currentTarget));if(!success){lock.current=false;setSending(false);}};
  const title=t(modal.kind==='settings'?'Подключение к данным':modal.kind==='import'?'Импорт набора':modal.kind==='evaluate'?'Запустить оценку':'Оспорить оценку');
  const id=modal.kind==='settings'?'settings-form':modal.kind==='import'?'import-form':modal.kind==='evaluate'?'evaluate-form':'appeal-form';
  return <Modal title={title} onClose={onClose} busy={sending}><form id={id} className="form-stack" onSubmit={submit} data-criterion-id={modal.kind==='appeal'?modal.criterionId:undefined}><fieldset disabled={sending} className="modal-fields">
    {modal.kind==='settings'?<><p className="modal-description">{t('Укажите адрес сервера вашей команды. Ключи AI и ссылка организаторов остаются на сервере.')}</p><fieldset><legend>{t('Источник данных')}</legend><div className="form-stack"><label><input type="radio" name="mode" value="api" defaultChecked={!connection.demo}/>{t('Сервер команды')}</label><label><input type="radio" name="mode" value="demo" defaultChecked={connection.demo}/>{t('Учебный пример без AI')}</label></div></fieldset><label>{t('Базовый адрес API')}<input name="baseUrl" defaultValue={connection.baseUrl} required placeholder="http://127.0.0.1:8000/api"/></label><p className="muted small">{t('Для сервера на том же адресе используйте /api. Учебные изменения сохраняются только в этом браузере.')}</p></>:modal.kind==='import'?<><p className="modal-description">{t('Сервер получит диалоги по group_id. Для контрольного набора введите значение от организаторов.')}</p><label>{t('Группа набора')}<input name="groupId" required maxLength={100} defaultValue="DEV" autoComplete="off"/></label>{connection.demo && <div className="notice">{t('Учебный режим не загружает набор организаторов. Для импорта подключите сервер команды.')}</div>}</>:modal.kind==='evaluate'?<><p className="modal-description">{t('Диалогов: {count}. Оценка пройдёт в фоне.',{count:modal.ids.length})}</p>{modal.retry&&<div className="notice">{t('Повторяются только ошибки текущей выборки. Успешные оценки сохраняются.')}</div>}<EstimateNote health={health} count={modal.ids.length}/><label>{t('Чек-лист')}<select name="checklistId" defaultValue={modal.checklistId || checklists[0]?.id}>{checklists.map(checklist=><option key={`${checklist.id}@${checklist.version}`} value={checklist.id}>{checklist.name} · v{checklist.version}</option>)}</select></label><label><input name="confirm" type="checkbox" required/>{t(connection.demo?'Понимаю, что это учебная оценка без AI':'Подтверждаю запуск AI-оценки. Если сервер использует платный API, возможны расходы')}</label></>:<><p className="modal-description">{modal.title}. {t('Проверяющий увидит комментарий вместе с оценкой и фрагментом диалога.')}</p><label>{t('Почему вы не согласны')}<textarea name="comment" required maxLength={4000} rows={4} placeholder={t('Укажите, какой фрагмент стоит проверить')}/></label></>}
    <div className="form-actions"><button className="btn" type="button" data-action="close-modal" onClick={onClose}>{t('Отмена')}</button><button className="btn btn-primary" type="submit" aria-busy={sending}>{t(sending?'Сохранение…':modal.kind==='settings'?'Подключиться':modal.kind==='import'?'Импортировать набор':modal.kind==='evaluate'?(modal.ids.length===1?'Оценить диалог':'Оценить диалоги'):'Подать апелляцию')}</button></div>
  </fieldset></form></Modal>;
}
