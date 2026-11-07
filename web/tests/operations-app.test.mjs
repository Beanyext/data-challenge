import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM,VirtualConsole} from 'jsdom';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,'Timed out');await wait(10);}}
async function mount(hash='#dialogs'){
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://127.0.0.1/'+hash,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
 const w=dom.window,d=w.document,posts=[],errors=[];
 w.CQA_CONFIG={apiBase:'/api',demo:false};w.TextDecoder=TextDecoder;w.structuredClone=structuredClone;w.scrollTo=()=>{};
 w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 w.addEventListener('error',event=>errors.push(event.message));
 const old={id:'cl',version:1,name:'Старый чек-лист',sections:[{id:'s',name:'Раздел'}],criteria:[{id:'c1',code:'contact',section_id:'s',title:'Старое правило',description:'Вымышленное правило',answer_type:'binary',weight:100}]};
 const current={...old,version:2,criteria:[{...old.criteria[0],title:'Новое правило'}]};
 const rows=[{conversation_id:'bad',channel:'agent chat',language:'RU',status:'error',evaluation_id:'bad-ev',total:null},{conversation_id:'good',channel:'agent chat',language:'EN',status:'evaluated',evaluation_id:'new',total:100},{conversation_id:'waiting',channel:'agent chat',language:'RU',status:'pending',evaluation_id:'waiting',total:null}];
 const ev=(id,cl,conversation_id,score)=>({id,conversation_id,checklist_id:cl.id,checklist_version:cl.version,checklist:cl,total:score,model:'synthetic-model',criteria:[{criterion_id:'c1',answer:score?'yes':'no',points:score,effective_weight:100,explanation:'Вымышленное обоснование',evidence:[{turn:0,quote:'Вымышленная реплика'}]}]});
 const evaluations={old:ev('old',old,'good',0),new:ev('new',current,'good',100),foreign:ev('foreign',old,'different',0)};
 w.fetch=async(url,options)=>({ok:true,status:200,json:async()=>{
   const path=String(url).replace('/api','');
   if(options.method==='POST'){posts.push({path,body:JSON.parse(options.body)});rows[0].status='evaluated';rows[0].evaluation_id='retry';rows[0].total=100;return {id:'job',status:'queued',total:1};}
   if(path==='/dialogs')return structuredClone(rows);
   if(path==='/checklists')return [current];
   if(path==='/appeals')return [];
   if(path==='/health')return {provider:'mock',model:'mock'};
   if(path.startsWith('/jobs/'))return {id:'job',status:'completed',completed:1,total:1,failed:0};
   if(path==='/dialogs/good/evaluations')return [{id:'new',status:'done',model:'synthetic-model',total:100,checklist_version:2},{id:'old',status:'done',model:'synthetic-model',total:0,checklist_version:1}];
   if(path.startsWith('/dialogs/'))return {...rows.find(row=>row.conversation_id===path.split('/')[2]),transcript:[{speaker:'operator',timestamp:'00:00',text:'Вымышленная реплика'}]};
   if(path.startsWith('/evaluations/'))return evaluations[path.split('/')[2]];
   throw new Error('Unexpected read '+path);
 }});
 await vm.runInContext(await readFile(new URL('../react-ui.js',import.meta.url),'utf8'),dom.getInternalVMContext());
 return {dom,w,d,posts,errors,rows,async close(){dom.window.close();}};
}
for(const changed of [false,true])test(`retry uses explicit confirmation and fresh failed status, changed=${changed}`,async()=>{
 const v=await mount();try{
  await until(()=>v.d.querySelectorAll('#dialog-rows tr').length===3);
  const button=v.d.querySelector('[data-action=retry-failed]');assert.equal(button.disabled,false);button.click();
  await until(()=>v.d.querySelector('#evaluate-form'));
  assert.equal(v.posts.length,0);
  if(changed)v.rows[0].status='evaluated';
  v.d.querySelector('#evaluate-form [name=confirm]').click();v.d.querySelector('#evaluate-form button[type=submit]').click();
  if(changed){await until(()=>v.d.querySelector('#notifications').textContent.includes('Список ошибок изменился'));assert.equal(v.posts.length,0);}
  else{await until(()=>v.posts.length===1);assert.deepEqual(v.posts[0].body.conversation_ids,['bad']);assert.equal(v.posts[0].body.only_failed,true);assert.equal(v.rows[1].evaluation_id,'new');}
  assert.deepEqual(v.errors,[]);
 }finally{await v.close();}
});
test('historical deep links use original snapshot; foreign evaluations fail closed',async()=>{
 const v=await mount('#dialog/good/evaluation/old');try{
  await until(()=>v.d.querySelector('#criterion-c1 .result-row-title'));
  assert.match(v.d.querySelector('#criterion-c1 .result-row-title').textContent,/Старое правило/);
  assert.doesNotMatch(v.d.querySelector('#evaluation-panel').textContent,/Новое правило/);
  v.w.location.hash='#dialog/good/evaluation/foreign';
  await until(()=>v.d.body.textContent.includes('Оценка не относится к выбранному диалогу.'));
  assert.equal(v.posts.length,0);assert.deepEqual(v.errors,[]);
 }finally{await v.close();}
});
