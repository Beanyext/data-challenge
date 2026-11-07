import { useEffect, useRef, useState } from 'react';
import { evaluationChecklist, reviewExcerpt } from '../dialog-utils.mjs';
import type { Answer, Api, Appeal, Checklist, Criterion, CriterionResult, DialogRecord, Evaluation, Notify, Turn } from './types';
import { EmptyState, Icon, label } from './shared';
import { localizeMessage, translate as t } from './i18n';
import { audioUrl, errorText } from './runtime';

type Draft={status:'confirmed'|'changed';answer:Answer|'';reason:string};
type Excerpt={turns:(Turn&{index:number;highlighted:boolean})[];invalidEvidence:boolean;firstTurn:number|null};
export interface ReviewContext {record:DialogRecord;evaluation:Evaluation;criterion:Criterion;item:CriterionResult;excerpt:Excerpt}
type Load={loading?:boolean;error?:string;value?:ReviewContext};
interface Props {active:boolean;api:Api;appeals:Appeal[];checklists:Checklist[];rows:DialogRecord[];onSaved:()=>void|Promise<void>;onOpenDialog:(id:string)=>void;notify:Notify;onDirtyChange:(dirty:boolean)=>void;demo:boolean}

export function answerOptions(criterion:Criterion):Answer[] {
  const answers:Answer[]=criterion.answer_type==='scale'?(criterion.scale?.steps || []).map(step=>step.value).filter(Number.isFinite):['yes','no'];
  if(criterion.na_allowed)answers.push('na');
  return [...new Set(answers)];
}

export async function readReviewContext(api:Api,appeal:Appeal,checklists:Checklist[],rows:DialogRecord[]):Promise<ReviewContext> {
  const evaluation=await api.getEvaluation(appeal.evaluation_id);
  if(!evaluation || evaluation.id!==appeal.evaluation_id)throw new Error('Не удалось получить исходный критерий этой оценки. Решение не сохранено.');
  const checklist=evaluationChecklist(evaluation,checklists) as Checklist|null;
  const criterion=checklist?.criteria.find(item=>item.id===appeal.criterion_id);
  const item=evaluation.criteria?.find(item=>item.criterion_id===appeal.criterion_id);
  if(!criterion || !item || !answerOptions(criterion).length || (!answerOptions(criterion).some(answer=>answer===item.answer) && item.needs_review!==true))throw new Error('Не удалось получить исходный критерий этой оценки. Решение не сохранено.');
  const id=evaluation.conversation_id || appeal.conversation_id || rows.find(row=>row.evaluation_id===appeal.evaluation_id)?.conversation_id;
  if(!id)throw new Error('Не удалось определить исходный диалог оценки.');
  const record=await api.getDialog(id);
  if(!record || record.conversation_id!==id || !Array.isArray(record.transcript))throw new Error('Сервер вернул неподходящий исходный диалог.');
  return {record,evaluation,criterion,item,excerpt:reviewExcerpt(record,item) as Excerpt};
}

