async (originalPage) => {
 const origin='http://127.0.0.1:8767',context=await originalPage.context().browser().newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
 const errors=[],posts=[],passed=[];
 const check=(value,message)=>{if(!value)throw new Error(message);};
 const json=async path=>{const response=await page.request.get(origin+path);check(response.ok(),'Read failed '+path);return response.json();};
 const widths=async()=>{for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflows at '+width);}};
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/evaluations')posts.push(request.postDataJSON());});
 await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin!==origin||url.pathname==='/api/dialogs/import'?route.abort():route.continue();});
 try{
  check((await json('/api/health')).provider==='mock','Requires isolated mock server');
  const before=await json('/api/dialogs'),good=before.find(row=>row.conversation_id==='synthetic-good').evaluation_id;
  await page.goto(origin+'/#dialogs');await page.locator('#dialog-rows tr').first().waitFor();
  await page.locator('[data-filter=language]').selectOption('RU');await page.locator('[data-filter=status]').selectOption('error');
  check(await page.locator('#dialog-rows tr').count()===1,'Error filter must isolate RU failure');
  await page.locator('[data-action=retry-failed]').click();await page.locator('#evaluate-form').waitFor();
  check(posts.length===0,'Opening retry must not run evaluation');
  await page.locator('#evaluate-form button[type=submit]').click();check(posts.length===0,'Retry requires confirmation');
  await page.locator('#evaluate-form [name=confirm]').check();await page.locator('#evaluate-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#job-banner')?.hidden===true&&document.querySelector('#modal')===null&&document.querySelector('#list-empty')&&!document.querySelector('#list-empty').hidden);
  check(posts.length===1&&JSON.stringify(posts[0].conversation_ids)==='["synthetic-failed-ru"]'&&posts[0].only_failed===true,'Retry sent successful, pending or hidden-language IDs');
  let rows=await json('/api/dialogs');
  check(rows.find(row=>row.conversation_id==='synthetic-failed-ru').status==='evaluated','Failed RU retry did not finish');
  check(rows.find(row=>row.conversation_id==='synthetic-good').evaluation_id===good,'Successful assessment overwritten');
  check(rows.find(row=>row.conversation_id==='synthetic-failed-kz').status==='error','Hidden language retried');
  check(rows.find(row=>row.conversation_id==='synthetic-pending').evaluation_id==='synthetic-pending-old','Pending assessment overwritten');
  const denied=await page.request.post(origin+'/api/evaluations',{data:{conversation_ids:['synthetic-good'],checklist_id:'freedom-chat',only_failed:true}});
  check(denied.status()===409,'Server failed to guard a stale retry');
  passed.push('filtered failed-only retry requires confirmation and atomically preserves successful/pending/hidden records');

  await page.goto(origin+'/#dialog/synthetic-history');await page.locator('#evaluation-panel').waitFor();
  await page.locator('[data-evaluation-history]>summary').click();await page.locator('[data-history-id="synthetic-history-old"] button').click();
  await page.waitForFunction(()=>location.hash.endsWith('/evaluation/synthetic-history-old')&&document.querySelector('#criterion-c01 .result-row-title')?.textContent.includes('Установление контакта'));
  check(!await page.locator('#evaluation-panel').innerText().then(text=>text.includes('Вымышленное правило второй версии')),'Old result used newer checklist');
  await page.reload();await page.locator('#evaluation-panel').waitFor();
  check((await page.locator('#criterion-c01 .result-row-title').innerText()).includes('Установление контакта'),'Historical deep link did not survive reload');
  await page.locator('[data-evaluation-history]>summary').click();
  check(await page.locator('[data-history-id="synthetic-history-old"][aria-current=true]').count()===1,'Selected historical row not marked');
  await widths();await page.screenshot({path:'/private/tmp/cqa-operations-history-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/private/tmp/cqa-operations-history-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('link',{name:'Отчёт',exact:true}).click();await page.locator('.quality-report').waitFor();
  check(page.url().endsWith('/evaluation/synthetic-history-old'),'Report switched to latest evaluation');
  check((await page.locator('.quality-report').innerText()).includes('Чек-лист качества чатов'),'Report used newer checklist');
  await page.goto(origin+'/#dialog/synthetic-history/evaluation/'+good);await page.getByText('Оценка не относится к выбранному диалогу.',{exact:true}).waitFor();
  passed.push('history model/version/score and old snapshot survive reload/report; foreign evaluation rejected');

  const beforeReads=posts.length;
  await page.goto(origin+'/#analytics');await page.locator('[data-analytics-criterion]').first().waitFor();
  const group=page.locator('.analytics-filters select').first(),language=page.locator('.analytics-filters select').nth(1);
  check(await group.locator('option').count()===2,'Checklist versions were merged');
  const v1=await group.locator('option').evaluateAll(options=>options.find(option=>option.textContent.includes('v1')).value);
  await group.selectOption(v1);await language.selectOption('EN');
  check((await page.locator('.analytics-workspace .stat-value').first().innerText())==='1','Language analytics scope wrong');
  await language.selectOption('KZ');await page.getByText('Без оценок для выбранного языка.',{exact:true}).waitFor();
  await language.selectOption('');await page.locator('.analytics-dialogs>summary').click();
  const target=await page.locator('.analytics-dialogs>summary').boundingBox();check(target.height>=44,'Analytics disclosure target too small');
  await widths();await page.screenshot({path:'/private/tmp/cqa-operations-analytics-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/private/tmp/cqa-operations-analytics-mobile.png',fullPage:true});
  await page.locator('.language-trigger').click();await page.locator('[data-language=en]').click();await page.getByRole('heading',{name:'Analytics',exact:true}).waitFor();
  check(await group.inputValue()===v1,'Locale switch lost analytics version filter');
  check(posts.length===beforeReads,'History/analytics launched a new model evaluation');
  passed.push('GET-only analytics isolate versions and languages, honest empty state, mobile internal scroll, locale state retained');
  check(errors.length===0,JSON.stringify(errors));
  return {passed,pageErrors:errors,uiEvaluationPosts:posts.length,paidCalls:0,realFastApi:true,realSQLite:true};
 }catch(error){await page.screenshot({path:'/private/tmp/cqa-operations-failure.png',fullPage:true}).catch(()=>{});throw new Error(error.message+'; passed='+passed.join('; '));}
 finally{await context.close();}
}
