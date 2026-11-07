import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChecklistWorkspace, ChecklistChanges, parseScaleSteps, validateEditor } from '../react/forms';
import { AppealsWorkspace, readReviewContext, ReviewForm } from '../react/review';
import { setLocale } from '../react/i18n';
import { compareChecklists } from '../checklist-diff.mjs';
import type { Api, Appeal, Checklist, DialogRecord, Evaluation } from '../react/types';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1:8765/'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,HTMLElement:dom.window.HTMLElement,HTMLDialogElement:dom.window.HTMLDialogElement,HTMLInputElement:dom.window.HTMLInputElement,HTMLTextAreaElement:dom.window.HTMLTextAreaElement,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
dom.window.HTMLElement.prototype.scrollIntoView=function(){};
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
dom.window.confirm=()=>true;
const {createRoot}=await import('react-dom/client');
setLocale('ru');
const clone=<T,>(value:T):T=>structuredClone(value);

function fixture() {
  const checklist:Checklist={id:'cl',version:1,name:'Вымышленный чек-лист',rounding:{digits:2},guidance:[],sections:[{id:'s1',name:'Контакт'}],criteria:[{id:'c01',section_id:'s1',title:'Приветствие',description:'Проверяется вымышленный ответ.',answer_type:'binary',weight:100,na_allowed:false,gross_error:false,scale:null}]};
  const record:DialogRecord={conversation_id:'synthetic-review',title:'Вымышленный диалог',channel:'agent chat',language:'RU',evaluation_id:'ev',transcript:[{speaker:'bot',text:'Вымышленный бот.'},{speaker:'client',text:'Вымышленный вопрос.'},{speaker:'operator',text:'Вымышленный ответ.'},{speaker:'system',text:'Вымышленное событие.'}]};
  const evaluation:Evaluation={id:'ev',conversation_id:record.conversation_id,checklist_id:'cl',checklist_version:1,checklist:clone(checklist),total:100,criteria:[{criterion_id:'c01',answer:'yes',explanation:'Вымышленное объяснение.',evidence:[{turn:2,quote:'Другой текст цитаты не заменяет оригинал.'}]}]};
  const appeal:Appeal={id:'appeal-1',evaluation_id:'ev',conversation_id:record.conversation_id,criterion_id:'c01',criterion_title:'Приветствие',comment:'Вымышленная апелляция.',status:'open'};
  const calls={save:[] as Checklist[],decisions:[] as unknown[],getDialog:0};
  const api={demo:true,getEvaluation:async()=>clone(evaluation),getDialog:async()=>{calls.getDialog++;return clone(record);},getAudio:async()=>({url:'data:audio/wav;base64,UklGRg==',turn_offsets:{'2':12}}),saveChecklist:async(payload:Checklist)=>{calls.save.push(clone(payload));return {...clone(payload),version:2};},decideAppeal:async(id:string,payload:unknown)=>{calls.decisions.push({id,payload});return {...appeal,status:'changed'};}} as unknown as Api;
  return {checklist,record,evaluation,appeal,api,calls};
}

async function mounted(element:React.ReactNode) {
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  await act(async()=>{root.render(element);});
  return {container,render:async(next:React.ReactNode)=>{await act(async()=>{root.render(next);});},close:async()=>{await act(async()=>{root.unmount();});container.remove();}};
}
async function click(element:Element|null) {assert.ok(element,'Expected an interactive element');await act(async()=>{(element as HTMLElement).click();});}
async function fill(element:Element|null,value:string) {
  assert.ok(element,'Expected an input');
  await act(async()=>{
    const input=element as HTMLInputElement|HTMLTextAreaElement;
    const prototype=input.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(input,value);
    input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  });
}
async function submit(form:Element|null) {assert.ok(form);await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});}