export function AppealsWorkspace({active,api,appeals,checklists,rows,onSaved,onOpenDialog,notify,onDirtyChange,demo}:Props) {
  const [filter,setFilter]=useState<'open'|'all'>('open'),[expanded,setExpanded]=useState<Set<string>>(new Set());
  const [contexts,setContexts]=useState<Record<string,Load>>({}),[drafts,setDrafts]=useState<Record<string,Draft>>({});
  const [saving,setSaving]=useState<Set<string>>(new Set()),[resolved,setResolved]=useState<Set<string>>(new Set());
  const savingRef=useRef(new Set<string>()),loadingRef=useRef(new Set<string>()),generation=useRef(0),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  useEffect(()=>{generation.current++;loadingRef.current.clear();setContexts({});setExpanded(new Set());},[api]);
  useEffect(()=>{
    const closed=new Set(appeals.filter(appeal=>appeal.status!=='open').map(appeal=>appeal.id));
    if(!closed.size)return;
    setDrafts(previous=>Object.keys(previous).some(id=>closed.has(id))?Object.fromEntries(Object.entries(previous).filter(([id])=>!closed.has(id))):previous);
    setExpanded(previous=>[...previous].some(id=>closed.has(id))?new Set([...previous].filter(id=>!closed.has(id))):previous);
  },[appeals]);
  useEffect(()=>{onDirtyChange(Object.values(drafts).some(draft=>Boolean(draft.reason.trim()) || draft.status==='changed'));},[drafts,onDirtyChange]);
  const visible=appeals.filter(appeal=>filter==='all' || appeal.status==='open');

  async function load(appeal:Appeal) {
    setExpanded(previous=>new Set(previous).add(appeal.id));
    if(loadingRef.current.has(appeal.id))return;
    loadingRef.current.add(appeal.id);
    const ticket=generation.current;
    setContexts(previous=>({...previous,[appeal.id]:{loading:true}}));
    try {
      const value=await readReviewContext(api,appeal,checklists,rows);
      if(!mounted.current || ticket!==generation.current)return;
      setContexts(previous=>({...previous,[appeal.id]:{value}}));
    } catch(error) {
      if(mounted.current && ticket===generation.current)setContexts(previous=>({...previous,[appeal.id]:{error:errorText(error)}}));
    } finally {if(ticket===generation.current)loadingRef.current.delete(appeal.id);}
  }
  function changeDraft(id:string,draft:Draft) {if(savingRef.current.has(id))return;setDrafts(previous=>({...previous,[id]:draft}));}
  function cancel(id:string) {
    if(savingRef.current.has(id))return;
    setExpanded(previous=>{const next=new Set(previous);next.delete(id);return next;});
    setDrafts(previous=>{const next={...previous};delete next[id];return next;});
  }
  async function save(appeal:Appeal,context:ReviewContext,draft:Draft) {
    if(savingRef.current.has(appeal.id))return;
    const reason=draft.reason.trim();
    if(!reason){notify(t('Укажите причину решения.'),true);return;}
    const selected=draft.status==='confirmed'?context.item.answer:draft.answer;
    const answer=answerOptions(context.criterion).find(choice=>choice===selected);
    if(answer===undefined){notify(t('Выберите допустимый ответ по исходному критерию.'),true);return;}
    const ticket=generation.current;
    savingRef.current.add(appeal.id);setSaving(previous=>new Set(previous).add(appeal.id));
    try {
      await api.decideAppeal(appeal.id,{answer,reason,status:draft.status});
      if(!mounted.current || ticket!==generation.current)return;
      setResolved(previous=>new Set(previous).add(appeal.id));
      setExpanded(previous=>{const next=new Set(previous);next.delete(appeal.id);return next;});
      setDrafts(previous=>{const next={...previous};delete next[appeal.id];return next;});
      await onSaved();notify(t('Решение сохранено. Итог пересчитан.'));
    } catch(error){if(mounted.current && ticket===generation.current)notify(localizeMessage(errorText(error)),true);}
    finally {savingRef.current.delete(appeal.id);if(mounted.current)setSaving(previous=>{const next=new Set(previous);next.delete(appeal.id);return next;});}
  }
  async function openDialog(appeal:Appeal) {
    try {
      const known=contexts[appeal.id]?.value?.record.conversation_id || appeal.conversation_id || rows.find(row=>row.evaluation_id===appeal.evaluation_id)?.conversation_id;
      const id=known || (await api.getEvaluation(appeal.evaluation_id)).conversation_id;
      if(!id)throw new Error('Не удалось определить исходный диалог оценки.');
      onOpenDialog(id);
    } catch(error){notify(localizeMessage(errorText(error)),true);}
  }
  if(!active)return null;
  return <>
    <div className="page-heading"><div><h1>{t('Апелляции')}</h1><p>{t('Проверьте доказательства и сохраните обоснованное решение.')}</p></div><button type="button" className="btn" data-action="retry" onClick={()=>void onSaved()}><Icon name="rotate"/>{t('Обновить список')}</button></div>
    <div className="view-tabs" role="group" aria-label={t('Статус апелляций')}><button type="button" className={`btn ${filter==='open'?'btn-dark':''}`} aria-pressed={filter==='open'} data-appeal-filter="open" onClick={()=>setFilter('open')}>{t('Открытые')} · {appeals.filter(appeal=>appeal.status==='open').length}</button><button type="button" className={`btn ${filter==='all'?'btn-dark':''}`} aria-pressed={filter==='all'} data-appeal-filter="all" onClick={()=>setFilter('all')}>{t('Все обращения')} · {appeals.length}</button></div>
    <section className="panel appeal-queue react-appeals">{visible.length?visible.map(appeal=>{
      const context=contexts[appeal.id],value=context?.value;
      const validAnswer=value && answerOptions(value.criterion).some(answer=>answer===value.item.answer);
      const draft:Draft=drafts[appeal.id] || {status:validAnswer?'confirmed':'changed',answer:validAnswer?value!.item.answer:'',reason:''};
      const busy=saving.has(appeal.id),open=appeal.status==='open' && !resolved.has(appeal.id) && expanded.has(appeal.id);
      return <article className="appeal-card" id={`appeal-${appeal.id}`} key={appeal.id}><div className="appeal-content"><div className="appeal-meta"><span className={`badge ${appeal.status==='open'?'badge-amber':'badge-green'}`}>{label(appeal.status)}</span><span className="muted small">{appeal.conversation_id || appeal.evaluation_id} · {appeal.criterion_id}</span></div><h3>{appeal.criterion_title || t('Пересмотр критерия')}</h3><div className={`appeal-perspectives ${appeal.decision?'has-decision':''}`}><section className="appeal-statement"><h4>{t('Комментарий оператора')}</h4><p>{appeal.comment}</p></section>{appeal.decision&&<section className="appeal-statement appeal-decision"><h4>{t('Решение проверяющего')}</h4><strong>{t('Ответ: {answer}',{answer:label(appeal.decision.answer)})}</strong><p>{appeal.decision.reason}</p></section>}</div></div>
        <div className="actions appeal-actions"><button type="button" className="btn btn-small" data-context={appeal.id} onClick={()=>void openDialog(appeal)}>{t('Открыть диалог')} ↗</button>{appeal.status==='open'&&<button type="button" className="btn btn-small btn-primary" data-review={appeal.id} disabled={busy || context?.loading || resolved.has(appeal.id)} onClick={()=>void load(appeal)}>{t('Рассмотреть')}</button>}</div>
        {open&&<div className="review-form" id={`review-${appeal.id}`} aria-busy={context?.loading || busy}>{context?.loading?<p className="muted" role="status">{t('Загрузка оценки и фрагмента диалога…')}</p>:context?.error?<div className="notice error"><p>{localizeMessage(context.error)}</p><button type="button" className="btn btn-small" data-review={appeal.id} onClick={()=>void load(appeal)}>{t('Повторить загрузку')}</button></div>:value?<ReviewForm appeal={appeal} context={value} draft={draft} busy={busy} api={api} demo={demo} onChange={next=>changeDraft(appeal.id,next)} onSave={()=>void save(appeal,value,draft)} onCancel={()=>cancel(appeal.id)} onOpenDialog={()=>void openDialog(appeal)}/>:null}</div>}
      </article>;
    }):<EmptyState title={t(filter==='open'?'Нет открытых апелляций':'Апелляций пока нет')} text={t('Чтобы оспорить оценку, откройте диалог и нажмите «Оспорить» у нужного критерия.')} actions={<a className="btn" href="#dialogs">{t('Перейти к диалогам')}</a>}/>}</section>
  </>;
}

