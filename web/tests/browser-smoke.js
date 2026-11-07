async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const results = [];
  try {
    await page.goto('http://127.0.0.1:8765/?demo=1');
    await page.getByRole('heading', { name: 'Диалоги', exact: true }).waitFor();
    check(await page.locator('#dialog-rows tr').count() === 6, 'Six starter dialogs expected');
    await page.getByRole('searchbox', { name: 'Поиск диалога' }).fill('Такого диалога нет 🧪');
    check(await page.locator('#dialog-rows tr').count() === 0, 'Empty search');
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
    await page.locator('[data-filter=language]').selectOption('KZ');
    check(await page.locator('#dialog-rows tr').count() === 1, 'KZ filter');
    await page.locator('[data-filter=language]').selectOption('');
    results.push('search, empty state, language filter');

    await page.getByRole('button', { name: 'Открыть demo-ru-001', exact: true }).click();
    await page.locator('.evidence-link').first().click();
    check(await page.locator('.turn.highlight').count() === 1, 'Evidence target');
    await page.locator('#criterion-c07 [data-appeal]').click();
    await page.getByRole('textbox', { name: 'Почему вы не согласны' }).fill('Учебная апелляция «проверка» & <script>window.__unsafe=1</script>');
    await page.getByRole('button', { name: 'Подать апелляцию', exact: true }).click();
    await page.locator('#criterion-c07').getByRole('button', { name: 'Апелляция подана' }).waitFor();
    await page.getByRole('link', { name: /Апелляции/ }).click();
    await page.getByRole('button', { name: 'Рассмотреть', exact: true }).click();
    await page.getByRole('radio', { name: 'Изменить оценку' }).check();
    await page.locator('select[name=answer]').selectOption('no');
    await page.getByRole('textbox', { name: 'Причина решения' }).fill('Учебное решение проверяющего.');
    await page.getByRole('button', { name: 'Сохранить решение', exact: true }).click();
    await page.getByRole('button', { name: /Все обращения/ }).click();
    await page.getByRole('button', { name: 'Открыть диалог ↗', exact: true }).click();
    await page.locator('#criterion-c07 .revision').waitFor();
    check((await page.locator('.result-overview').innerText()).includes('Исходная оценка'), 'Original score retained');
    await page.reload();
    await page.locator('#criterion-c07 .revision').waitFor();
    check(!await page.evaluate(() => window.__unsafe), 'Escaped user text');
    results.push('evidence, appeal, review, recalculation, reload, XSS text');

    await page.getByRole('link', { name: 'Чек-листы', exact: true }).click();
    await page.locator('[data-criterion="title"]').fill('Контакт «Freedom» & проверка');
    await page.getByRole('button', { name: '＋ Добавить критерий', exact: true }).click();
    await page.locator('[data-criterion="description"]').fill('Проверить дополнительное действие.');
    await page.locator('[data-criterion="answer_type"]').selectOption('scale');
    await page.locator('[data-criterion="steps"]').fill('0 | Не выполнено\n10 | Выполнено');
    await page.getByRole('button', { name: 'Сохранить версию ↗', exact: true }).click();
    await page.getByText('Сохранено', { exact: true }).waitFor();
    check((await page.locator('#choose-checklist').innerText()).includes('v2'), 'New checklist version');
    await page.getByRole('link', { name: /Диалоги/ }).click();
    await page.getByRole('button', { name: 'Открыть demo-voice-001', exact: true }).click();
    await page.getByRole('button', { name: 'Оценить диалог ↗', exact: true }).click();
    await page.getByRole('checkbox', { name: /Понимаю, что это учебная/ }).check();
    await page.locator('#evaluate-form').getByRole('button', { name: 'Оценить диалог', exact: true }).click();
    await page.locator('.result-score').waitFor();
    check(await page.locator('.criterion').count() === 9, 'New criterion applied');
    await page.getByRole('button', { name: 'Загрузить запись', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#call-audio')?.duration > 0);
    await page.locator('.evidence-link').first().click();
    results.push('checklist version, new criterion, background evaluation, audio');

    await page.getByRole('link', { name: /Диалоги/ }).click();
    await page.locator('#upload-file').setInputFiles({ name: 'учебный.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ conversation_id: 'qa-upload', channel: 'agent chat', language: 'RU', audio_url: null, transcript: [{ timestamp: '00:00', speaker: 'client', text: 'Вымышленный запрос <img src=x onerror=window.__unsafe=1>' }] })) });
    await page.getByRole('button', { name: 'Открыть qa-upload', exact: true }).waitFor();
    await page.locator('#upload-file').setInputFiles({ name: 'ошибка.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
    await page.getByText('Файл должен содержать корректный JSON.', { exact: true }).waitFor();
    results.push('JSON upload, malformed input');

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `List overflow at ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/private/tmp/cqa-smoke-mobile.png', fullPage: true });
    await page.getByRole('link', { name: 'Чек-листы', exact: true }).click();
    await page.getByRole('heading', { name: 'Чек-листы', exact: true }).waitFor();
    const url = page.url();
    await page.locator('.skip-link').focus();
    await page.keyboard.press('Enter');
    check(page.url() === url, 'Skip-link keeps route');
    check(await page.evaluate(() => getComputedStyle(document.querySelector('[data-edit=name]')).fontSize === '16px'), 'Mobile input size');
    results.push('320/390/768/1440 layouts, keyboard skip link, mobile inputs');

    await page.getByRole('button', { name: 'Настройки подключения', exact: true }).click();
    await page.getByRole('radio', { name: 'Сервер команды', exact: true }).check();
    await page.getByRole('button', { name: 'Подключиться', exact: true }).click();
    await page.getByRole('heading', { name: 'Нет подключения к данным', exact: true }).waitFor();
    check(!await page.locator('#demo-banner').isVisible(), 'No silent demo fallback');
    check(await page.getByRole('button', { name: 'Настройки подключения', exact: true }).isVisible(), 'Mobile settings available');
    results.push('API error state, no silent fallback, mobile connection settings');
    check(errors.length === 0, JSON.stringify(errors));
    return { passed: results, pageErrors: errors };
  } finally { await context.close(); }
}