test('editor validates empty input, raw incomplete scales, duplicate levels and relative weights',()=>{
  const {checklist}=fixture();assert.deepEqual(validateEditor(checklist),[]);
  const empty=clone(checklist);empty.name='';empty.criteria=[];assert.ok(validateEditor(empty).length>=2);
  const scale=parseScaleSteps('0 | Нет\n4 | Частично\n7 | Хорошо\n10 | Полностью');assert.equal(scale.max,10);assert.equal(scale.steps[2].value,7);
  const next=clone(checklist);next.criteria[0].answer_type='scale';next.criteria[0].scale=parseScaleSteps('0 | Нет\n4 | ');assert.ok(validateEditor(next).some(message=>message.includes('ступени')));
  next.criteria[0].scale=parseScaleSteps('0 | Нет\n4 | Частично\n4 | Повтор');assert.ok(validateEditor(next).some(message=>message.includes('ступени')));
  next.criteria[0].scale=parseScaleSteps(' | Нет');assert.ok(Number.isNaN(next.criteria[0].scale.steps[0].value));
  const relative=clone(checklist);relative.criteria.push({...clone(relative.criteria[0]),id:'c02',weight:10});assert.deepEqual(validateEditor(relative),[]);
  const zero=clone(checklist);zero.criteria[0].weight=0;assert.ok(validateEditor(zero).some(message=>message.includes('Сумма')));
  const brokenSection=clone(checklist);brokenSection.criteria[0].section_id='missing';assert.ok(validateEditor(brokenSection).some(message=>message.includes('раздел')));
});

test('checklist diff renders server and user strings as text, including Cyrillic and markup',()=>{
  const html=renderToStaticMarkup(<ChecklistChanges changes={[{kind:'changed',field:'title',label:'Название',title:'Критерий «Тест» & <img src=x>',before:'<script>unsafe()</script>',after:'Новое & значение'}]}/>);
  const parsed=new JSDOM(html).window.document;
  assert.equal(parsed.querySelectorAll('script,img').length,0);
  assert.match(parsed.querySelector('.diff-before')!.textContent!,/<script>unsafe\(\)<\/script>/);
  assert.match(parsed.querySelector('.diff-after')!.textContent!,/Новое & значение/);
});

for(const locale of ['en','kk'] as const)test(`${locale} checklist diff localizes scale, rounding and criterion metadata while retaining user text`,()=>{
  const {checklist}=fixture(),before=clone(checklist),after=clone(checklist);
  before.criteria.push({...clone(before.criteria[0]),id:'removed',title:'Удалённое русское название',description:'Старое пользовательское правило.'});
  after.rounding={digits:3};
  after.criteria[0].answer_type='scale';after.criteria[0].scale={min:0,max:10,steps:[{value:0,label:'Русский ноль'},{value:10,label:'Русский максимум'}]};
  after.criteria.push({...clone(after.criteria[0]),id:'custom-added-ID',title:'Не переводить название «Да»',description:'Пользовательский текст\nВес: не переводить эту строку',na_allowed:true,na_rule:'Русское условие N/A',notes:'Русское пояснение'});
  const diff=compareChecklists(before,after);
  try {
    setLocale(locale);
    const parsed=new JSDOM(renderToStaticMarkup(<ChecklistChanges changes={diff.changes} beforeChecklist={before} afterChecklist={after}/>)).window.document;
    const text=parsed.body.textContent || '';
    assert.ok(text.includes(locale==='en'?'From 0 to 10':'0 бастап 10 дейін'));
    const changedScale=[...parsed.querySelectorAll('.diff-item')].find(article=>article.querySelector('h4')?.textContent==='Приветствие' && article.querySelector(':scope > p')?.textContent?.startsWith(locale==='en'?'Scale':'Шкала'))!;
    assert.ok(changedScale.querySelector('.diff-after p')!.textContent!.startsWith(locale==='en'?'From 0 to 10':'0 бастап 10 дейін'));
    assert.ok(text.includes(locale==='en'?'Decimal places: 3':'Үтірден кейінгі таңбалар: 3'));
    assert.ok(text.includes('Русский ноль') && text.includes('Русский максимум'));
    const added=[...parsed.querySelectorAll('.diff-item')].find(article=>article.querySelector('h4')?.textContent==='Не переводить название «Да»')!;
    const summary=added.querySelector('.diff-after p')!.textContent || '';
    assert.ok(summary.includes(locale==='en'?'Name: Не переводить название «Да»':'Атауы: Не переводить название «Да»'));
    assert.ok(summary.includes(locale==='en'?'Evaluation rule: Пользовательский текст':'Бағалау ережесі: Пользовательский текст'));
    assert.ok(summary.includes('Вес: не переводить эту строку'));
    assert.ok(summary.includes(locale==='en'?'Answer type: Numeric scale':'Жауап түрі: Сандық шкала'));
    assert.ok(summary.includes(locale==='en'?'N/A availability: Yes':'N/A қолжетімділігі: Иә'));
    assert.ok(summary.includes(locale==='en'?'Section: s1':'Бөлім: s1'));
    assert.ok(added.textContent!.includes('custom-added-ID'));
    const removed=[...parsed.querySelectorAll('.diff-item')].find(article=>article.querySelector('h4')?.textContent==='Удалённое русское название')!;
    assert.ok(removed.querySelector('.diff-before p')!.textContent!.includes(locale==='en'?'Name: Удалённое русское название':'Атауы: Удалённое русское название'));
  } finally {setLocale('ru');}
});