interface ReviewFormProps {appeal:Appeal;context:ReviewContext;draft:Draft;busy:boolean;api:Api;demo:boolean;onChange:(draft:Draft)=>void;onSave:()=>void;onCancel:()=>void;onOpenDialog:()=>void}
export function ReviewForm({appeal,context,draft,busy,api,demo,onChange,onSave,onCancel,onOpenDialog}:ReviewFormProps) {
  const {record,criterion,item,excerpt}=context,choices=answerOptions(criterion);
  const validCurrent=choices.some(answer=>answer===item.answer);
  const selected=draft.status==='changed'?draft.answer:item.answer;
  const roles:Record<string,string>={operator:t('Оператор'),client:t('Клиент'),bot:t('Бот'),system:t('Система')};
  return <form data-decision={appeal.id} className="review-layout react-review-layout" onSubmit={event=>{event.preventDefault();onSave();}}><section className="review-evidence"><h3>{t('Основание спорной оценки')}</h3><div className="notice"><strong>{criterion.title}</strong><p>{t('Текущий ответ: {answer}.',{answer:validCurrent?label(item.answer):t('Ответ не получен')})} {item.explanation}</p></div><p className="small muted">{criterion.description}</p>{item.na_reason&&<p className="small"><strong>{t('Причина N/A:')}</strong> {item.na_reason}</p>}{item.needs_review&&<span className="badge badge-amber">{t('Требуется проверка человеком')}</span>}
    <h3>{t('Фрагмент диалога')}</h3><p className="small muted">{t('Выделены реплики основания. Соседние сообщения показаны для контекста.')}</p>{excerpt.invalidEvidence&&<div className="notice error">{t('В оценке есть некорректная ссылка на реплику. Проверьте полный диалог.')}</div>}
    {excerpt.turns.length?<div className="review-transcript">{excerpt.turns.map(turn=><article key={turn.index} id={`appeal-${appeal.id}-turn-${turn.index}`} className={`turn turn-${Object.hasOwn(roles,turn.speaker)?turn.speaker:'system'} ${turn.highlighted?'highlight':''}`} tabIndex={-1}><div className="turn-meta"><strong>{roles[turn.speaker] || turn.speaker}</strong><span>№ {turn.index+1} · {turn.timestamp}</span></div><p>{turn.text}</p></article>)}</div>:<div className="notice">{t('Оценка не содержит корректной ссылки на реплику или проверенный участок. Откройте полный диалог перед решением.')}</div>}
    {record.channel==='voice call'&&<ReviewAudio api={api} demo={demo} appealId={appeal.id} conversationId={record.conversation_id} firstTurn={excerpt.firstTurn}/>}
    <button className="text-btn" type="button" data-context={appeal.id} onClick={onOpenDialog}>{t('Открыть полный диалог')} ↗</button></section>
    <div className="review-decision"><h3>{t('Решение проверяющего')}</h3><fieldset disabled={busy}><legend>{t('Действие')}</legend><div className="radio-row"><label><input type="radio" name="decision-status" value="confirmed" disabled={!validCurrent} checked={draft.status==='confirmed'} onChange={()=>onChange({...draft,status:'confirmed',answer:item.answer})}/>{t('Подтвердить оценку')}</label><label><input type="radio" name="decision-status" value="changed" checked={draft.status==='changed'} onChange={()=>onChange({...draft,status:'changed'})}/>{t('Изменить оценку')}</label></div></fieldset>
      <label>{t('Ответ по критерию')}<select name="answer" data-original={item.answer} value={selected==null?'':String(selected)} required disabled={busy || draft.status==='confirmed'} onChange={event=>{const answer=choices.find(choice=>String(choice)===event.target.value);if(answer!==undefined)onChange({...draft,answer});}}>{!validCurrent&&<option value="" disabled>{t('Выберите допустимый ответ по исходному критерию.')}</option>}{choices.map(answer=><option key={String(answer)} value={String(answer)}>{label(answer)}</option>)}</select></label>
      <label>{t('Причина решения')}<textarea name="reason" required maxLength={4000} value={draft.reason} disabled={busy} placeholder={t('Объясните, что подтверждает решение')} onChange={event=>onChange({...draft,reason:event.target.value})}/></label>
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{t(busy?'Сохраняем…':'Сохранить решение')}</button><button type="button" className="btn" data-cancel-review={appeal.id} disabled={busy} onClick={onCancel}>{t('Отмена')}</button></div>
    </div>
  </form>;
}

