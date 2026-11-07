import test from 'node:test';
import assert from 'node:assert/strict';
import { useState, act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { DialogsWorkspace, DialogWorkspace } from '../react/pages';
import { EvaluationView } from '../react/result';
import { workflowMessages } from '../react/messages/workflow';
import { setLocale } from '../react/i18n';
import type { Answer, Api, Appeal, Checklist, DialogRecord, Evaluation, ListState } from '../react/types';

const rows:DialogRecord[]=[
  {conversation_id:'ru-zero',language:'RU',channel:'agent chat',title:'Вымышленный нулевой результат',evaluation_id:'e-zero',total:0,status:'completed'},
  {conversation_id:'kz-na',language:'KZ',channel:'agent chat',title:'Вымышленный N/A',evaluation_id:'e-na',total:null,status:'completed',needs_review:true},
  {conversation_id:'ru-critical',language:'RU',channel:'voice call',title:'Вымышленное нарушение',evaluation_id:'e-critical',total:80,status:'completed',gross_error:true},
];
const appeals:Appeal[]=[{id:'a-zero',evaluation_id:'e-zero',conversation_id:'ru-zero',criterion_id:'c01',status:'open',comment:'Вымышленный комментарий.'}];
const blankState=():ListState=>({filters:{query:'',channel:'',language:'',status:''},queue:'all',summaryScope:'filtered',selected:new Set()});
const noop=()=>{};

async function mount() {
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://127.0.0.1:8765/?demo=1'});
  const globals=['window','document','navigator','HTMLElement','Element','Node','localStorage','location','IS_REACT_ACT_ENVIRONMENT'];
  const before=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const key of globals)Object.defineProperty(globalThis,key,{value:key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='window'?dom.window:(dom.window as unknown as Record<string,unknown>)[key],configurable:true,writable:true});
  dom.window.matchMedia=(()=>({matches:true,addEventListener:noop,removeEventListener:noop})) as typeof window.matchMedia;
  dom.window.HTMLElement.prototype.scrollIntoView=noop;
  const root=createRoot(dom.window.document.getElementById('root')!);
  const document=dom.window.document;
  return {dom,root,document,async close(){await act(async()=>root.unmount());for(const key of globals){const descriptor=before.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}dom.window.close();setLocale('ru');}};
}

test('React list follows filters and attention queue while preserving offscreen selection',async()=>{
  const view=await mount(),evaluated:string[][]=[];
  function Harness({busy=false}:{busy?:boolean}) {
    const [state,onState]=useState(blankState);
    return <DialogsWorkspace rows={rows} appeals={appeals} state={state} onState={onState} busy={busy} onEvaluate={ids=>evaluated.push(ids)} onOpenDialog={noop} onImport={noop} onUpload={noop} onSubmission={noop}/>;
  }
  const change=async(selector:string,value:string)=>act(async()=>{const input=view.document.querySelector<HTMLSelectElement>(selector)!;input.value=value;input.dispatchEvent(new view.dom.window.Event('change',{bubbles:true}));});
  const click=async(selector:string)=>act(async()=>view.document.querySelector<HTMLElement>(selector)!.click());
  try {
    await act(async()=>view.root.render(<Harness/>));
    assert.deepEqual([...view.document.querySelectorAll('.stat-value')].map(node=>node.textContent),['3','3','40','1']);
    await change('[data-filter=language]','KZ');
    assert.equal(view.document.querySelectorAll('#dialog-rows tr').length,1);
    assert.deepEqual([...view.document.querySelectorAll('.stat-value')].map(node=>node.textContent),['1','1','—','0']);
    await click('[data-queue=attention]');
    assert.equal(view.document.querySelectorAll('#dialog-rows tr').length,1);
    await click('#select-all');
    await change('[data-filter=language]','RU');
    assert.equal(view.document.querySelectorAll('#dialog-rows tr').length,2);
    assert.equal(view.document.querySelector('#dialog-rows [data-open]')?.getAttribute('data-open'),'ru-critical');
    assert.match(view.document.querySelector('#visible-count')!.textContent!,/Выбрано вне фильтра: 1/);
    await click('#evaluate-selected');assert.deepEqual(evaluated,[['kz-na']]);
    await change('#summary-scope','all');assert.equal(view.document.querySelector('.stat-value')?.textContent,'3');
    await act(async()=>view.root.render(<Harness busy/>));
    assert.equal(view.document.querySelector<HTMLButtonElement>('#evaluate-selected')!.disabled,true);
    await click('#evaluate-selected');assert.equal(evaluated.length,1);
    await click('[data-clear-filter=language]');
    assert.equal(view.document.querySelector<HTMLSelectElement>('[data-filter=language]')!.value,'');
  } finally {await view.close();}
});

