import { useEffect, useRef, useState } from 'react';
import { compareChecklists } from '../checklist-diff.mjs';
import type { Api, Checklist, Criterion, Notify, Scale } from './types';
import { EmptyState, Icon, Modal, number } from './shared';
import { translate as t, localizeMessage } from './i18n';
import { errorText } from './runtime';

const key = (checklist: Checklist) => `${checklist.id}@${checklist.version}`;
const copy = <T,>(value: T): T => structuredClone(value);
type Change = { kind:string; title:string; field:string; label:string; before:string; after:string; criterion_id?:string };

export function parseScaleSteps(value: string): Scale {
  const steps=value.split('\n').filter(line=>line.trim()).map(line=>{
    const [raw,...description]=line.split('|');
    return {value:raw.trim()?Number(raw.trim()):Number.NaN,label:description.join('|').trim()};
  });
  return {min:steps.length?Math.min(...steps.map(step=>step.value)):0,max:steps.length?Math.max(...steps.map(step=>step.value)):Number.NaN,steps};
}

export function validateEditor(checklist: Checklist): string[] {
  const errors:string[]=[];
  if(!checklist.name.trim()) errors.push('Укажите название чек-листа.');
  if(!checklist.criteria.length) errors.push('Добавьте хотя бы один критерий.');
  const sectionIds=new Set(checklist.sections.map(section=>section.id));
  if(!checklist.sections.length || sectionIds.size!==checklist.sections.length || checklist.sections.some(section=>!section.id.trim() || !section.name?.trim())) errors.push('Разделы должны иметь уникальные ID и непустые названия.');
  if(new Set(checklist.criteria.map(criterion=>criterion.id)).size!==checklist.criteria.length || checklist.criteria.some(criterion=>!criterion.id.trim())) errors.push('Идентификаторы критериев должны быть непустыми и уникальными.');
  const codes=checklist.criteria.map(criterion=>criterion.code ?? criterion.id);
  if(new Set(codes).size!==codes.length)errors.push('Коды для выгрузки должны быть уникальными.');
  if(!Number.isInteger(checklist.rounding?.digits ?? 2) || (checklist.rounding?.digits ?? 2)<0 || (checklist.rounding?.digits ?? 2)>4)errors.push('Укажите от 0 до 4 знаков после запятой.');
  for(const criterion of checklist.criteria) {
    const prefix=`${criterion.id}: `;
    if(!/^[A-Za-z0-9_.-]{1,64}$/.test(criterion.code ?? criterion.id))errors.push(prefix+'Код для выгрузки: от 1 до 64 латинских букв, цифр, точек, дефисов или подчёркиваний.');
    if(!criterion.title.trim() || !criterion.description.trim())errors.push(prefix+'Нужны название и правило оценки.');
    if(!Number.isFinite(criterion.weight) || criterion.weight<0 || criterion.weight>100)errors.push(prefix+'Вес должен быть от 0 до 100.');
    if(!['binary','scale'].includes(criterion.answer_type))errors.push(prefix+'Неизвестный тип ответа.');
    if(!sectionIds.has(criterion.section_id || ''))errors.push(prefix+'Выберите существующий раздел.');
    if(criterion.na_allowed && !criterion.na_rule?.trim())errors.push(prefix+'Укажите условие N/A.');
    if(criterion.gross_error && (criterion.weight!==0 || criterion.answer_type!=='binary' || criterion.na_allowed))errors.push(prefix+'Грубое нарушение должно быть бинарным, без баллов и N/A.');
    if(criterion.answer_type==='scale') {
      const scale=criterion.scale;
      if(!scale?.steps.length || !Number.isFinite(scale.max) || scale.max<=0 || scale.max!==Math.max(...scale.steps.map(step=>step.value)) || scale.steps.some(step=>!Number.isFinite(step.value) || step.value<0 || !step.label.trim()) || new Set(scale.steps.map(step=>step.value)).size!==scale.steps.length)errors.push(prefix+'Проверьте ступени шкалы: нужны уникальные числа и описания, максимум больше нуля.');
    }
  }
  const weighted=checklist.criteria.filter(criterion=>!criterion.gross_error);
  if(weighted.length && weighted.every(criterion=>Number.isFinite(criterion.weight)) && weighted.reduce((sum,criterion)=>sum+criterion.weight,0)<=0)errors.push('Сумма весов оцениваемых критериев должна быть больше нуля.');
  return errors;
}

