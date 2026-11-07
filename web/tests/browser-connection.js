async (originalPage) => {
  const browser=originalPage.context().browser(),passed=[];
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  {
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
    const requests=[];
    await context.addInitScript(()=>localStorage.setItem('cqa-connection',JSON.stringify({baseUrl:'localhost:8000/api',demo:false})));
    await context.route('**/api/**',route=>{requests.push(route.request().method());return route.fulfill({json:[]});});
    try {
      await page.goto('http://127.0.0.1:8765/#submission');await page.locator('#submission-form').waitFor();
      check(await page.getByRole('button',{name:'Проверить результаты',exact:true}).isDisabled(),'Invalid configured server still allows collection');
      check((await page.locator('#submission-form').innerText()).includes('Адрес API некорректен'),'Missing invalid-source explanation');
      const records=Array.from({length:10},(_,index)=>({conversation_id:`synthetic-invalid-source-${index}`,channel:'agent chat',transcript:[{speaker:'operator',text:'Вымышленная реплика для проверки формата.'}]}));
      const answers=['yes','yes','yes',20,'yes',10,'yes','no'];
      const evaluations=records.map(record=>({conversation_id:record.conversation_id,provider:'synthetic-validator',model:'synthetic-validator-model',criteria:answers.map((answer,index)=>({criterion_id:`c${String(index+1).padStart(2,'0')}`,answer,explanation:'Проверка формата на вымышленных данных.',evidence:[{turn:0}]}))}));
      const file=(name,data)=>({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
      await page.locator('#submission-form select[name=input]').selectOption('files');await page.locator('#submission-form select[name=dataset]').selectOption('prod');
      await page.locator('#submission-dataset-file').setInputFiles(file('synthetic-source.json',{dataset_group_id:'PROD',records}));
      await page.locator('#submission-evaluation-files').setInputFiles(file('synthetic-evaluations.json',{evaluations}));
      await page.locator('#submission-form select[name=mode]').selectOption('local');await page.getByRole('button',{name:'Проверить результаты',exact:true}).click();
      await page.getByRole('heading',{name:'Формат проверен',exact:true}).waitFor();
      check(await page.locator('[data-submission-action=download]').isEnabled(),'Offline file validation was blocked by unrelated API error');
      check(requests.length===0,'Invalid source silently accessed same-origin /api');
      passed.push('invalid API fails closed; offline JSON preparation remains usable with zero server reads');
    } finally {await context.close();}
  }
  {
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();let broken=false;
    const checklist={id:'connection-test',version:1,name:'Синтетический чек-лист',sections:[{id:'s',name:'Раздел'}],criteria:[{id:'c01',section_id:'s',title:'Исходный критерий',description:'Синтетическое правило.',answer_type:'binary',weight:100,na_allowed:false,gross_error:false}]};
    await context.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;if(broken)return route.fulfill({status:503,json:{detail:'Synthetic API unavailable'}});return route.fulfill({json:path==='/api/checklists'?[checklist]:[]});});
    try {
      await page.goto('http://127.0.0.1:8765/#checklists');await page.locator('[data-criterion=title]').waitFor();
      const draft='Несохранённый черновик «проверка» & контекст';await page.locator('[data-criterion=title]').fill(draft);
      broken=true;await page.locator('[data-nav=dialogs]').click();await page.getByRole('heading',{name:'Нет подключения к данным',exact:true}).waitFor();
      let rejected=false;page.once('dialog',async dialog=>{check(dialog.type()==='confirm','Unexpected browser dialog');rejected=true;await dialog.dismiss();});
      await page.locator('[data-action=demo]').click();check(rejected,'Demo switch skipped dirty-draft confirmation');
      check(await page.locator('#mode-label').innerText()==='Данные сервера','Declined source change still switched API');
      broken=false;await page.locator('[data-action=retry]').click();await page.locator('#dialog-rows').waitFor({state:'attached'});await page.locator('[data-nav=checklists]').click();await page.locator('[data-criterion=title]').waitFor();
      check(await page.locator('[data-criterion=title]').inputValue()===draft,'Declined source change lost checklist draft');
      broken=true;await page.locator('[data-nav=dialogs]').click();await page.getByRole('heading',{name:'Нет подключения к данным',exact:true}).waitFor();
      let accepted=false;page.once('dialog',async dialog=>{accepted=true;await dialog.accept();});await page.locator('[data-action=demo]').click();
      await page.locator('#dialog-rows tr').first().waitFor();check(accepted,'Positive source-change control did not prompt');
      check(await page.locator('#dialog-rows tr').count()===6,'Approved source change did not open demo dialogs');
      check(new URL(page.url()).searchParams.get('demo')==='1','Explicit demo choice did not persist in the URL');
      passed.push('demo source switch preserves dirty draft on cancel and changes source only after explicit acceptance');
    }finally{await context.close();}
  }
  return {passed,paidCalls:0};
}
