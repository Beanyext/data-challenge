async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [], requests = [], passed = [];
  const check = (value, message) => { if (!value) throw new Error(message); };
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://localhost:8766' || url.pathname.startsWith('/api/')) {
      requests.push(url.pathname); return route.abort();
    }
    return route.continue();
  });
  const openCriterion = async id => {
    const row = page.locator(`#criterion-${id} .result-row`);
    if (await row.getAttribute('aria-expanded') === 'false') await row.click();
  };
  try {
    await page.goto('http://localhost:8766/?demo=1&lang=ru#dialog/demo-ru-001');
    const operator = page.locator('[data-inspect-turn="4"]');
    await operator.focus(); await page.keyboard.press('Enter');
    await page.locator('.evidence-selected .result-reason').waitFor();
    check(await page.locator('.result-criterion').count() === 8, 'Navigation retains the full result');
    await operator.click();
    check(await page.locator('.evidence-selected .result-reason').isVisible(), 'Repeated navigation keeps explanation open');
    await page.locator('.evidence-selected .evidence-link[data-turn]').first().click();
    check(await page.locator('.turn.highlight').count() === 1, 'Evidence returns to its message');
    await page.locator('#criterion-c07 .result-row').scrollIntoViewIfNeeded();
    check(await page.locator('.transcript-panel').evaluate(node => getComputedStyle(node).position === 'sticky' && node.getBoundingClientRect().top >= 0), 'Desktop transcript remains alongside the evaluation');
    passed.push('keyboard and repeated message navigation, reverse evidence, sticky desktop transcript');

    await openCriterion('c07');
    await page.locator('#criterion-c07 [data-appeal]').click();
    const comment = 'Учебное обращение «проверка» & <script>window.__unsafe=1</script>';
    await page.locator('#appeal-form textarea').fill(comment);
    await page.locator('#appeal-form button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#criterion-c07 [data-appeal]')?.disabled);
    await page.locator('[data-nav=appeals]').click();
    await page.locator('.appeal-evidence').waitFor();
    check(!await page.locator('.appeal-evidence').evaluate(node => node.open), 'Evidence starts collapsed');
    check(await page.getByText(comment, { exact: true }).isVisible(), 'Operator comment remains visible');
    await page.locator('[data-review]').click();
    await page.locator('[name=reason]').waitFor();
    check(await page.locator('.appeal-evidence').evaluate(node => node.open), 'Review opens evidence');
    await page.screenshot({ path: 'C:/Users/temer/AppData/Local/Temp/cqa-light-appeal.png' });
    await page.locator('[name=decision-status][value=changed]').check();
    await page.locator('select[name=answer]').selectOption('no');
    await page.locator('[name=reason]').fill('Вымышленное решение для проверки интерфейса.');
    await page.locator('form[data-decision] button[type=submit]').click();
    await page.locator('[data-appeal-filter=all]').click();
    await page.locator('.appeal-decision').waitFor();
    await page.locator('.appeal-actions [data-context]').click();
    await page.locator('.result-total-revision').waitFor();
    await page.reload(); await page.locator('.result-total-revision').waitFor();
    check(!await page.evaluate(() => window.__unsafe), 'Comments are escaped');
    passed.push('appeal disclosure, review, changed decision and original score survive navigation and reload');

    await page.locator('[data-nav=checklists]').click();
    const title = 'Контакт «Freedom» & учебный критерий';
    await page.locator('[data-criterion=title]').fill(title);
    check(await page.locator('#criterion-heading').innerText() === title, 'Editor title reflects the current draft');
    check(await page.locator('#dirty-label').innerText() === 'Есть изменения', 'Dirty status is visible');
    await page.locator('[data-action=save-checklist]').click();
    await page.waitForFunction(() => document.querySelector('#dirty-label')?.textContent === 'Сохранено');
    check((await page.locator('#choose-checklist').inputValue()).endsWith('@2'), 'New checklist version saved');
    await page.locator('[data-nav=dialogs]').click();
    await page.locator('[data-open="demo-ru-001"]').first().click();
    check((await page.locator('.result-overview-meta').innerText()).includes('v1'), 'Existing evaluation retains its checklist version');
    await page.emulateMedia({ media: 'print' });
    check(await page.locator('.print-report').isVisible() && !await page.locator('.dialog-workspace').isVisible(), 'Print uses the complete dedicated report');
    check(await page.locator('.print-turn').count() === 11, 'Print retains the complete transcript');
    await page.emulateMedia({ media: 'screen' });
    passed.push('checklist draft title, save version, historical result and print report');

    for (const locale of ['ru', 'en', 'kk']) {
      await page.goto(`http://localhost:8766/?demo=1&lang=${locale}#dialog/demo-ru-001`);
      await page.locator('[data-inspect-turn="4"]').waitFor();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${locale}: no desktop overflow`);
      await page.locator('[data-inspect-turn="4"]').click();
      await page.locator('.evidence-selected .result-reason').waitFor();
    }
    passed.push('RU/EN/KK desktop navigation and layout');

    // Short mobile smoke only; the user deferred the detailed mobile audit.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://localhost:8766/?demo=1&lang=ru#dialog/demo-ru-001');
    await page.locator('[data-inspect-turn="4"]').click();
    check(await page.locator('#evaluation-panel').isVisible() && !await page.locator('#transcript-panel').isVisible(), 'Narrow navigation selects evaluation');
    await page.locator('.evidence-selected .evidence-link[data-turn]').first().click();
    check(await page.locator('#transcript-panel').isVisible(), 'Narrow reverse navigation reveals transcript');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No narrow overflow');
    passed.push('short mobile roundtrip and overflow smoke');
    check(!requests.length, 'No API or external requests');
    check(!errors.length, JSON.stringify(errors));
    return { passed, pageErrors: errors, realApiCalls: 0, paidCalls: 0 };
  } finally { await context.close(); }
}