test('editor previews before POST, preserves cancelled edits, guards duplicate slow saves and retains server identity',async()=>{
  const data=fixture(),notifications:string[]=[],saved:Checklist[]=[];let release!:(value:Checklist)=>void;
  data.api.saveChecklist=async payload=>{data.calls.save.push(clone(payload));return await new Promise<Checklist>(resolve=>{release=resolve;});};
  const view=await mounted(<ChecklistWorkspace active api={data.api} checklists={[data.checklist]} onSaved={checklist=>{saved.push(checklist);}} notify={message=>notifications.push(message)} onDirtyChange={()=>{}}/>);
  try {
    await click(view.container.querySelector('[data-action=save-checklist]'));assert.equal(data.calls.save.length,0);assert.match(notifications.at(-1)!,/Изменений нет/);
    await fill(view.container.querySelector('[data-criterion=weight]'),'12');await click(view.container.querySelector('[data-action=save-checklist]'));
    assert.ok(view.container.querySelector('#checklist-save-form'));assert.match(view.container.querySelector('.diff-before')!.textContent!,/100/);assert.match(view.container.querySelector('.diff-after')!.textContent!,/12/);assert.equal(data.calls.save.length,0);
    await click([...view.container.querySelectorAll('button')].find(button=>button.textContent==='Продолжить редактирование')!);assert.equal((view.container.querySelector('[data-criterion=weight]') as HTMLInputElement).value,'12');
    await click(view.container.querySelector('[data-action=save-checklist]'));await submit(view.container.querySelector('#checklist-save-form'));await submit(view.container.querySelector('#checklist-save-form'));
    assert.equal(data.calls.save.length,1);assert.equal(view.container.querySelector<HTMLFieldSetElement>('.react-editor-fieldset')!.disabled,true);assert.equal(view.container.querySelector<HTMLButtonElement>('[data-action=close-modal]')!.disabled,true);
    await act(async()=>{release({...clone(data.calls.save[0]),id:'server-assigned',version:7});});
    assert.equal(saved[0].id,'server-assigned');assert.equal(saved[0].version,7);assert.match(view.container.querySelector('#choose-checklist')!.textContent!,/v7/);assert.equal(view.container.querySelector('#checklist-save-form'),null);assert.match(view.container.querySelector('#dirty-label')!.textContent!,/Сохранено/);
  } finally {await view.close();}
});