function editorError(message:string):string {
  const match=/^([^:]+): (.*)$/.exec(message);
  return match?`${match[1]}: ${t(match[2])}`:t(message);
}

function freshChecklist(): Checklist {
  return {id:`checklist-${Date.now()}`,version:1,name:t('Новый чек-лист'),rounding:{digits:2},guidance:[],sections:[{id:'s1',name:t('Общие критерии')}],criteria:[]};
}

function payloadOf(editor: Checklist): Checklist {
  const payload=copy(editor);
  payload.criteria.forEach(criterion=>delete criterion._stepsText);
  return payload;
}

interface Props {active:boolean;api:Api;checklists:Checklist[];onSaved:(saved:Checklist)=>void|Promise<void>;notify:Notify;onDirtyChange:(dirty:boolean)=>void}

export function ChecklistWorkspace({active,api,checklists,onSaved,notify,onDirtyChange}:Props) {
  const [editor,setEditor]=useState<Checklist|null>(()=>checklists[0]?copy(checklists[0]):null);
  const [base,setBase]=useState<Checklist|null>(()=>checklists[0]?copy(checklists[0]):null);
  const [criterionIndex,setCriterionIndex]=useState(0),[dirty,setDirty]=useState(false),[errors,setErrors]=useState<string[]>([]);
  const [preview,setPreview]=useState<{payload:Checklist;changes:Change[]}|null>(null),[saving,setSaving]=useState(false);
  const [sectionText,setSectionText]=useState<string|null>(null);
  const savingRef=useRef(false),mounted=useRef(true),errorArea=useRef<HTMLDivElement>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{onDirtyChange(dirty);},[dirty,onDirtyChange]);
  useEffect(()=>{
    if(savingRef.current || dirty)return;
    const current=checklists.find(item=>item.id===editor?.id) || (!editor?checklists[0]:undefined);
    if(current && (!editor || current.version>editor.version)){setEditor(copy(current));setBase(copy(current));setCriterionIndex(0);setSectionText(null);}
  },[checklists,dirty,editor]);

  function update(next:Checklist) {if(savingRef.current)return;setEditor(next);setDirty(true);setErrors([]);}
  function changeCriterion(field:keyof Criterion|'steps',value:string|boolean) {
    if(!editor)return;
    const next=copy(editor),criterion=next.criteria[criterionIndex];if(!criterion)return;
    if(field==='steps'){criterion._stepsText=String(value);criterion.scale=parseScaleSteps(String(value));}
    else if(field==='weight')criterion.weight=String(value).trim()?Number(value):Number.NaN;
    else if(field==='answer_type') {
      criterion.answer_type=value==='scale'?'scale':'binary';
      criterion.scale=criterion.answer_type==='scale'?{min:0,max:10,steps:[{value:0,label:t('Не выполнено')},{value:10,label:t('Выполнено')}]}:null;
      delete criterion._stepsText;
    } else if(field==='gross_error') {
      criterion.gross_error=Boolean(value);
      if(value){criterion.weight=0;criterion.answer_type='binary';criterion.scale=null;criterion.na_allowed=false;criterion.na_rule=null;delete criterion._stepsText;}
    } else if(field==='na_allowed') {criterion.na_allowed=Boolean(value);if(!value)criterion.na_rule=null;}
    else if(['code','title','description','section_id','na_rule','notes'].includes(field))(criterion as unknown as Record<string,unknown>)[field]=String(value);
    update(next);
  }
  function selectChecklist(value:string) {
    if(savingRef.current)return;
    if(dirty && !window.confirm(t('Отменить несохранённые изменения чек-листа?')))return;
    const selected=checklists.find(item=>key(item)===value);if(!selected)return;
    setEditor(copy(selected));setBase(copy(selected));setCriterionIndex(0);setDirty(false);setErrors([]);setSectionText(null);
  }
  function newChecklist() {
    if(dirty && !window.confirm(t('Отменить несохранённые изменения чек-листа?')))return;
    setEditor(freshChecklist());setBase(null);setCriterionIndex(0);setDirty(true);setErrors([]);setSectionText(null);
  }
  function addCriterion() {
    const next=copy(editor || freshChecklist()),ids=new Set(next.criteria.flatMap(criterion=>[criterion.id,criterion.code ?? criterion.id]));
    let index=next.criteria.length+1;while(ids.has(`c${String(index).padStart(2,'0')}`))index++;
    if(!next.sections.length)next.sections=[{id:'s1',name:t('Общие критерии')}];
    next.criteria.push({id:`c${String(index).padStart(2,'0')}`,code:`c${String(index).padStart(2,'0')}`,section_id:next.sections[0].id,title:t('Новый критерий'),description:'',answer_type:'binary',scale:null,weight:10,na_allowed:false,na_rule:null,notes:null,gross_error:false});
    setCriterionIndex(next.criteria.length-1);update(next);
  }
  function removeCriterion() {
    if(!editor || !window.confirm(t('Удалить критерий из этой версии? Сохранённые оценки останутся прежними.')))return;
    const next=copy(editor);next.criteria.splice(criterionIndex,1);setCriterionIndex(Math.max(0,criterionIndex-1));update(next);
  }
  function openPreview() {
    if(!editor || savingRef.current)return;
    const found=validateEditor(editor);setErrors(found);
    if(found.length){setTimeout(()=>errorArea.current?.scrollIntoView?.({block:'nearest'}),0);return;}
    const payload=payloadOf(editor),result=compareChecklists(base,payload);
    if(!result.changed){setDirty(false);notify(t('Изменений нет. Новая версия не требуется.'));return;}
    setPreview({payload,changes:result.changes});
  }
  async function save() {
    if(!preview || savingRef.current)return;
    savingRef.current=true;setSaving(true);
    try {
      const saved=await api.saveChecklist(copy(preview.payload));
      if(!saved?.id || !Number.isInteger(saved.version) || !Array.isArray(saved.criteria))throw new Error('Сервер вернул некорректный сохранённый чек-лист.');
      if(!mounted.current)return;
      setEditor(copy(saved));setBase(copy(saved));setCriterionIndex(index=>Math.min(index,Math.max(0,saved.criteria.length-1)));setDirty(false);setPreview(null);setErrors([]);setSectionText(null);
      await onSaved(saved);notify(t('Сохранена версия {version}. Повторная оценка использует новые правила.',{version:saved.version}));
    } catch(error){notify(localizeMessage(errorText(error)),true);}
    finally {savingRef.current=false;if(mounted.current)setSaving(false);}
  }
  if(!active)return null;
  if(!editor)return <section className="panel"><EmptyState title={t('Нет чек-листов')} text={t('Создайте первый чек-лист, чтобы настроить критерии оценки.')} actions={<button type="button" className="btn btn-primary" data-action="new-checklist" onClick={newChecklist}>{t('Новый чек-лист')}</button>}/></section>;
  const cl=editor,c=cl.criteria[criterionIndex],totalWeight=cl.criteria.filter(criterion=>!criterion.gross_error).reduce((sum,criterion)=>sum+criterion.weight,0);
  const sectionsValue=sectionText??cl.sections.map(section=>`${section.id} | ${section.name || ''}`).join('\n');
  return <>
    <div className="page-heading"><div><h1>{t('Чек-листы')}</h1><p>{t('Настройте правила оценки. Сохранённая версия применяется при следующей проверке.')}</p></div><div className="actions"><button type="button" className="btn" data-action="new-checklist" disabled={saving} onClick={newChecklist}>{t('Новый чек-лист')}</button><button type="button" className="btn btn-primary" data-action="save-checklist" disabled={saving} onClick={openPreview}>{t('Сохранить версию')} ↗</button></div></div>
    <fieldset className="react-editor-fieldset" disabled={saving}>
      <legend className="sr-only">{t('Настройки чек-листа')}</legend>
      <div className="editor-toolbar checklist-toolbar"><label>{t('Конфигурация')}<select id="choose-checklist" value={checklists.some(item=>key(item)===key(cl))?key(cl):''} onChange={event=>selectChecklist(event.target.value)}>{checklists.map(item=><option key={key(item)} value={key(item)}>{item.name} · v{item.version}</option>)}{!checklists.some(item=>key(item)===key(cl))&&<option value="">{cl.name} · v{cl.version}</option>}</select></label><div className="weight-total"><span>{t('Сумма весов')}</span><strong id="weight-total">{number(totalWeight)}</strong></div><span id="dirty-label" className={`badge ${dirty?'badge-amber':''}`}>{t(dirty?'Есть изменения':'Сохранено')}</span></div>
      <div className="editor-layout checklist-workbench"><aside className="panel checklist-navigation"><div className="panel-heading"><h2>{t('Критерии')}</h2><span className="badge">{cl.criteria.length}</span></div><div className="editor-list">{cl.criteria.map((item,index)=><button type="button" key={item.id} className={`editor-item ${index===criterionIndex?'active':''}`} data-criterion-index={index} aria-current={index===criterionIndex?'true':undefined} onClick={()=>setCriterionIndex(index)}><span className="editor-index">{String(index+1).padStart(2,'0')}</span><span><strong>{item.title}</strong><small>{item.gross_error?t('Грубая ошибка'):t('Вес {weight} · {type}',{weight:number(item.weight),type:t(item.answer_type==='scale'?'Шкала':'Да / Нет')})}</small></span></button>)}</div><div className="panel-body"><button type="button" className="btn" data-action="add-criterion" onClick={addCriterion}>＋ {t('Добавить критерий')}</button></div></aside>
      <section className="panel checklist-configuration"><div className="panel-body"><label>{t('Название чек-листа')}<input data-edit="name" value={cl.name} required maxLength={160} onChange={event=>update({...cl,name:event.target.value})}/></label>
        <details className="checklist-general"><summary>{t('Общие правила и разделы')}</summary><div className="field-grid"><label className="full">{t('Общие правила')}<textarea data-edit="guidance" value={(cl.guidance||[]).join('\n')} onChange={event=>update({...cl,guidance:event.target.value.split('\n')})}/><span className="muted small">{t('Одна инструкция на строку.')}</span></label><label className="full">{t('Разделы чек-листа')}<textarea data-edit="sections" value={sectionsValue} onChange={event=>{setSectionText(event.target.value);update({...cl,sections:event.target.value.split('\n').filter(line=>line.trim()).map(line=>{const [id,...name]=line.split('|');return {id:id.trim(),name:name.join('|').trim()};})});}}/><span className="muted small">{t('Одна строка: ID | название. ID используются в критериях.')}</span></label><label>{t('Знаков после запятой')}<input type="number" min="0" max="4" step="1" data-edit="digits" value={Number.isFinite(cl.rounding?.digits??2)?cl.rounding?.digits??2:''} onChange={event=>update({...cl,rounding:{digits:event.target.value.trim()?Number(event.target.value):Number.NaN}})}/></label></div></details>
        {c?<div className="criterion-editor" key={c.id}><div className="editor-title-row"><div><span className="editor-eyebrow">{c.id}</span><h2>{t('Настройка критерия')}</h2></div><button type="button" className="btn btn-small btn-ghost danger" data-action="remove-criterion" onClick={removeCriterion}>{t('Удалить критерий')}</button></div><div className="field-grid">
          <label className="full">{t('Код для выгрузки')}<input data-criterion="code" value={c.code ?? c.id} required maxLength={64} spellCheck={false} autoComplete="off" onChange={event=>changeCriterion('code',event.target.value)}/><span className="muted small">{t('Код критерия в файле результатов. Латинские буквы, цифры, точка, дефис или подчёркивание; код не должен повторяться.')}</span></label>
          <label className="full">{t('Название критерия')}<input data-criterion="title" value={c.title} required maxLength={200} onChange={event=>changeCriterion('title',event.target.value)}/></label>
          <label className="full">{t('Что считается выполнением')}<textarea data-criterion="description" value={c.description} required onChange={event=>changeCriterion('description',event.target.value)}/></label>
          <label>{t('Тип ответа')}<select data-criterion="answer_type" value={c.answer_type} disabled={Boolean(c.gross_error)} onChange={event=>changeCriterion('answer_type',event.target.value)}><option value="binary">{t('Да / Нет')}</option><option value="scale">{t('Числовая шкала')}</option></select></label>
          <label>{t('Вес критерия')}<input data-criterion="weight" type="number" min="0" max="100" step="0.1" value={Number.isFinite(c.weight)?c.weight:''} disabled={Boolean(c.gross_error)} onChange={event=>changeCriterion('weight',event.target.value)}/></label>
          <label className="full">{t('Раздел')}<select data-criterion="section_id" value={c.section_id || ''} onChange={event=>changeCriterion('section_id',event.target.value)}><option value="" disabled>{t('Выберите раздел')}</option>{cl.sections.map((section,index)=><option key={`${section.id}-${index}`} value={section.id}>{section.name || section.id}</option>)}</select></label>
          {c.answer_type==='scale'&&<div className="full editor-scale"><label>{t('Ступени шкалы')}<textarea data-criterion="steps" rows={6} value={c._stepsText??(c.scale?.steps||[]).map(step=>`${step.value} | ${step.label}`).join('\n')} placeholder={t('0 | Нет ответа\n10 | Полный ответ')} onChange={event=>changeCriterion('steps',event.target.value)}/><span className="muted small">{t('Одна ступень на строку: число | описание. Максимум шкалы определяется по наибольшему числу.')}</span></label><aside id="scale-preview" className="editor-scale-guide"><ScalePreview scale={c.scale}/></aside></div>}
          <label className="full editor-option"><input data-criterion="na_allowed" type="checkbox" checked={Boolean(c.na_allowed)} disabled={Boolean(c.gross_error)} onChange={event=>changeCriterion('na_allowed',event.target.checked)}/><span>{t('Разрешить ответ N/A')}</span></label>
          {c.na_allowed&&<label className="full">{t('Когда критерий неприменим')}<textarea data-criterion="na_rule" required value={c.na_rule||''} onChange={event=>changeCriterion('na_rule',event.target.value)}/></label>}
          <label className="full editor-option editor-option-critical"><input data-criterion="gross_error" type="checkbox" checked={Boolean(c.gross_error)} onChange={event=>changeCriterion('gross_error',event.target.checked)}/><span>{t('Грубое нарушение: отдельный флаг без баллов')}</span></label>
          <label className="full">{t('Пояснения для оценки')}<textarea data-criterion="notes" value={c.notes||''} onChange={event=>changeCriterion('notes',event.target.value)}/></label>
        </div></div>:<EmptyState title={t('Добавьте критерий')} text={t('Укажите название, правило, вес и допустимый тип ответа.')}/>}
        <div id="editor-errors" ref={errorArea} role="alert">{errors.length>0&&<div className="notice error rule">{errors.map((error,index)=><p key={index}>{editorError(error)}</p>)}</div>}</div>
      </div></section></div>
    </fieldset>
    {preview&&<Modal title={t('Проверить изменения')} wide busy={saving} onClose={()=>{if(!savingRef.current)setPreview(null);}}><p className="modal-description">{base?t('Исходная версия: {version}. Новая версия применяется к следующим оценкам.',{version:base.version}):t('Будет создан новый чек-лист.')}</p><ChecklistChanges changes={preview.changes} beforeChecklist={base} afterChecklist={preview.payload}/><form id="checklist-save-form" onSubmit={event=>{event.preventDefault();void save();}}><div className="form-actions"><button type="button" className="btn" disabled={saving} onClick={()=>setPreview(null)}>{t('Продолжить редактирование')}</button><button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving}>{t(saving?'Сохраняем…':'Сохранить новую версию')}</button></div></form></Modal>}
  </>;
}

