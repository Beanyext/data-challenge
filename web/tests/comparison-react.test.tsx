import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act} from 'react';
import {EvaluationComparison} from '../react/comparison';
import {setLocale} from '../react/i18n';
import type {Api, Checklist, Evaluation, EvaluationSummary} from '../react/types';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'http://127.0.0.1/'});
Object.assign(globalThis, {window:dom.window, document:dom.window.document, location:dom.window.location, HTMLElement:dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis, 'navigator', {value:dom.window.navigator, configurable:true});
const {createRoot} = await import('react-dom/client');
const checklist: Checklist = {id:'synthetic-checklist',version:1,name:'Вымышленный чек-лист',sections:[],criteria:[
  {id:'a',title:'Вымышленный критерий «Ә» & <тест>',description:'Synthetic rule',answer_type:'binary',weight:10},
  {id:'b',title:'Второе правило',description:'Synthetic rule',answer_type:'binary',weight:90},
]};
const evaluation = (id:string): Evaluation => ({id,conversation_id:'synthetic',checklist_id:checklist.id,checklist_version:1,checklist,model:'mock',total:id==='old'?0:10,criteria:[
  {criterion_id:'a',answer:id==='old'?'no':'yes',points:id==='old'?0:10,effective_weight:10,explanation:id==='old'?'Synthetic before':'Synthetic after',evidence:[{turn:0,quote:'Қазақша <img src=x onerror=unsafe()> & «тест»'}]},
  {criterion_id:'b',answer:'no',points:0,effective_weight:90,explanation:'Synthetic unchanged',evidence:[]},
]});
const summaries:EvaluationSummary[] = ['new','old'].map(id=>({id,status:'done',checklist_id:checklist.id,checklist_version:1,total:999,created_at:'2026-11-07T19:00:00Z'}));
const props = (load:(id:string)=>Promise<Evaluation>) => ({api:{demo:true,getEvaluation:load,evaluate:()=>{throw Error('No model calls allowed');}} as unknown as Api,conversationId:'synthetic',rows:summaries,
  record:{conversation_id:'synthetic',channel:'agent chat',language:'KZ',transcript:[{speaker:'operator',text:'Оригинал «Сұрақ» & <тест>.'}]},onOpen:()=>{},formatDate:()=>({iso:'2026-11-07T19:00:00.000Z',text:'08.11.2026 00:00'})});
async function mounted(element:React.ReactNode) {
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  await act(async()=>root.render(element));
  return {container,render:async(next:React.ReactNode)=>{await act(async()=>root.render(next));},close:async()=>{await act(async()=>root.unmount());container.remove();}};
}
async function compare(container:HTMLElement) {await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});}
async function change(select:HTMLSelectElement,value:string) {await act(async()=>{select.value=value;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});}

test('comparison is explicit GET-only, uses saved zero and shows proof beside the exact changed criterion', async()=>{
  setLocale('ru');const reads:string[]=[],opened:string[]=[];
  const p={...props(async id=>{reads.push(id);return evaluation(id);}),onOpen:(id:string)=>opened.push(id)};
  const view=await mounted(<EvaluationComparison {...p}/>);
  try {
    assert.deepEqual(reads,[]);assert.equal(view.container.querySelectorAll('.comparison-result').length,0);
    assert.match(view.container.querySelector('option')!.textContent!,/08.11.2026 00:00/);
    assert.match(view.container.querySelector('.comparison-choice')!.textContent!,/synthetic-checklist/);
    await compare(view.container);assert.deepEqual(reads,['old','new']);
    assert.match(view.container.querySelector('.comparison-summary')!.textContent!,/Изменено критериев: 1 из 2/);
    assert.match(view.container.querySelector('.comparison-summary')!.textContent!,/Разница баллов: \+10/);
    assert.match(view.container.querySelector('.comparison-run')!.textContent!,/Итог: 0/);assert.doesNotMatch(view.container.querySelector('.comparison-result')!.textContent!,/999/);
    assert.equal(view.container.querySelectorAll('[data-comparison-criterion]').length,2);
    await act(async()=>{(view.container.querySelector('.comparison-filter input') as HTMLInputElement).click();});
    assert.equal(view.container.querySelectorAll('[data-comparison-criterion]').length,1);assert.equal(view.container.querySelector('[data-comparison-criterion]')!.getAttribute('data-comparison-criterion'),'a');
    assert.match(view.container.querySelector('.comparison-evidence')!.textContent!,/Реплика № 1/);assert.match(view.container.querySelector('.comparison-evidence')!.textContent!,/Оригинал «Сұрақ» & <тест>/);
    assert.match(view.container.textContent!,/Қазақша <img/);assert.equal(view.container.querySelectorAll('img,script').length,0);
    await act(async()=>{(view.container.querySelector('.comparison-run button') as HTMLButtonElement).click();});assert.deepEqual(opened,['old']);assert.equal(reads.length,2);
    assert.match(view.container.textContent!,/Учебное сравнение/);
  } finally {await view.close();}
});

