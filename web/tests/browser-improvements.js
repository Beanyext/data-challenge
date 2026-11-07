async (originalPage) => {
  const context=await originalPage.context().browser().newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],passed=[];
  page.on('pageerror',error=>errors.push(error.message));
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  const save=async()=>{
    await page.getByRole('button',{name:'Сохранить версию ↗',exact:true}).click();
    await page.getByRole('heading',{name:'Проверить изменения',exact:true}).waitFor();
    await page.getByRole('button',{name:'Сохранить новую версию',exact:true}).click();
    await page.getByText('Сохранено',{exact:true}).waitFor();
  };
  try {
    await page.goto('http://127.0.0.1:8765/?demo=1');
    await page.getByRole('heading',{name:'Диалоги',exact:true}).waitFor();
    await page.locator('[data-filter=language]').selectOption('KZ');
    check(await page.locator('.stat-value').first().innerText()==='1','Summary follows language filter');
    await page.locator('#summary-scope').selectOption('all');
    check(await page.locator('.stat-value').first().innerText()==='6','Whole-set scope stays explicit');
    await page.locator('[data-queue=attention]').click();
    check(await page.locator('#dialog-rows tr').count()===0,'Attention intersects language filter');
    await page.locator('#summary-scope').selectOption('filtered');
    check(await page.locator('.stat-value').nth(2).innerText()==='—','Empty selection has no average, not zero');
    await page.getByRole('button',{name:'Сбросить фильтры',exact:true}).click();
    await page.locator('[data-queue=attention]').click();
    check(await page.locator('#dialog-rows tr').count()===1,'Gross-error conversation enters attention queue');
    check(await page.locator('#list-heading-count').innerText()==='1 из 6','Queue heading counts visible items');
    passed.push('attention queue and filtered/global/empty summaries');

    await page.locator('[data-queue=all]').click();
    await page.getByRole('button',{name:'Открыть demo-ru-001',exact:true}).click();
    await page.locator('#criterion-c07 [data-appeal]').click();
    await page.getByRole('textbox',{name:'Почему вы не согласны'}).fill('Проверка «завершения» & <script>window.__featureUnsafe=1</script>');
    await page.getByRole('button',{name:'Подать апелляцию',exact:true}).click();
    await page.locator('#criterion-c07').getByRole('button',{name:'Апелляция подана'}).waitFor();
    await page.getByRole('link',{name:/Диалоги/}).first().click();
    await page.locator('[data-queue=attention]').click();
    check(await page.locator('#dialog-rows tr').count()===2,'Open appeal enters attention queue');
    await page.locator('[data-filter=status]').selectOption('appeal');
    check(await page.locator('#dialog-rows tr').count()===1,'Open appeal reason filter');
    await page.getByRole('link',{name:/Апелляции/}).click();
    await page.getByRole('button',{name:'Рассмотреть',exact:true}).click();
    check(await page.locator('.review-transcript .turn.highlight').count()>0,'Inline source evidence highlighted');
    check(page.url().endsWith('#appeals'),'Review keeps user on appeal screen');
    check(!await page.evaluate(()=>window.__featureUnsafe),'Appeal HTML stays text');
    await page.screenshot({path:'/private/tmp/cqa-improvements-review.png',fullPage:true});
    await page.getByRole('radio',{name:'Изменить оценку'}).check();
    await page.locator('select[name=answer]').selectOption('no');
    await page.getByRole('textbox',{name:'Причина решения'}).fill('Черновик решения «проверка» & контекст.');
    await page.getByRole('button',{name:'Открыть полный диалог ↗',exact:true}).click();
    await page.getByRole('heading',{name:'Транскрипт',exact:true}).waitFor();
    await page.getByRole('link',{name:/Апелляции/}).click();
    await page.getByRole('button',{name:'Рассмотреть',exact:true}).click();
    check(await page.getByRole('textbox',{name:'Причина решения'}).inputValue()==='Черновик решения «проверка» & контекст.','Review draft survives transcript navigation');
    check(await page.getByRole('radio',{name:'Изменить оценку'}).isChecked(),'Draft decision type survives navigation');
    check(await page.locator('select[name=answer]').inputValue()==='no','Draft answer survives navigation');
    await page.getByRole('textbox',{name:'Причина решения'}).fill('Проверено по исходной реплике. Учебный пересмотр.');
    await page.getByRole('button',{name:'Сохранить решение',exact:true}).click();
    await page.getByRole('button',{name:/Все обращения/}).click();
    await page.getByRole('button',{name:'Открыть диалог ↗',exact:true}).click();
    await page.locator('#criterion-c07 .result-revision').waitFor();
    await page.getByRole('link',{name:'Отчёт',exact:true}).click();
    await page.getByRole('heading',{name:'Отчёт о качестве диалога',exact:true}).waitFor();
    check((await page.locator('.quality-report').innerText()).includes('Проверено по исходной реплике'),'Report includes review decision');
    check((await page.locator('.report-original').innerText()).includes('85,38'),'Report retains original score');
    check((await page.locator('.report-total').innerText()).includes('77,69'),'Report shows final score');
    await page.evaluate(()=>{window.__printCalls=0;window.print=()=>window.__printCalls++;});
    await page.getByRole('button',{name:'Печать / PDF',exact:true}).click();
    check(await page.evaluate(()=>window.__printCalls)===1,'Print action invoked once');
    await page.screenshot({path:'/private/tmp/cqa-improvements-report.png',fullPage:true});
    await page.emulateMedia({media:'print'});
    check(!await page.locator('.sidebar').isVisible(),'Print hides application navigation');
    check(!await page.locator('.print-toolbar').isVisible(),'Print hides print controls');
    check(await page.locator('.quality-report').isVisible(),'Report remains visible for print');
    await page.pdf({path:'/private/tmp/cqa-improvements-report.pdf',format:'A4',preferCSSPageSize:true,printBackground:true});
    await page.emulateMedia({media:'screen'});
    passed.push('inline appeal proof, source-based decision, original/final report and PDF');

    await page.getByRole('link',{name:'Чек-листы',exact:true}).click();
    await page.locator('[data-criterion=weight]').fill('12');
    await page.getByRole('button',{name:'Сохранить версию ↗',exact:true}).click();
    await page.getByRole('heading',{name:'Проверить изменения',exact:true}).waitFor();
    check((await page.locator('.diff-before').innerText()).includes('10'),'Preview has original weight');
    check((await page.locator('.diff-after').innerText()).includes('12'),'Preview has changed weight');
    await page.screenshot({path:'/private/tmp/cqa-improvements-diff.png',fullPage:true});
    await page.getByRole('button',{name:'Продолжить редактирование',exact:true}).click();
    check((await page.locator('#choose-checklist').innerText()).includes('v1'),'Cancel does not save a version');
    await save();
    check((await page.locator('#choose-checklist').innerText()).includes('v2'),'Confirmed preview creates new version');
    await page.getByRole('button',{name:'Сохранить версию ↗',exact:true}).click();
    await page.getByText('Изменений нет. Новая версия не требуется.',{exact:true}).waitFor();
    check(!await page.locator('#modal').isVisible(),'Unchanged draft creates no version');
    await page.getByRole('button',{name:'＋ Добавить критерий',exact:true}).click();
    await page.locator('[data-criterion=description]').fill('Дополнительное учебное правило для проверки новой конфигурации.');
    await save();
    passed.push('before/after preview, cancel, explicit save, unchanged draft, added criterion');

    await page.getByRole('link',{name:/Диалоги/}).first().click();
    // The earlier appeal filter is deliberately preserved; reset it before choosing another dialog.
    await page.locator('[data-filter=status]').selectOption('');
    await page.locator('[data-queue=all]').click();
    await page.getByRole('button',{name:'Открыть demo-voice-001',exact:true}).click();
    await page.locator('[data-action=evaluate-dialog]').click();
    await page.getByRole('checkbox',{name:/Понимаю, что это учебная/}).check();
    await page.locator('#evaluate-form').getByRole('button',{name:'Оценить диалог',exact:true}).click();
    await page.locator('.result-score').waitFor();
    check(await page.locator('.criterion').count()===9,'New checklist used by evaluation');
    await page.locator('#criterion-c01 [data-appeal]').click();
    await page.getByRole('textbox',{name:'Почему вы не согласны'}).fill('Учебная проверка звукового фрагмента.');
    await page.getByRole('button',{name:'Подать апелляцию',exact:true}).click();
    await page.locator('#criterion-c01').getByRole('button',{name:'Апелляция подана'}).waitFor();
    await page.getByRole('link',{name:/Апелляции/}).click();
    await page.getByRole('button',{name:'Рассмотреть',exact:true}).click();
    await page.getByRole('button',{name:'Прослушать фрагмент',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.review-audio audio')?.duration>0);
    check(await page.locator('.review-audio audio').evaluate(a=>a.paused),'Inline audio never autoplays');
    await page.waitForFunction(()=>document.querySelector('.review-audio audio')?.currentTime>0);
    passed.push('new evaluation flags review and inline audio seeks without autoplay');

    const widths=[];
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      const dimensions=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));
      check(dimensions.content<=width,`Appeal overflow at ${width}`);widths.push(dimensions);
    }
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'/private/tmp/cqa-improvements-mobile-review.png',fullPage:true});
    await page.getByRole('link',{name:/Диалоги/}).first().click();
    await page.locator('[data-queue=attention]').click();
    check(await page.locator('#dialog-rows tr').count()===2,'Human-review flag and gross-error conversations remain in queue');
    await page.screenshot({path:'/private/tmp/cqa-improvements-queue.png',fullPage:true});
    await page.getByRole('button',{name:'Открыть demo-ru-001',exact:true}).waitFor({state:'hidden'});
    check(errors.length===0,JSON.stringify(errors));
    return {passed,widths,pageErrors:errors,pdf:'/private/tmp/cqa-improvements-report.pdf'};
  } catch(error) {
    await page.screenshot({path:'/private/tmp/cqa-improvements-failure.png',fullPage:true});
    throw new Error(`${error.message}\nCompleted: ${passed.join('; ')}`);
  } finally { await context.close(); }
}