function formattedScale(value:string):string {
  const [range,...levels]=value.split('\n'),match=/^От (.*?) до (.*?)$/.exec(range);
  return [match?t('От {min} до {max}',{min:match[1],max:match[2]}):range,...levels].join('\n');
}

function criterionSummary(criterion:Criterion):string {
  const scale=criterion.scale;
  const values:[string,string][]=[
    ['Код для выгрузки',criterion.code ?? criterion.id],['Название',criterion.title],['Правило оценки',criterion.description],['Вес',number(criterion.weight)],
    ['Тип ответа',t(criterion.answer_type==='scale'?'Числовая шкала':'Да / Нет')],
    ['Шкала',scale?[t('От {min} до {max}',{min:number(scale.min),max:number(scale.max)}),...scale.steps.map(step=>`${number(step.value)} | ${step.label}`)].join('\n'):'—'],
    ['Допустимость N/A',t(criterion.na_allowed?'Да':'Нет')],['Условие N/A',criterion.na_rule||'—'],
    ['Пояснения',criterion.notes||'—'],['Грубое нарушение',t(criterion.gross_error?'Да':'Нет')],['Раздел',criterion.section_id||'—'],
  ];
  return values.map(([name,value])=>`${t(name)}: ${value || '—'}`).join('\n');
}