function ReviewAudio({api,demo,appealId,conversationId,firstTurn}:{api:Api;demo:boolean;appealId:string;conversationId:string;firstTurn:number|null}) {
  const [source,setSource]=useState<string|null>(null),[offset,setOffset]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useRef(0),busyRef=useRef(false);
  useEffect(()=>()=>{request.current++;},[]);
  async function load() {
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');const ticket=++request.current;
    try {
      const audio=await api.getAudio(conversationId),url=audioUrl(audio,demo);
      if(ticket!==request.current)return;
      const position=firstTurn===null?undefined:audio.turn_offsets?.[String(firstTurn)];
      setOffset(typeof position==='number' && Number.isFinite(position) && position>=0?Math.max(0,position-3):null);setSource(url);
    } catch(error){if(ticket===request.current)setError(errorText(error));}
    finally {busyRef.current=false;if(ticket===request.current)setBusy(false);}
  }
  return <div id={`review-audio-${appealId}`} className="review-audio">{source&&<><label className="small">{t(demo?'Учебный звуковой сигнал, не запись разговора':'Запись спорного диалога')}</label><audio key={source} controls preload="metadata" src={source} onLoadedMetadata={event=>{if(offset!==null)event.currentTarget.currentTime=offset;}}/><p className="small muted">{t(offset===null?'Сервер не передал позицию фрагмента. Запись доступна целиком, без автовоспроизведения.':'Позиция соответствует основанию оценки, с отступом на 3 секунды. Автовоспроизведение отключено.')}</p></>}{error&&<p className="danger small" role="alert">{localizeMessage(error)}</p>}<button type="button" className="btn btn-small" data-review-audio={appealId} disabled={busy} aria-busy={busy} onClick={()=>void load()}>{t(busy?'Получаем свежую ссылку на запись…':source?'Обновить запись':'Прослушать фрагмент')}</button></div>;
}