test('editor keeps raw unfinished input through route changes and rejects empty names without POST',async()=>{
  const data=fixture();const props={api:data.api,checklists:[data.checklist],onSaved:()=>{},notify:()=>{},onDirtyChange:()=>{}};
  const view=await mounted(<ChecklistWorkspace {...props} active/>);
  try {
    const select=view.container.querySelector<HTMLSelectElement>('[data-criterion=answer_type]')!;
    await act(async()=>{select.value='scale';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    const raw='0 | Нет\n4 | ';await fill(view.container.querySelector('[data-criterion=steps]'),raw);
    await view.render(<ChecklistWorkspace {...props} active={false}/>);assert.equal(view.container.textContent,'');await view.render(<ChecklistWorkspace {...props} active/>);
    assert.equal(view.container.querySelector<HTMLTextAreaElement>('[data-criterion=steps]')!.value,raw);
    await fill(view.container.querySelector('[data-edit=name]'),'');await click(view.container.querySelector('[data-action=save-checklist]'));
    assert.equal(data.calls.save.length,0);assert.match(view.container.querySelector('#editor-errors')!.textContent!,/название чек-листа/);assert.match(view.container.querySelector('#editor-errors')!.textContent!,/ступени/);
  } finally {await view.close();}
});

test('review requires exact historical checklist and uses actual transcript turns with a positive control',async()=>{
  const data=fixture();const context=await readReviewContext(data.api,data.appeal,[data.checklist],[data.record]);
  assert.equal(context.criterion.title,'Приветствие');assert.deepEqual(context.excerpt.turns.map(turn=>turn.index),[1,2,3]);assert.equal(context.excerpt.turns[1].text,'Вымышленный ответ.');
  delete data.evaluation.checklist;const latest={...clone(data.checklist),version:2,criteria:[{...clone(data.checklist.criteria[0]),title:'Другое правило v2'}]};
  data.calls.getDialog=0;await assert.rejects(readReviewContext(data.api,data.appeal,[latest],[data.record]),/исходный критерий/);assert.equal(data.calls.getDialog,0);
  data.evaluation.checklist=latest;await assert.rejects(readReviewContext(data.api,data.appeal,[latest],[data.record]),/исходный критерий/);
});

test('review retains reason, answer and original context through active route transitions; explicit cancel clears draft',async()=>{
  const data=fixture(),dirty:boolean[]=[],opened:string[]=[];
  const props={api:data.api,appeals:[data.appeal],checklists:[data.checklist],rows:[data.record],onSaved:()=>{},onOpenDialog:(id:string)=>opened.push(id),notify:()=>{},onDirtyChange:(value:boolean)=>dirty.push(value),demo:true};
  const view=await mounted(<AppealsWorkspace {...props} active/>);
  try {
    await click(view.container.querySelector('[data-review]'));assert.equal(view.container.querySelectorAll('.review-transcript .turn').length,3);
    const reason='Черновик «Тест» & <script>unsafe()</script>';await fill(view.container.querySelector('[name=reason]'),reason);await click(view.container.querySelector('[name=decision-status][value=changed]'));
    const answer=view.container.querySelector<HTMLSelectElement>('[name=answer]')!;await act(async()=>{answer.value='no';answer.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    await click([...view.container.querySelectorAll('button')].find(button=>button.textContent?.includes('Открыть полный диалог'))!);assert.deepEqual(opened,[data.record.conversation_id]);
    await view.render(<AppealsWorkspace {...props} active={false}/>);await view.render(<AppealsWorkspace {...props} active/>);await click(view.container.querySelector('[data-review]'));
    assert.equal(view.container.querySelector<HTMLTextAreaElement>('[name=reason]')!.value,reason);assert.equal(view.container.querySelector<HTMLSelectElement>('[name=answer]')!.value,'no');assert.equal(view.container.querySelectorAll('script').length,0);assert.equal(dirty.at(-1),true);
    await click(view.container.querySelector('[data-cancel-review]'));await click(view.container.querySelector('[data-review]'));assert.equal(view.container.querySelector<HTMLTextAreaElement>('[name=reason]')!.value,'');assert.equal(dirty.at(-1),false);
  } finally {await view.close();}
});

test('decision requires a reason, submits the selected native answer once and guards fields while saving',async()=>{
  const data=fixture(),notifications:string[]=[];let release!:(value:Appeal)=>void;let saved=0;
  data.api.decideAppeal=async(id,payload)=>{data.calls.decisions.push({id,payload});return await new Promise<Appeal>(resolve=>{release=resolve;});};
  const view=await mounted(<AppealsWorkspace active api={data.api} appeals={[data.appeal]} checklists={[data.checklist]} rows={[data.record]} onSaved={()=>{saved++;}} onOpenDialog={()=>{}} notify={message=>notifications.push(message)} onDirtyChange={()=>{}} demo/>);
  try {
    await click(view.container.querySelector('[data-review]'));await submit(view.container.querySelector('form[data-decision]'));assert.equal(data.calls.decisions.length,0);assert.match(notifications.at(-1)!,/причину/);
    await click(view.container.querySelector('[name=decision-status][value=changed]'));const answer=view.container.querySelector<HTMLSelectElement>('[name=answer]')!;await act(async()=>{answer.value='no';answer.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});await fill(view.container.querySelector('[name=reason]'),'Проверено по исходной вымышленной реплике.');
    await submit(view.container.querySelector('form[data-decision]'));await submit(view.container.querySelector('form[data-decision]'));
    assert.equal(data.calls.decisions.length,1);assert.deepEqual(data.calls.decisions[0],{id:data.appeal.id,payload:{answer:'no',reason:'Проверено по исходной вымышленной реплике.',status:'changed'}});assert.equal(view.container.querySelector<HTMLTextAreaElement>('[name=reason]')!.disabled,true);
    await act(async()=>{release({...data.appeal,status:'changed'});});assert.equal(saved,1);assert.equal(view.container.querySelector('form[data-decision]'),null);
  } finally {await view.close();}
});

test('review audio loads a fresh demo source and seeks to evidence without autoplay',async()=>{
  const data=fixture();data.record.channel='voice call';const context=await readReviewContext(data.api,data.appeal,[data.checklist],[data.record]);
  const view=await mounted(<ReviewForm appeal={data.appeal} context={context} draft={{status:'confirmed',answer:'yes',reason:''}} busy={false} api={data.api} demo onChange={()=>{}} onSave={()=>{}} onCancel={()=>{}} onOpenDialog={()=>{}}/>);
  try {
    await click(view.container.querySelector('[data-review-audio]'));const audio=view.container.querySelector('audio')!;assert.ok(audio);assert.equal(audio.autoplay,false);assert.match(audio.src,/^data:audio\/wav/);
    await act(async()=>{audio.dispatchEvent(new dom.window.Event('loadedmetadata',{bubbles:true}));});assert.equal(audio.currentTime,9);
  } finally {await view.close();}
});

test('a review closed by refreshed server state becomes read-only and clears its unsaved decision draft',async()=>{
  const data=fixture(),dirty:boolean[]=[];
  const props={api:data.api,checklists:[data.checklist],rows:[data.record],onSaved:()=>{},onOpenDialog:()=>{},notify:()=>{},onDirtyChange:(value:boolean)=>dirty.push(value),demo:true};
  const view=await mounted(<AppealsWorkspace {...props} appeals={[data.appeal]} active/>);
  try {
    await click(view.container.querySelector('[data-review]'));await fill(view.container.querySelector('[name=reason]'),'Несохранённый вымышленный черновик.');assert.equal(dirty.at(-1),true);
    await view.render(<AppealsWorkspace {...props} appeals={[{...data.appeal,status:'confirmed',decision:{answer:'yes',reason:'Уже рассмотрено.'}}]} active/>);
    await click(view.container.querySelector('[data-appeal-filter=all]'));
    assert.equal(view.container.querySelector('form[data-decision]'),null);assert.equal(view.container.querySelector('[data-review]'),null);assert.equal(dirty.at(-1),false);assert.match(view.container.textContent!,/Уже рассмотрено/);
  } finally {await view.close();}
});


test('editor previews and saves an export code-only change without replacing criterion identity',async()=>{
  const data=fixture(),saved:Checklist[]=[];
  const view=await mounted(<ChecklistWorkspace active api={data.api} checklists={[data.checklist]} onSaved={checklist=>{saved.push(checklist);}} notify={()=>{}} onDirtyChange={()=>{}}/>);
  try {
    assert.equal(view.container.querySelector<HTMLInputElement>('[data-criterion=code]')!.value,'c01','legacy code defaults to criterion ID');
    await fill(view.container.querySelector('[data-criterion=code]'),'understanding_v2.test-1');
    await click(view.container.querySelector('[data-action=save-checklist]'));
    assert.equal(view.container.querySelectorAll('.diff-item').length,1);
    assert.match(view.container.querySelector('.diff-before')!.textContent!,/c01/);
    assert.match(view.container.querySelector('.diff-after')!.textContent!,/understanding_v2.test-1/);
    await submit(view.container.querySelector('#checklist-save-form'));
    assert.equal(data.calls.save.length,1);
    assert.equal(data.calls.save[0].criteria[0].id,'c01');
    assert.equal(saved[0].criteria[0].code,'understanding_v2.test-1');
    assert.equal(saved[0].criteria[0].description,data.checklist.criteria[0].description);
  } finally {await view.close();}
});

test('editor creates a criterion with its own export code and preserves Cyrillic and special content',async()=>{
  const data=fixture();
  const view=await mounted(<ChecklistWorkspace active api={data.api} checklists={[data.checklist]} onSaved={()=>{}} notify={()=>{}} onDirtyChange={()=>{}}/>);
  try {
    await click(view.container.querySelector('[data-action=add-criterion]'));
    assert.equal(view.container.querySelector<HTMLInputElement>('[data-criterion=code]')!.value,'c02');
    await fill(view.container.querySelector('[data-criterion=code]'),'understanding');
    const title='Түсіну «Проверка» & <img src=x>';
    const description='Оператор түсінгенін тексерді. Кириллица & <script>тест</script>';
    await fill(view.container.querySelector('[data-criterion=title]'),title);
    await fill(view.container.querySelector('[data-criterion=description]'),description);
    await click(view.container.querySelector('[data-action=save-checklist]'));
    assert.equal(view.container.querySelectorAll('.diff-item img,.diff-item script').length,0);
    assert.match(view.container.querySelector('.diff-after')!.textContent!,/Код для выгрузки: understanding/);
    await submit(view.container.querySelector('#checklist-save-form'));
    const added=data.calls.save[0].criteria[1];
    assert.equal(added.id,'c02');assert.equal(added.code,'understanding');
    assert.equal(added.title,title);assert.equal(added.description,description);
  } finally {await view.close();}
});

test('editor rejects blank, duplicate and non-server export codes without sending a save',async()=>{
  const data=fixture();data.checklist.criteria[0].code='contact';
  data.checklist.criteria.push({...clone(data.checklist.criteria[0]),id:'c02',code:'discovery'});
  const view=await mounted(<ChecklistWorkspace active api={data.api} checklists={[data.checklist]} onSaved={()=>{}} notify={()=>{}} onDirtyChange={()=>{}}/>);
  try {
    for(const code of ['', ' ', 'discovery', 'понимание', 'understanding&bad', '<img src=x>', 'x'.repeat(65)]) {
      await fill(view.container.querySelector('[data-criterion=code]'),code);
      await click(view.container.querySelector('[data-action=save-checklist]'));
      assert.equal(data.calls.save.length,0,code);
      assert.equal(view.container.querySelector('#checklist-save-form'),null,code);
      assert.match(view.container.querySelector('#editor-errors')!.textContent!,/Код|Коды/,code);
      assert.equal(view.container.querySelectorAll('#editor-errors img').length,0);
    }
  } finally {await view.close();}
});

for(const locale of ['en','kk'] as const)test(`${locale} criterion export code label and help are translated`,()=>{
  const data=fixture();
  try {
    setLocale(locale);
    const document=new JSDOM(renderToStaticMarkup(<ChecklistWorkspace active api={data.api} checklists={[data.checklist]} onSaved={()=>{}} notify={()=>{}} onDirtyChange={()=>{}}/>)).window.document;
    const label=document.querySelector('[data-criterion=code]')!.closest('label')!;
    assert.match(label.textContent!,locale==='en'?/Export code/:/Экспорт коды/);
    assert.doesNotMatch(label.textContent!,/Код для выгрузки|Код критерия/);
  } finally {setLocale('ru');}
});


test('human reviewer can recover a missing model answer only with an explicit valid answer and reason',async()=>{
  const data=fixture(),notifications:string[]=[];
  Object.assign(data.evaluation.criteria[0],{answer:null,needs_review:true,problems:['Некорректный ответ модели.']});
  const context=await readReviewContext(data.api,data.appeal,[data.checklist],[data.record]);
  assert.equal(context.item.answer,null);
  const view=await mounted(<AppealsWorkspace active api={data.api} appeals={[data.appeal]} checklists={[data.checklist]} rows={[data.record]} onSaved={()=>{}} onOpenDialog={()=>{}} notify={message=>notifications.push(message)} onDirtyChange={()=>{}} demo/>);
  try {
    await click(view.container.querySelector('[data-review]'));
    const confirm=view.container.querySelector<HTMLInputElement>('[name=decision-status][value=confirmed]')!;
    assert.equal(confirm.disabled,true);
    assert.equal(view.container.querySelector<HTMLInputElement>('[name=decision-status][value=changed]')!.checked,true);
    const answer=view.container.querySelector<HTMLSelectElement>('[name=answer]')!;
    assert.equal(answer.value,'');assert.equal(answer.disabled,false);assert.equal(answer.required,true);
    assert.match(view.container.textContent!,/Ответ не получен/);
    await fill(view.container.querySelector('[name=reason]'),'Проверено по вымышленному диалогу.');
    await submit(view.container.querySelector('form[data-decision]'));assert.equal(data.calls.decisions.length,0);
    assert.match(notifications.at(-1)!,/допустимый ответ/);
    await act(async()=>{answer.value='no';answer.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    await submit(view.container.querySelector('form[data-decision]'));
    assert.deepEqual(data.calls.decisions,[{id:data.appeal.id,payload:{answer:'no',reason:'Проверено по вымышленному диалогу.',status:'changed'}}]);
  }finally{await view.close();}
  Object.assign(data.evaluation.criteria[0],{answer:null,needs_review:false});
  await assert.rejects(readReviewContext(data.api,data.appeal,[data.checklist],[data.record]),/исходный критерий/);
});