test('different versions cannot be selected together and one-run versions explain the missing pair',async()=>{
  const p=props(async id=>evaluation(id));
  const rows=[...summaries,{...summaries[0],id:'v2',checklist_version:2},{...summaries[0],id:'failed',status:'error'}];
  const view=await mounted(<EvaluationComparison {...p} rows={rows}/>);
  try {
    assert.equal(view.container.querySelectorAll('select')[0].querySelectorAll('option').length,3);
    assert.deepEqual([...view.container.querySelectorAll('select')[1].options].map(o=>o.value),['new']);
    await change(view.container.querySelectorAll('select')[0],'v2');
    assert.equal(view.container.querySelectorAll('select')[1].disabled,true);assert.equal(view.container.querySelector('button[type=submit]')!.hasAttribute('disabled'),true);
    await view.render(<EvaluationComparison {...p} rows={[rows[0],rows[2]]}/>);
    assert.match(view.container.textContent!,/Для сравнения нужны два завершённых запуска одной версии/);assert.equal(view.container.querySelectorAll('form').length,0);
  } finally {await view.close();}
});

test('request errors can be retried, identities and incompatible snapshots fail closed without exposing upstream text',async()=>{
  let mode='error';const p=props(async id=>{if(mode==='error')throw Error('https://private.example/?sig=never-render');const ev=evaluation(id);if(id==='new'&&mode==='foreign')ev.conversation_id='other';if(id==='new'&&mode==='snapshot')ev.checklist={...checklist,criteria:checklist.criteria.map(c=>({...c,weight:c.weight+1}))};return ev;});
  const view=await mounted(<EvaluationComparison {...p}/>);
  try {
    await compare(view.container);assert.match(view.container.textContent!,/Не удалось загрузить сравнение/);assert.doesNotMatch(view.container.textContent!,/never-render|private.example/);
    mode='foreign';await compare(view.container);assert.match(view.container.textContent!,/не относятся к выбранному диалогу/);assert.equal(view.container.querySelectorAll('.comparison-result').length,0);
    mode='snapshot';await compare(view.container);assert.match(view.container.textContent!,/Снимки правил отсутствуют или различаются/);
    mode='valid';await compare(view.container);assert.equal(view.container.querySelectorAll('.comparison-result').length,1);
  } finally {await view.close();}
});

test('late comparison response cannot replace a newly selected pair; missing answers have no total delta',async()=>{
  let resolve!:(value:Evaluation)=>void;const p=props(async id=>id==='old'?await new Promise(r=>{resolve=r;}):evaluation(id));
  const rows=[summaries[0],{...summaries[0],id:'third'},summaries[1]];
  const view=await mounted(<EvaluationComparison {...p} rows={rows}/>);
  try {
    await compare(view.container);assert.match(view.container.textContent!,/Загрузка сравнения/);
    await change(view.container.querySelectorAll('select')[0],'new');
    await act(async()=>resolve(evaluation('old')));assert.equal(view.container.querySelectorAll('.comparison-result').length,0);
    const partial=props(async id=>({...evaluation(id),criteria:id==='new'?evaluation(id).criteria.slice(0,1):evaluation(id).criteria}));
    await view.render(<EvaluationComparison {...partial}/>);await compare(view.container);
    assert.match(view.container.textContent!,/Есть неполные оценки/);assert.match(view.container.querySelector('.comparison-summary')!.textContent!,/Разница баллов: —/);
    assert.match(view.container.querySelector('[data-comparison-criterion=b]')!.textContent!,/Ответ отсутствует/);
  } finally {await view.close();}
});

for(const locale of ['en','kk'] as const)test(`comparison preserves selection and filter when locale changes to ${locale}`,async()=>{
  setLocale('ru');let reads=0;const p=props(async id=>{reads++;return evaluation(id);});
  const view=await mounted(<EvaluationComparison {...p}/>);
  try {
    await compare(view.container);await act(async()=>{(view.container.querySelector('.comparison-filter input') as HTMLInputElement).click();});
    setLocale(locale);await view.render(<EvaluationComparison {...p}/>);
    assert.equal(reads,2);assert.equal((view.container.querySelector('.comparison-filter input') as HTMLInputElement).checked,true);assert.equal(view.container.querySelectorAll('[data-comparison-criterion]').length,1);
    assert.match(view.container.querySelector('h3')!.textContent!,locale==='en'?/Compare evaluations/:/Бағалауларды салыстыру/);
    assert.doesNotMatch(view.container.querySelector('.comparison-controls')!.textContent!,/Первый запуск|Второй запуск|Сравнить оценки/);
    assert.match(view.container.querySelector('[data-comparison-criterion=a]')!.textContent!,/Вымышленный критерий/);
  } finally {setLocale('ru');await view.close();}
});
