async (originalPage) => {
 const origin='http://127.0.0.1:8767',context=await originalPage.context().browser().newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
 const errors=[],blocked=[],passed=[],reads=[];
 const check=(value,message)=>{if(!value)throw new Error(message);};
 const json=async path=>{const response=await page.request.get(origin+path);check(response.ok(),'Read failed '+path);return response.json();};
 const panel=page.locator('[data-evaluation-comparison]');
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin||!['GET','HEAD'].includes(request.method())){blocked.push(request.method()+' '+url.pathname);return route.abort();}if(url.pathname.startsWith('/api/evaluations/'))reads.push(url.pathname);return route.continue();});
 try {
  check((await json('/api/health')).provider==='mock','Use isolated mock fixture');
  const before=await json('/api/dialogs/synthetic-history/evaluations');
  const original=await json('/api/evaluations/synthetic-history-compare');
  await page.goto(origin+'/#dialog/synthetic-history');await page.locator('#evaluation-panel').waitFor();
  await page.locator('[data-evaluation-history]>summary').click();await panel.locator('form').waitFor();
  check(await panel.getByRole('combobox',{name:'Первый запуск',exact:true}).inputValue()==='synthetic-history-old','Wrong initial first run');
  check(await panel.getByRole('combobox',{name:'Второй запуск',exact:true}).inputValue()==='synthetic-history-compare','Different versions selected together');
  const initialReads=reads.length;await panel.getByRole('button',{name:'Сравнить оценки',exact:true}).click();await panel.locator('.comparison-result').waitFor();
  check(reads.length===initialReads+2,'Comparison should fetch exactly two saved runs');
  check((await panel.locator('.comparison-summary').innerText()).includes('Изменено критериев: 1 из 8.'),'Wrong criterion changes');
  check((await panel.locator('.comparison-summary').innerText()).includes('+10'),'Saved total delta not shown');
  check(await panel.locator('[data-comparison-criterion]').count()===8,'Full comparison missing criteria');
  await panel.getByLabel('Только изменения',{exact:true}).check();check(await panel.locator('[data-comparison-criterion]').count()===1,'Only-changes filter failed');
  check(await panel.locator('[data-comparison-criterion]').getAttribute('data-comparison-criterion')==='c01','Wrong changed criterion');
  await panel.locator('.comparison-evidence>summary').first().click();await panel.locator('.comparison-evidence>summary').nth(1).click();
  check((await panel.locator('.comparison-evidence').first().innerText()).includes('Реплика № 3'),'Source turn numbering incorrect');
  check((await panel.locator('.comparison-evidence').first().innerText()).toLowerCase().includes('вымышленный оператор'),'Original transcript not shown');
  passed.push('explicit comparison reads two saved runs; exact +10 delta; one changed criterion; original evidence numbering');
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflows at '+width);}
  await panel.screenshot({path:'/private/tmp/cqa-comparison-wide.png'});
  await page.setViewportSize({width:390,height:844});await panel.screenshot({path:'/private/tmp/cqa-comparison-narrow.png'});
  for(const locale of ['en','kk','ru']){await page.locator('.language-trigger').click();await page.locator(`[data-language=${locale}]`).click();await page.waitForFunction(language=>document.documentElement.lang===language,locale);check(await panel.locator('.comparison-filter input').isChecked(),'Locale lost filter');check(await panel.locator('[data-comparison-criterion]').count()===1,'Locale lost comparison');}
  passed.push('RU EN KK preserve loaded comparison and filter; responsive at 320/390/768/1440');

  await panel.getByRole('combobox',{name:'Первый запуск',exact:true}).selectOption('synthetic-history-new');
  check(await panel.getByRole('combobox',{name:'Второй запуск',exact:true}).isDisabled(),'Version without pair not disabled');
  check(await panel.locator('.comparison-result').count()===0,'Previous version comparison remains visible');
  await panel.getByRole('combobox',{name:'Первый запуск',exact:true}).selectOption('synthetic-history-old');
  const endpoint=origin+'/api/evaluations/synthetic-history-compare';
  await page.route(endpoint,route=>route.fulfill({json:{...original,conversation_id:'synthetic-foreign'}}));
  await panel.getByRole('button',{name:'Сравнить оценки',exact:true}).click();await panel.getByRole('alert').waitFor();
  check((await panel.getByRole('alert').innerText()).includes('не относятся'),'Foreign evaluation not rejected');check(await panel.locator('.comparison-result').count()===0,'Foreign result displayed');await page.unroute(endpoint);
  await page.route(endpoint,route=>route.fulfill({status:503,json:{detail:'https://synthetic.invalid/?sig=never-render'}}));
  await panel.getByRole('button',{name:'Сравнить оценки',exact:true}).click();await panel.getByText('Не удалось загрузить сравнение. Нажмите «Сравнить оценки» ещё раз.',{exact:true}).waitFor();
  check(!(await panel.innerText()).includes('never-render'),'Upstream error exposed');await page.unroute(endpoint);
  await page.route(endpoint,route=>route.fulfill({json:{...original,criteria:original.criteria.filter(item=>item.criterion_id!=='c01')}}));
  await panel.getByRole('button',{name:'Сравнить оценки',exact:true}).click();await panel.getByText('Есть неполные оценки. Разница итогов не рассчитывается.',{exact:true}).waitFor();
  check((await panel.locator('.comparison-summary').innerText()).includes('Разница баллов: —'),'Partial comparison invented delta');await page.unroute(endpoint);
  await panel.getByRole('button',{name:'Сравнить оценки',exact:true}).click();await panel.getByText('Разница баллов:',{exact:false}).filter({hasText:'+10'}).waitFor();
  passed.push('different-version pair disabled; foreign saved result rejected; server error private and retryable; missing answer has no total delta');
  check(JSON.stringify(before)===JSON.stringify(await json('/api/dialogs/synthetic-history/evaluations')),'Comparison changed persisted history');
  check(JSON.stringify(original)===JSON.stringify(await json('/api/evaluations/synthetic-history-compare')),'Comparison changed saved evaluation');
  check(errors.length===0,JSON.stringify(errors));check(blocked.length===0,JSON.stringify(blocked));
  return {passed,pageErrors:errors,blockedRequests:blocked,paidCalls:0,realFastApi:true,realSQLite:true};
 } catch(error){await page.screenshot({path:'/private/tmp/cqa-comparison-failure.png',fullPage:true}).catch(()=>{});throw new Error(error.message+'; passed='+passed.join('; '));}
 finally{await context.close();}
}
