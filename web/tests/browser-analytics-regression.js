async (originalPage) => {
 const origin='http://127.0.0.1:8767',context=await originalPage.context().browser().newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
 const errors=[],blocked=[],passed=[],check=(value,message)=>{if(!value)throw new Error(message);};
 const json=async path=>{const response=await page.request.get(origin+path);check(response.ok(),'Read failed '+path);return response.json();};
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin||!['GET','HEAD'].includes(request.method())){blocked.push(request.method()+' '+url.pathname);return route.abort();}return route.continue();});
 try {
  check((await json('/api/health')).provider==='mock','Requires isolated mock fixture');
  const rows=await json('/api/dialogs'),eligible=rows.filter(row=>row.status==='evaluated');
  const evaluations=await Promise.all(eligible.map(row=>json('/api/evaluations/'+encodeURIComponent(row.evaluation_id))));
  check(evaluations.length===3&&evaluations.every(ev=>ev.complete===true&&ev.criteria.find(item=>item.criterion_id==='c08').applicable===false),'Unexpected comparison_server fixture');
  const expectedAverage=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(evaluations.reduce((sum,ev)=>sum+ev.total,0)/evaluations.length);
  const original=evaluations.find(ev=>ev.conversation_id==='synthetic-en'),endpoint=origin+'/api/evaluations/'+encodeURIComponent(original.id);
  await page.goto(origin+'/#analytics');await page.locator('[data-analytics-criterion=c08]').waitFor();
  const workspace=page.locator('.analytics-workspace'),stats=workspace.locator('.stat-value'),gross=workspace.locator('[data-analytics-criterion=c08]');
  const settled=()=>page.waitForFunction(()=>!document.querySelector('.analytics-workspace button')?.disabled&&document.querySelector('[data-analytics-criterion=c08]'));
  const refresh=async()=>{const response=page.waitForResponse(response=>response.url()===endpoint);await workspace.getByRole('button',{name:'Обновить аналитику',exact:true}).click();await response;await settled();};
  const full=async(expected=expectedAverage)=>{check(await stats.nth(0).innerText()==='3','Saved records missing');const actual=await stats.nth(1).innerText();check(actual===expected,'Wrong complete-score average '+actual+' expected '+expected);check((await workspace.locator('.stat').nth(1).innerText()).includes('Полных итогов: 3'),'Full evaluations excluded');check(await gross.locator('td').nth(2).innerText()==='3','Gross denominator excludes valid answers');check(await gross.locator('td').nth(4).innerText()==='0','Gross answers incorrectly unknown');};
  await full();passed.push('real complete DTOs with non-scoring gross criterion enter average and gross denominator');
  const reordered=structuredClone(original);reordered.checklist.sections=reordered.checklist.sections.map(section=>Object.fromEntries(Object.entries(section).reverse()));
  for(const criterion of reordered.checklist.criteria)if(criterion.scale?.steps)criterion.scale.steps=criterion.scale.steps.map(step=>Object.fromEntries(Object.entries(step).reverse()));
  await page.route(endpoint,route=>route.fulfill({json:reordered}));await refresh();await full();await page.unroute(endpoint);
  passed.push('object key order cannot falsely invalidate a shared checklist snapshot');
  const violation=structuredClone(original);violation.gross_error=true;Object.assign(violation.criteria.find(item=>item.criterion_id==='c08'),{answer:'yes',gross_error:true});
  await page.route(endpoint,route=>route.fulfill({json:violation}));await refresh();await full();
  check(await stats.nth(2).innerText()==='1','Gross summary missing violation');check((await gross.locator('td').first().innerText()).includes('1/3'),'Gross violation ratio incorrect');await page.unroute(endpoint);
  passed.push('positive control: a gross violation is counted separately from score applicability');
  const partial=structuredClone(original);partial.complete=false;Object.assign(partial.criteria[0],{answer:null,needs_review:true});
  await page.route(endpoint,route=>route.fulfill({json:partial}));await refresh();
  check(await stats.nth(1).innerText()==='100','Partial numeric total contaminated average');check((await workspace.locator('.stat').nth(1).innerText()).includes('Полных итогов: 2'),'Partial assessment counted as complete');await page.unroute(endpoint);await refresh();await full();
  await workspace.locator('.analytics-filters select').nth(1).selectOption('EN');check(await stats.nth(0).innerText()==='1','Language filter wrong');check(await stats.nth(1).innerText()===String(original.total),'Language average wrong');
  await workspace.locator('.analytics-filters select').nth(1).selectOption('KZ');await workspace.getByText('Без оценок для выбранного языка.',{exact:true}).waitFor();
  await workspace.locator('.analytics-filters select').nth(1).selectOption('');await full();
  passed.push('partial score excluded; EN and empty KZ filters stay honest');
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflows at '+width);}
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});await page.screenshot({path:'/private/tmp/cqa-analytics-repaired-wide.png',fullPage:false});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/private/tmp/cqa-analytics-repaired-narrow.png',fullPage:false});
  check(JSON.stringify(original)===JSON.stringify(await json('/api/evaluations/'+encodeURIComponent(original.id))),'Read-only checks mutated SQLite');
  check(errors.length===0,JSON.stringify(errors));check(blocked.length===0,JSON.stringify(blocked));
  return {passed,pageErrors:errors,blockedRequests:blocked,savedAverage:expectedAverage,realFastApi:true,realSQLite:true,paidCalls:0};
 } catch(error){await page.screenshot({path:'/private/tmp/cqa-analytics-regression-failure.png',fullPage:true}).catch(()=>{});throw new Error(error.message+'; passed='+passed.join('; '));}
 finally{await context.close();}
}