test('empty list and special characters remain honest and safe React markup',()=>{
  const html=renderToStaticMarkup(<DialogsWorkspace rows={[]} appeals={[]} state={blankState()} onState={noop} busy={false} onEvaluate={noop} onOpenDialog={noop} onImport={noop} onUpload={noop} onSubmission={noop}/>);
  assert.match(html,/Добавьте первый диалог/);
  assert.match(html,/stat-value ">—/);
  const unsafe={...rows[0],title:'Текст <img src=x onerror="bad"> & «проверка»'};
  const safe=renderToStaticMarkup(<DialogsWorkspace rows={[unsafe]} appeals={[]} state={blankState()} onState={noop} busy={false} onEvaluate={noop} onOpenDialog={noop} onImport={noop} onUpload={noop} onSubmission={noop}/>);
  assert.match(safe,/&lt;img/);assert.doesNotMatch(safe,/<img/);assert.match(safe,/Грубые ошибки/);
});

function detail() {
  const record:DialogRecord={conversation_id:'voice-synthetic',channel:'voice call',language:'RU',title:'Вымышленная проверка аудио',transcript:[{speaker:'bot',text:'Вымышленный бот.'},{speaker:'client',text:'Вымышленный вопрос.'},{speaker:'operator',text:'Вымышленный ответ.'}],evaluation_id:'e-voice'};
  const checklist:Checklist={id:'cl',version:1,name:'Чек-лист',sections:[{id:'s1',name:'Контакт'}],criteria:[{id:'c01',section_id:'s1',title:'Приветствие',description:'Вымышленное правило.',answer_type:'binary',weight:100,na_allowed:false}]};
  const evaluation:Evaluation={id:'e-voice',conversation_id:record.conversation_id,checklist_id:'cl',checklist_version:1,total:100,original_total:100,gross_error:false,criteria:[{criterion_id:'c01',answer:'yes',points:100,effective_weight:100,evidence:[{turn:2,quote:'Вымышленный ответ.'}],checked_range:{from:1,to:2},explanation:'Вымышленное обоснование.'}]};
  return {record,checklist,evaluation};
}

test('detail links original turns, deduplicates audio loading and seeks without autoplay',async()=>{
  const view=await mount(),fixture=detail(),appealed:string[]=[];
  let calls=0,release!:(data:unknown)=>void;
  const api={getAudio:()=>{calls++;return new Promise(resolve=>{release=resolve;});},demo:true} as unknown as Api;
  try {
    await act(async()=>view.root.render(<DialogWorkspace {...fixture} checklists={[fixture.checklist]} appeals={[]} api={api} demo busy={false} onEvaluate={noop} onAppeal={id=>appealed.push(id)} onReport={noop} notify={noop}/>));
    assert.equal(view.document.querySelector('.result-total-revision'),null,'equal original/final scores alone are not a review');
    await act(async()=>{const proof=view.document.querySelector<HTMLButtonElement>('[data-turn="2"]')!;proof.click();proof.click();});
    assert.equal(calls,1);
    assert.equal(view.document.querySelectorAll('.turn.highlight').length,1);
    assert.ok(view.document.querySelector('#criterion-c01.evidence-selected'));
    await act(async()=>{release({url:'data:audio/wav;base64,UklGRg==',turn_offsets:{'1':5,'2':8}});await Promise.resolve();});
    const audio=view.document.querySelector<HTMLAudioElement>('#call-audio')!;
    assert.ok(audio);assert.equal(audio.currentTime,5);assert.equal(audio.autoplay,false);
    await act(async()=>view.document.querySelector<HTMLButtonElement>('[data-range-end="2"]')!.click());
    assert.equal(view.document.querySelectorAll('.turn.highlight').length,2);
    assert.equal(audio.currentTime,2);assert.equal(calls,1);
    await act(async()=>view.document.querySelector<HTMLButtonElement>('[data-appeal="c01"]')!.click());
    assert.deepEqual(appealed,['c01']);
  } finally {await view.close();}
});

test('late audio responses cannot attach to another conversation and signed errors stay hidden',async()=>{
  const view=await mount(),fixture=detail();let release!:(data:unknown)=>void;
  const api={getAudio:()=>new Promise(resolve=>{release=resolve;}),demo:false} as unknown as Api;
  const props={...fixture,checklists:[fixture.checklist],appeals:[],api,demo:false,busy:false,onEvaluate:noop,onAppeal:noop,onReport:noop,notify:noop};
  try {
    await act(async()=>view.root.render(<DialogWorkspace {...props}/>));
    await act(async()=>view.document.querySelector<HTMLButtonElement>('[data-action=audio]')!.click());
    await act(async()=>view.root.render(<DialogWorkspace {...props} record={{...fixture.record,conversation_id:'another-synthetic'}}/>));
    await act(async()=>{release({url:'https://example.invalid/recording.wav',turn_offsets:{}});await Promise.resolve();});
    assert.equal(view.document.querySelector('#call-audio'),null);
    const failing={getAudio:async()=>({url:'https://invalid[/?sig=never-show-this'}),demo:false} as unknown as Api;
    await act(async()=>view.root.render(<DialogWorkspace {...props} api={failing}/>));
    await act(async()=>view.document.querySelector<HTMLButtonElement>('[data-action=audio]')!.click());
    assert.match(view.document.body.textContent!,/некорректный адрес аудио/);
    assert.doesNotMatch(view.document.body.textContent!,/never-show-this|invalid\[/);
    let retryCalls=0;
    const synchronous={getAudio:()=>{retryCalls++;throw new Error('Синтетическая ошибка.');},demo:false} as unknown as Api;
    await act(async()=>view.root.render(<DialogWorkspace {...props} api={synchronous}/>));
    await act(async()=>view.document.querySelector<HTMLButtonElement>('[data-action=audio]')!.click());
    await act(async()=>view.document.querySelector<HTMLButtonElement>('[data-action=audio]')!.click());
    assert.equal(retryCalls,2,'a synchronous adapter error must not leave the retry stuck');
  } finally {await view.close();}
});

test('missing historical checklist is visible and invalid proof cannot become navigation markup',()=>{
  const fixture=detail();
  fixture.evaluation.criteria[0].checked_range={from:-1,to:2};
  fixture.evaluation.criteria[0].evidence=[{turn:8,quote:'<script>fake</script>'}];
  const html=renderToStaticMarkup(<EvaluationView evaluation={fixture.evaluation} checklist={null} dialog={fixture.record}/>);
  assert.match(html,/Исходная версия чек-листа недоступна/);
  assert.match(html,/Некорректный диапазон доказательства/);
  assert.match(html,/&lt;script&gt;fake/);
  assert.doesNotMatch(html,/data-turn=|<script>/);
});

test('API mock results are explicitly educational without labeling the conversation fictional',()=>{
  const fixture=detail();
  for(const marker of [{provider:'mock',model:'mock'},{provider:'demo',model:'configured-model'},{model:'demo'},{demo:true,model:'configured-model'}]) {
    const html=renderToStaticMarkup(<EvaluationView {...fixture} evaluation={{...fixture.evaluation,...marker}} demo={false}/>);
    assert.match(html,/badge badge-amber">Учебная оценка/);
    assert.match(html,/Оценка получена в тестовом режиме\. Модель не вызывалась\./);
    const parsed=new JSDOM(html);
    assert.doesNotMatch(parsed.window.document.querySelector('.result-demo-notice')?.textContent || '',/вымышлен/i);
    parsed.window.close();
  }
  const actual=renderToStaticMarkup(<EvaluationView {...fixture} evaluation={{...fixture.evaluation,provider:'external_api',model:'qa-runtime-v1'}} demo={false}/>);
  assert.match(actual,/badge badge-green">qa-runtime-v1/);
  assert.doesNotMatch(actual,/Учебная оценка|Оценка получена в тестовом режиме/);
  const demo=renderToStaticMarkup(<EvaluationView {...fixture} demo/>);
  assert.match(demo,/Учебная оценка/);
  assert.doesNotMatch(demo,/Оценка получена в тестовом режиме/);
});

test('unchanged original DTO values are not a review, while changed answers and decisions are',()=>{
  const fixture=detail();
  const initial={...fixture.evaluation,criteria:fixture.evaluation.criteria.map(item=>({...item,original_answer:item.answer}))};
  const unchanged=renderToStaticMarkup(<EvaluationView {...fixture} evaluation={initial}/>);
  assert.doesNotMatch(unchanged,/result-total-revision|Результат пересмотрен/);
  const pending:Appeal={id:'pending-test',evaluation_id:initial.id,criterion_id:'c01',comment:'Вымышленная проверка.',status:'open',decision:null};
  const withoutOriginalScore=renderToStaticMarkup(<EvaluationView {...fixture} evaluation={{...initial,original_total:null}} appeals={[pending]}/>);
  assert.doesNotMatch(withoutOriginalScore,/result-total-revision|Результат пересмотрен/,'null original_total with unchanged answers and no decision is not a review');
  const changed={...initial,criteria:[{...initial.criteria[0],original_answer:'no' as const}]};
  const changedMarkup=renderToStaticMarkup(<EvaluationView {...fixture} evaluation={changed}/>);
  assert.match(changedMarkup,/result-total-revision/);
  const decision:Appeal={id:'confirmed-test',evaluation_id:initial.id,criterion_id:'c01',comment:'Вымышленная проверка.',status:'confirmed',decision:{answer:'yes',reason:'Подтверждено по реплике.'}};
  const reviewed=renderToStaticMarkup(<EvaluationView {...fixture} evaluation={{...initial,original_total:null}} appeals={[decision]}/>);
  assert.match(reviewed,/result-total-revision/);
  assert.match(reviewed,/Подтверждено по реплике/);
});

test('partial results retain the server score and missing-answer labels without inventing N/A',()=>{
  const fixture=detail();
  for(const answer of [null,undefined]) {
    const partial={...fixture.evaluation,total:42.5,original_total:42.5,complete:false,criteria:[{...fixture.evaluation.criteria[0],answer:answer as unknown as Answer}]};
    const html=renderToStaticMarkup(<EvaluationView {...fixture} evaluation={partial}/>);
    assert.match(html,/Оценка неполная: есть критерии без ответа/);
    assert.match(html,/Предварительный балл/);
    assert.match(html,/result-ring-number"[^>]*>42,5/);
    assert.match(html,/result-answer-review">Ответ не получен/);
    assert.doesNotMatch(html,/result-answer-na|Нет применимых критериев для расчёта/);
  }
  const allNA={...fixture.evaluation,total:null,original_total:null,complete:true,criteria:[{...fixture.evaluation.criteria[0],answer:'na' as const}]};
  const naMarkup=renderToStaticMarkup(<EvaluationView {...fixture} evaluation={allNA}/>);
  assert.match(naMarkup,/Нет применимых критериев для расчёта/);
  assert.match(naMarkup,/result-answer-na">Не применяется/);
  assert.doesNotMatch(naMarkup,/Оценка неполная|Предварительный балл|Ответ не получен/);
  const missingArray={...fixture.evaluation,criteria:undefined} as unknown as Evaluation;
  const missingMarkup=renderToStaticMarkup(<EvaluationView {...fixture} checklist={null} evaluation={missingArray}/>);
  assert.match(missingMarkup,/Оценка неполная|Предварительный балл/);
});

test('workflow translations cover both locales with identical template parameters',()=>{
  for(const [source,translations] of Object.entries(workflowMessages)) {
    const parameters=(value:string)=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
    for(const locale of ['en','kk'] as const){assert.ok(translations[locale].trim(),source);assert.deepEqual(parameters(translations[locale]),parameters(source),`${locale}: ${source}`);}
  }
});
