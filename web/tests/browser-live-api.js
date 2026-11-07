async (originalPage) => {
  const context=await originalPage.context().browser().newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});
  const page=await context.newPage(),errors=[],requests=[],blocked=[];
  const origin='http://127.0.0.1:8767',passed=[];
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  const expandCriterion=async id=>{const row=page.locator(`#criterion-${id} .result-row`);await row.waitFor();if(await row.getAttribute('aria-expanded')==='false')await row.click();await page.locator(`#criterion-${id} .result-criterion-details`).waitFor();};
  page.on('pageerror',error=>errors.push(error.message));
  const healthResponse=await page.request.get(`${origin}/api/health`);
  const health=await healthResponse.json();
  if(!healthResponse.ok() || health.provider!=='mock' || health.model!=='mock'){await context.close();throw new Error('Live API test requires an explicitly configured mock server. No POST was sent.');}
  await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin || url.pathname==='/api/dialogs/import' || /^\/api\/dialogs\/[^/]+\/audio$/.test(url.pathname)){blocked.push(url.pathname);return route.abort();}
    if(url.pathname.startsWith('/api/'))requests.push({method:request.method(),path:url.pathname});
    return route.continue();
  });
  const jsonFile=(name,value)=>({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  const id=`synthetic-live-${Date.now()}`;
  const record={conversation_id:id,channel:'agent chat',language:'RU',audio_url:null,transcript:[
    {timestamp:'00:00',speaker:'client',text:'Вымышленный вопрос: где посмотреть тарифы?'},
    {timestamp:'00:02',speaker:'operator',text:'Здравствуйте! Я вымышленный оператор. Тарифы доступны в приложении, раздел «Условия».'},
    {timestamp:'00:04',speaker:'client',text:'Спасибо, вымышленный вопрос решён.'},
    {timestamp:'00:06',speaker:'operator',text:'Рад помочь. Остались вопросы? Хорошего дня!'},
  ]};
  try {
    for(const [asset,mime] of [['/app.mjs','text/javascript'],['/react-ui.js','text/javascript'],['/styles.css','text/css'],['/assets/freedom-logo-print.svg','image/svg+xml']]) {
      const response=await page.request.get(`${origin}${asset}`);
      check(response.ok() && (response.headers()['content-type']||'').includes(mime),`Incorrect static MIME for ${asset}`);
    }
    await page.goto(`${origin}/#dialogs`);await page.getByRole('heading',{name:'Диалоги',exact:true}).waitFor();
    await page.locator('#upload-file').setInputFiles(jsonFile('вымышленный-диалог.json',record));
    await page.getByRole('button',{name:`Открыть ${id}`,exact:true}).waitFor();
    await page.getByRole('button',{name:`Открыть ${id}`,exact:true}).click();
    await page.getByRole('heading',{name:'Транскрипт',exact:true}).waitFor();
    check(await page.locator('#transcript .turn').count()===4,'Real API upload lost source turns');
    passed.push('multipart upload and read from actual FastAPI/SQLite');
    await page.locator('[data-action=evaluate-dialog]').click();
    await page.locator('#evaluate-form input[name=confirm]').check();
    await page.locator('#evaluate-form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    await page.locator('#evaluation-panel .result-ring').waitFor();
    const list=await (await page.request.get(`${origin}/api/dialogs`)).json();
    const saved=list.find(row=>row.conversation_id===id);check(saved?.evaluation_id,'Actual server did not retain evaluation ID');
    const original=await (await page.request.get(`${origin}/api/evaluations/${encodeURIComponent(saved.evaluation_id)}`)).json();
    check(original.provider==='mock' && original.model==='mock','Unexpected provider in live mock test');
    check(original.criteria.length===8 && Number.isFinite(original.total),'Actual evaluator did not return eight criteria and a score');
    check(original.original_total===null,'Expected latest server original_total:null before review');
    check(await page.locator('.result-total-revision').count()===0,'Untouched server result was falsely labeled reviewed');
    check(Number.isInteger(original.checklist_version),'Actual evaluator did not retain the checklist version');
    check(requests.filter(request=>request.method==='POST'&&request.path==='/api/evaluations').length===1,'Duplicate evaluation reached the actual backend');
    check(await page.locator('.criterion').count()===8,'Actual evaluation was not shown');
    passed.push('actual queued mock evaluation, scoring and duplicate-submit guard');
    await expandCriterion('c01');await page.locator('#criterion-c01 [data-appeal]').click();
    await page.locator('#appeal-form textarea').fill(`Вымышленная апелляция ${id} «проверка» & без персональных данных.`);
    await page.locator('#appeal-form button[type=submit]').click();
    await page.locator('#appeal-form').waitFor({state:'detached'});await page.locator('#criterion-c01 [data-appeal][disabled]').waitFor({state:'attached'});await expandCriterion('c01');await page.locator('#criterion-c01 [data-appeal][disabled]').waitFor();
    await page.locator('[data-nav=appeals]').click();await page.locator('.appeal-card').filter({hasText:id}).locator('[data-review]').click();
    await page.locator('form[data-decision] textarea[name=reason]').waitFor();
    check(await page.locator('.review-transcript .turn').count()>0,'Review did not fetch the actual source conversation');
    await page.getByRole('radio',{name:'Изменить оценку',exact:true}).check();
    const previous=original.criteria.find(criterion=>criterion.criterion_id==='c01').answer;
    const answer=previous==='yes'?'no':'yes';
    await page.locator('form[data-decision] select[name=answer]').selectOption(answer);
    await page.locator('form[data-decision] textarea[name=reason]').fill('Синтетическое решение для проверки сохранения и пересчёта.');
    await page.locator('form[data-decision] button[type=submit]').click();
    await page.getByRole('button',{name:/Все обращения/}).click();
    await page.locator('.appeal-card').filter({hasText:id}).locator('[data-context]').first().click();await expandCriterion('c01');await page.locator('#criterion-c01 .result-revision').waitFor();
    const reviewed=await (await page.request.get(`${origin}/api/evaluations/${encodeURIComponent(saved.evaluation_id)}`)).json();
    check(reviewed.criteria.find(criterion=>criterion.criterion_id==='c01').answer===answer,'Decision was not read back from actual SQLite');
    check(reviewed.original_total===original.total,'Original score was overwritten');
    check(reviewed.total!==original.total,'Actual score did not change after a nonzero-weight binary decision');
    await page.reload();await expandCriterion('c01');await page.locator('#criterion-c01 .result-revision').waitFor();
    passed.push('actual appeal, source context, decision, score recalculation and reload persistence');
    await page.getByRole('link',{name:'Отчёт',exact:true}).click();await page.getByRole('heading',{name:'Отчёт о качестве диалога',exact:true}).waitFor();
    check(await page.locator('.report-demo').count()>0,'Server mock data was mislabeled as a real AI report');
    check((await page.locator('.quality-report').innerText()).includes('Синтетическое решение'),'Report omitted the saved review');
    await page.screenshot({path:'/private/tmp/cqa-unified-live-report.png',fullPage:true});
    passed.push('report reads actual stored original/final values and explicitly labels mock');
    await page.locator('[data-nav=checklists]').click();await page.getByRole('heading',{name:'Чек-листы',exact:true}).waitFor();
    const changedTitle=`Синтетический контакт «${id}» & проверка`;
    await page.locator('[data-criterion=title]').fill(changedTitle);
    await page.locator('[data-action=save-checklist]').click();await page.getByRole('heading',{name:'Проверить изменения',exact:true}).waitFor();
    await page.getByRole('button',{name:'Сохранить новую версию',exact:true}).click();await page.getByText('Сохранено',{exact:true}).waitFor();
    check((await page.locator('#choose-checklist').innerText()).includes(`v${original.checklist_version+1}`),'Actual server did not store the next checklist version');
    await page.goto(`${origin}/#dialog/${encodeURIComponent(id)}`);await page.locator('#criterion-c01').waitFor();
    check((await page.locator('#criterion-c01 .result-row-title').innerText())!==changedTitle,'Historical evaluation was shown with the new checklist definition');
    passed.push('actual checklist version write and immutable historical evaluation');
    await page.locator('[data-nav=submission]').click();await page.getByRole('heading',{name:'Выгрузка результатов',exact:true}).waitFor();
    await page.locator('#submission-form select[name=dataset]').selectOption('prod');
    await page.locator('#submission-form select[name=input]').selectOption('server');
    const source=Array.from({length:10},(_,index)=>({...record,conversation_id:index===0?id:`${id}-missing-${index}`}));
    await page.locator('#submission-dataset-file').setInputFiles(jsonFile('synthetic-prod.json',{dataset_group_id:'PROD',total_records:10,records:source}));
    await page.locator('#submission-form select[name=mode]').selectOption('local');
    await page.getByRole('button',{name:'Проверить результаты',exact:true}).click();
    await page.getByRole('heading',{name:/Файл пока нельзя скачать/}).waitFor();
    check(/mock|учебн/i.test(await page.locator('#submission-result').innerText()),'Actual mock evaluation was accepted for official submission');
    check(await page.locator('[data-submission-action=download]').count()===0,'Mock export download was exposed');
    passed.push('actual mock results cannot become an official submission');
    check(errors.length===0,JSON.stringify(errors));check(blocked.length===0,'Test attempted an excluded external/import/audio request');
    return {passed,pageErrors:errors,blockedRequests:blocked,evaluationPosts:requests.filter(request=>request.method==='POST'&&request.path==='/api/evaluations').length,provider:health.provider,realFastApi:true,realSQLite:true,paidCalls:0};
  }catch(error){await page.screenshot({path:'/private/tmp/cqa-unified-live-api-failure.png',fullPage:true}).catch(()=>{});throw new Error(`${error.message}\nPassed: ${passed.join('; ')}\nPage errors: ${JSON.stringify(errors)}`);}
  finally{await context.close();}
}
