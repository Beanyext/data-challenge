import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';

const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function until(predicate,message) {
  const deadline=Date.now()+5000;
  while(!predicate()){if(Date.now()>deadline)throw new Error(message);await delay(15);}
}

test('the exact built React app boots once and preserves filters, selection, locale and modal input',async()=>{
  const failures=[],requests=[];
  const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>{if(!/Not implemented: navigation/.test(error.message))failures.push(error.message);});
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://127.0.0.1/?demo=1#dialogs',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
  const {window}=dom,document=window.document;
  window.structuredClone=globalThis.structuredClone;
  window.TextDecoder=globalThis.TextDecoder;
  window.CQA_CONFIG={apiBase:'/api',demo:false,teamName:'seeusoon'};
  window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  window.scrollTo=()=>{};window.HTMLElement.prototype.scrollIntoView=()=>{};
  window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  window.fetch=async(url,options)=>{requests.push({url,method:options?.method || 'GET'});throw new Error('No real HTTP requests are allowed in the demo integration test.');};
  window.addEventListener('error',event=>failures.push(event.error?.message || event.message));
  const click=selector=>{const node=document.querySelector(selector);assert.ok(node,selector);node.click();};
  try {
    vm.runInContext(await readFile(new URL('../react-ui.js',import.meta.url),'utf8'),dom.getInternalVMContext(),{filename:'react-ui.js'});
    await until(()=>document.querySelectorAll('#dialog-rows tr').length===6,'React application did not load the six demo records');
    assert.equal(document.querySelectorAll('#root>.sidebar').length,1);
    const filter=document.querySelector('[data-filter=language]');filter.value='KZ';filter.dispatchEvent(new window.Event('change',{bubbles:true}));
    await until(()=>document.querySelectorAll('#dialog-rows tr').length===1,'Filter did not update the actual table');
    assert.equal(document.querySelector('.stat-value').textContent,'1');
    click('#select-all');await until(()=>document.querySelector('[data-select]').checked,'Selection did not update');
    click('.language-trigger');await until(()=>document.querySelector('[data-language=en]'),'Language menu did not open');click('[data-language=en]');
    await until(()=>document.documentElement.lang==='en','Live locale switch did not update the document');
    assert.equal(document.querySelector('[data-filter=language]').value,'KZ');
    assert.equal(document.querySelector('[data-select]').checked,true);
    assert.equal(document.querySelector('h1').textContent,'Conversations');
    assert.equal(new URL(window.location.href).searchParams.get('demo'),'1');
    assert.equal(new URL(window.location.href).searchParams.get('lang'),'en');
    click('[data-action=import]');await until(()=>document.querySelector('#import-form'),'React import modal did not open');
    const group=document.querySelector('#import-form input[name=groupId]');group.value='SYNTHETIC-«ГРУППА»-&';group.dispatchEvent(new window.Event('input',{bubbles:true}));
    click('.language-trigger');await until(()=>document.querySelector('[data-language=kk]'),'Language menu did not reopen');click('[data-language=kk]');
    await until(()=>document.documentElement.lang==='kk','Kazakh locale did not update');
    assert.equal(document.querySelector('#import-form input[name=groupId]').value,'SYNTHETIC-«ГРУППА»-&');
    assert.equal(document.querySelector('#modal').open,true);
    click('#modal [data-action=close-modal]');await until(()=>!document.querySelector('#modal'),'Modal did not close');
    click('[data-nav=submission]');await until(()=>document.querySelector('#submission-form'),'Submission workspace did not open');
    assert.equal(document.querySelector('#submission-form input[name=teamName]').value,'seeusoon');
    assert.equal(document.querySelector('#demo-banner').hidden,true);
    assert.deepEqual(requests,[]);
    assert.deepEqual(failures,[]);
  }finally{dom.window.close();}
});
