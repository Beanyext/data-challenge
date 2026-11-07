async (originalPage) => {
 const origin='http://127.0.0.1:8767',context=await originalPage.context().browser().newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage();
 const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/dialogs/upload')&&r.method()==='POST')posts.push(r);});
 const check=(v,m)=>{if(!v)throw new Error(m);};
 const file=(name,text)=>({name,mimeType:'application/json',buffer:Buffer.from(text)});
 try {
  const health=await (await page.request.get(`${origin}/api/health`)).json();check(health.provider==='mock','Requires isolated mock server');
  const before=(await(await page.request.get(`${origin}/api/dialogs`)).json()).length;
  await page.goto(`${origin}/#dialogs`);await page.locator('#dialog-rows tr').first().waitFor();
  for(const raw of ['', '{bad']){
   await page.locator('#upload-file').setInputFiles(file('вымышленная-ошибка.json',raw));
   await page.getByText('Файл должен содержать корректный JSON.',{exact:true}).waitFor();
   check(posts.length===0,'Invalid JSON should not reach the server');
  }
  const id=`synthetic-upload-${Date.now()}`;
  const invalid={conversation_id:id,channel:'agent chat',language:'KZ',transcript:[]};
  const invalidResponse=page.waitForResponse(r=>r.url().endsWith('/api/dialogs/upload'));
  await page.locator('#upload-file').setInputFiles(file('пустой-диалог.json',JSON.stringify(invalid)));
  check((await invalidResponse).status()===400,'Empty transcript accepted');
  check((await(await page.request.get(`${origin}/api/dialogs`)).json()).length===before,'Invalid transcript changed the list');
  const record={...invalid,transcript:[{speaker:'client',timestamp:'00:00',text:'Вымышленный сұрақ «ҚАЗ» & <script>window.__unsafeUpload=1</script>'},{speaker:'operator',timestamp:'00:02',text:'Вымышленный ответ.'}]};
  for(let i=0;i<2;i++){
   const response=page.waitForResponse(r=>r.url().endsWith('/api/dialogs/upload'));
   await page.locator('#upload-file').setInputFiles(file('вымышленный-диалог.json',JSON.stringify(record)));
   const result=await response;check(result.ok(),'Valid upload failed');
   if(i===1)check((await result.json()).same===1,'Repeated upload should be idempotent');
  }
  await page.getByRole('button',{name:`Открыть ${id}`,exact:true}).waitFor();
  check((await(await page.request.get(`${origin}/api/dialogs`)).json()).length===before+1,'Repeat created duplicate dialog');
  check(!await page.evaluate(()=>window.__unsafeUpload),'Source markup executed');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile list overflows');
  check(errors.length===0,JSON.stringify(errors));
  return {emptyAndMalformedBlocked:true,emptyTranscriptRejected:true,duplicateIdempotent:true,cyrillicKazakhSpecialSafe:true,mobileOverflow:false,pageErrors:errors,paidCalls:0};
 }finally{await context.close();}
}
