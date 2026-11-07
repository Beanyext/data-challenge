import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { EvaluationHistory } from '../react/history';
import { setLocale } from '../react/i18n';
import { historyMessages } from '../react/messages/history';
import type { Api, EvaluationSummary } from '../react/types';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1:8765/'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,location:dom.window.location,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
const {createRoot}=await import('react-dom/client');
setLocale('ru');
async function mounted(element:React.ReactNode) {
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
  await act(async()=>{root.render(element);});
  return {container,render:async(next:React.ReactNode)=>{await act(async()=>{root.render(next);});},close:async()=>{await act(async()=>{root.unmount();});container.remove();}};
}
async function click(element:Element|null) {assert.ok(element);await act(async()=>{(element as HTMLElement).click();});}
const summary=(id:string,more:Partial<EvaluationSummary>={}):EvaluationSummary=>({id,status:'done',checklist_id:'test-checklist',checklist_version:1,total:80,original_total:80,model:'mock',created_at:'2026-11-07T19:00:00+00:00',...more});
const expectedAlmatyTime=new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date('2026-11-07T19:00:00Z'));
const apiWith=(load:(id:string)=>Promise<EvaluationSummary[]>)=>({demo:true,listEvaluations:load,evaluate:()=>{throw new Error('History must never evaluate');},getEvaluation:()=>{throw new Error('Only onOpen may request a snapshot');}} as unknown as Api);

test('history preserves zero, suppresses invalid/pending/error scores and exposes exact saved versions with GET-only callbacks',async()=>{
  const requests:string[]=[],opened:string[]=[];
  const rows=[summary('new',{status:'pending',total:99}),summary('failed',{status:'error',total:66,error:'https://secret.example/path?sig=never-render'}),summary('current',{total:0,original_total:85,gross_error:true}),summary('old',{checklist_version:0,total:null,model:'Вымышленная модель Қ & <script>unsafe()</script>'})];
  const api=apiWith(async id=>{requests.push(id);return rows;});
  const view=await mounted(<EvaluationHistory api={api} conversationId="synthetic-Қ" currentEvaluationId="current" latestEvaluationId="new" onOpen={id=>opened.push(id)}/>);
  try {
    assert.deepEqual(requests,['synthetic-Қ']);assert.equal(view.container.querySelectorAll('.history-row').length,4);
    const current=view.container.querySelector('[data-history-id=current]')!,pending=view.container.querySelector('[data-history-id=new]')!,failed=view.container.querySelector('[data-history-id=failed]')!,old=view.container.querySelector('[data-history-id=old]')!;
    assert.equal(current.querySelector('.history-score strong')!.textContent,'0');assert.match(current.textContent!,/До апелляции: 85/);assert.match(current.textContent!,/Грубая ошибка/);assert.equal(current.getAttribute('aria-current'),'true');
    assert.equal(pending.querySelector('.history-score strong')!.textContent,'—');assert.equal(failed.querySelector('.history-score strong')!.textContent,'—');assert.equal(old.querySelector('.history-score strong')!.textContent,'—');assert.match(old.textContent!,/Нет итогового балла/);
    assert.match(pending.textContent!,/Последний запуск/);assert.equal(pending.querySelector('button')!.disabled,true);assert.equal(failed.querySelector('button')!.disabled,true);assert.equal(current.querySelector('button')!.disabled,true);
    assert.match(old.textContent!,/test-checklist · v0/);assert.match(old.textContent!,/Вымышленная модель Қ & <script>/);assert.equal(view.container.querySelectorAll('script').length,0);assert.doesNotMatch(view.container.textContent!,/never-render|secret.example/);
    assert.equal(current.querySelector('time')!.textContent,expectedAlmatyTime);assert.equal(current.querySelector('time')!.dateTime,'2026-11-07T19:00:00.000Z');
    await click(old.querySelector('button'));assert.deepEqual(opened,['old']);assert.deepEqual(requests,['synthetic-Қ']);
  } finally {await view.close();}
});

