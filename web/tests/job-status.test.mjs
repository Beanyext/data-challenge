import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const failed of [0,1]) {
  test(`completed job with ${failed} failed conversations preserves the correct outcome`,async()=>{
    const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://127.0.0.1/#dialogs',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
    const {window}=dom;
    window.CQA_CONFIG={apiBase:'/api',demo:false};
    window.structuredClone=structuredClone;
    window.TextDecoder=TextDecoder;
    window.scrollTo=()=>{};
    window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
    window.sessionStorage.setItem('cqa-active-job',JSON.stringify({id:'synthetic-job',baseUrl:'/api',demo:false}));
    let calls=0;
    window.fetch=async url=>({ok:true,status:200,json:async()=>{
      if(String(url).includes('/jobs/')){calls++;return {id:'synthetic-job',status:'completed',completed:10,total:10,failed,errors:failed?[{conversation_id:'synthetic-failed',error:'Synthetic failure'}]:[]};}
      return [];
    }});
    try {
      vm.runInContext(await readFile(new URL('../react-ui.js',import.meta.url),'utf8'),dom.getInternalVMContext());
      const deadline=Date.now()+5000;
      while(!calls || window.sessionStorage.getItem('cqa-active-job')!==null){assert.ok(Date.now()<deadline,'Polling did not finish');await delay(15);}
      await delay(30);
      const banner=window.document.getElementById('job-banner');
      assert.ok(banner);
      if(failed){
        assert.equal(banner.hidden,false);
        assert.match(banner.textContent,/Часть диалогов не оценена/);
        assert.doesNotMatch(window.document.getElementById('notifications').textContent,/Оценка завершена/);
      }else{
        assert.equal(banner.hidden,true);
        assert.match(window.document.getElementById('notifications').textContent,/Оценка завершена/);
      }
    }finally{dom.window.close();}
  });
}