function changeValue(change:Change,side:'before'|'after',checklist?:Checklist|null):string {
  const value=change[side];
  if(['na_allowed','gross_error','answer_type'].includes(change.field))return t(value);
  if(change.field==='scale')return formattedScale(value);
  if(change.field==='rounding')return value.replace(/^Знаков после запятой:/gm,`${t('Знаков после запятой')}:`);
  if(change.field==='criterion') {
    const criterion=checklist?.criteria.find(item=>item.id===change.criterion_id);
    if(criterion)return criterionSummary(criterion);
  }
  return value;
}

export function ChecklistChanges({changes,beforeChecklist,afterChecklist}:{changes:Change[];beforeChecklist?:Checklist|null;afterChecklist?:Checklist|null}) {
  return <div className="diff-list" role="region" aria-label={t('Изменения чек-листа')}>{[['added','Добавлено'],['removed','Удалено'],['changed','Изменено']].map(([kind,title])=>{
    const group=changes.filter(change=>change.kind===kind);return group.length?<section key={kind}><h3>{t(title)} · {group.length}</h3>{group.map((change,index)=><article className="diff-item" key={`${change.criterion_id||''}-${change.field}-${index}`}><h4>{['name','guidance','sections','rounding'].includes(change.field)?t('Настройки чек-листа'):change.field==='criteria_order'?t('Порядок критериев'):change.title}</h4><p>{t(change.label)}{change.criterion_id?` · ${change.criterion_id}`:''}</p><div className="diff-before"><strong>{t('Было')}</strong><p>{changeValue(change,'before',beforeChecklist)}</p></div><div className="diff-after"><strong>{t('Станет')}</strong><p>{changeValue(change,'after',afterChecklist)}</p></div></article>)}</section>:null;
  })}</div>;
}

export function ScalePreview({scale}:{scale?:Scale|null}) {
  const steps=scale?.steps||[];
  if(!steps.length)return <div className="scale-preview-empty"><strong>{t('Предпросмотр шкалы')}</strong><p>{t('Добавьте ступени в поле «Ступени шкалы». Здесь появятся баллы и условия.')}</p></div>;
  return <><table><caption>{t('Предпросмотр шкалы')}</caption><thead><tr><th>{t('Балл')}</th><th>{t('Условие')}</th></tr></thead><tbody>{steps.map((step,index)=><tr key={index}><td>{Number.isFinite(step.value)?number(step.value):t('Проверьте число')}</td><td>{step.label || t('Добавьте описание')}</td></tr>)}</tbody></table><p>{t('Текущие ступени из поля «Ступени шкалы».')}</p></>;
}