test('history rejects a stale dialog response, reloads on refresh and never leaves stale results after failure',async()=>{
  let first!:(rows:EvaluationSummary[])=>void;let count=0;
  const api=apiWith(async id=>{count++;if(id==='first')return await new Promise(resolve=>{first=resolve;});if(count===3)throw new Error('token=private');return [summary('second-evaluation')];});
  const props={api,onOpen:()=>{}};
  const view=await mounted(<EvaluationHistory {...props} conversationId="first"/>);
  try {
    assert.match(view.container.textContent!,/Загрузка истории/);
    await view.render(<EvaluationHistory {...props} conversationId="second"/>);assert.match(view.container.textContent!,/second-evaluation/);
    await act(async()=>first([summary('wrong-first-evaluation')]));assert.doesNotMatch(view.container.textContent!,/wrong-first/);assert.match(view.container.textContent!,/second-evaluation/);assert.doesNotMatch(view.container.textContent!,/Загрузка истории/);
    await view.render(<EvaluationHistory {...props} conversationId="second" refreshKey={1}/>);assert.equal(view.container.querySelectorAll('.history-row').length,0);assert.match(view.container.textContent!,/Не удалось загрузить историю/);assert.doesNotMatch(view.container.textContent!,/private/);
    await click(view.container.querySelector('button'));assert.match(view.container.textContent!,/second-evaluation/);assert.equal(count,4);
  } finally {await view.close();}
});

test('history marks saved incomplete and unresolved results as provisional and still opens their saved snapshot',async()=>{
  const opened:string[]=[];
  const api=apiWith(async()=>[summary('partial',{total:44,complete:false}),summary('unresolved',{total:100,complete:true,needs_review_count:1}),summary('final',{total:0,complete:true,needs_review_count:0})]);
  const view=await mounted(<EvaluationHistory api={api} conversationId="synthetic" onOpen={id=>opened.push(id)}/>);
  try {
    for(const id of ['partial','unresolved']) {
      const row=view.container.querySelector(`[data-history-id=${id}]`)!;assert.match(row.querySelector('.history-score')!.textContent!,/Предварительный балл/);assert.match(row.textContent!,/Нужна проверка/);assert.equal(row.querySelector('button')!.disabled,false);
    }
    assert.doesNotMatch(view.container.querySelector('[data-history-id=final]')!.textContent!,/Предварительный|Нужна проверка/);
    await click(view.container.querySelector('[data-history-id=partial] button'));assert.deepEqual(opened,['partial']);
  } finally {await view.close();}
});

test('history distinguishes no saved runs, unsupported API, unknown status and absent/invalid dates',async()=>{
  const view=await mounted(<EvaluationHistory api={apiWith(async()=>[])} conversationId="empty" onOpen={()=>{}}/>);
  try {
    assert.match(view.container.textContent!,/Сохранённых оценок пока нет/);
    await view.render(<EvaluationHistory api={{demo:true} as Api} conversationId="unsupported" onOpen={()=>{}}/>);assert.match(view.container.textContent!,/История недоступна/);assert.doesNotMatch(view.container.textContent!,/Сохранённых оценок пока нет/);
    await view.render(<EvaluationHistory api={apiWith(async()=>[summary('unknown',{status:'future-status',total:100,created_at:'bad date'}),summary('naive',{created_at:'2026-11-07T19:00:00'})])} conversationId="other" onOpen={()=>{}}/>);
    const unknown=view.container.querySelector('[data-history-id=unknown]')!;assert.match(unknown.textContent!,/Статус оценки неизвестен/);assert.match(unknown.textContent!,/Время не указано/);assert.equal(unknown.querySelector('button')!.disabled,true);assert.equal(unknown.querySelector('.history-score strong')!.textContent,'—');assert.equal(view.container.querySelector('[data-history-id=naive] time')!.textContent,expectedAlmatyTime);
  } finally {await view.close();}
});

for(const locale of ['en','kk'] as const)test(`history renders all labels in ${locale} while retaining model and checklist names`,async()=>{
  setLocale(locale);
  const props={api:apiWith(async()=>[summary('synthetic',{total:0,original_total:80,model:'Қазақша модель',checklist_id:'Русское имя'})]),conversationId:'synthetic',currentEvaluationId:'synthetic',latestEvaluationId:'synthetic',onOpen:()=>{}};
  const view=await mounted(<EvaluationHistory {...props}/>);
  try {
    const text=view.container.textContent!;
    for(const key of ['История оценок','Оценка завершена','Просматривается','Последний запуск','Открыть оценку','До апелляции: {score}'])assert.ok(text.includes(historyMessages[key][locale].replace('{score}','80')));
    assert.ok(text.includes('Қазақша модель'));assert.ok(text.includes('Русское имя'));assert.doesNotMatch(text,/До апелляции|Последний запуск|Оценка завершена/);
    setLocale('ru');await view.render(<EvaluationHistory {...props}/>);assert.match(view.container.textContent!,/История оценок/);assert.equal(view.container.querySelectorAll('.history-row').length,1);
  } finally {setLocale('ru');await view.close();}
});
