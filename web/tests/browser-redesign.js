async (originalPage) => {
  const origin = 'http://localhost:8766';
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const pageErrors = [], unexpectedApi = [], passed = [];
  const counts = { apiGets: 0, dialogGets: 0, rejectedWrites: 0, blockedExternal: 0 };
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  page.on('pageerror', error => pageErrors.push(error.message));
  let listMode = 'normal';
  const longTitle = 'Проверка «Ясность» & <img src=x onerror="window.__cqaRedesignXss=1"> ' + 'ОченьДлинноеНазвание'.repeat(14);
  const base = { channel: 'agent chat', gross_error: false, needs_review: false, open_appeals: 0, status: 'evaluated' };
  const rows = [
    { ...base, conversation_id: 'redesign-review-ru', title: longTitle, language: 'RU', evaluation_id: 'evaluation-review-ru', total: 0, needs_review: true },
    { ...base, conversation_id: 'redesign-review-kz', title: 'Синтетикалық тексеру', language: 'KZ', evaluation_id: 'evaluation-review-kz', total: 40, needs_review: true },
    { ...base, conversation_id: 'redesign-appeal-en', title: 'Synthetic appeal', language: 'EN', evaluation_id: 'evaluation-appeal-en', total: 88, open_appeals: 1 },
    { ...base, conversation_id: 'redesign-failed-ru', title: 'Синтетическая ошибка задания', language: 'RU', evaluation_id: null, total: null, status: 'failed' },
    { ...base, conversation_id: 'redesign-error-en', title: 'Synthetic evaluation error', language: 'EN', evaluation_id: null, total: null, status: 'error' },
    { ...base, conversation_id: 'redesign-normal-ru', title: 'Синтетический обычный диалог', language: 'RU', evaluation_id: 'evaluation-normal-ru', total: 92 },
  ];
  const originalRows = JSON.stringify(rows);
  const checklist = {
    id: 'redesign-checklist', version: 1, name: 'Синтетический чек-лист', rounding: { digits: 2 }, guidance: [],
    sections: [{ id: 's1', name: 'Контакт' }],
    criteria: [{ id: 'c01', section_id: 's1', title: 'Приветствие', description: 'Синтетическое правило.', answer_type: 'binary', scale: null, weight: 100, na_allowed: false, na_rule: null, notes: null, gross_error: false }],
  };
  const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  const expectRows = async ids => {
    await page.waitForFunction(expected => {
      const actual = [...document.querySelectorAll('#dialog-rows input[data-select]')].map(input => input.dataset.select).sort();
      return JSON.stringify(actual) === JSON.stringify([...expected].sort());
    }, ids);
  };
  const resetFilters = async () => {
    // An empty result has its own reset button in addition to the active-filter toolbar.
    await page.locator('[data-action="reset-filters"]').first().click();
    await expectRows(rows.map(row => row.conversation_id));
    check(await page.locator('#search-dialogs').inputValue() === '', 'Reset must clear the search input');
    check(await page.locator('[data-filter="language"]').inputValue() === '', 'Reset must clear language');
    check(await page.locator('[data-filter="status"]').inputValue() === '', 'Reset must clear status');
  };

  // All API requests are fixtures; even an accidental write cannot reach a server or model.
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) { counts.blockedExternal++; return route.abort('blockedbyclient'); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (request.method() !== 'GET') {
      counts.rejectedWrites++;
      return json(route, { detail: 'Запись запрещена в изолированном тесте.' }, 405);
    }
    counts.apiGets++;
    if (url.pathname === '/api/dialogs') {
      counts.dialogGets++;
      return listMode === 'error'
        ? json(route, { detail: 'Синтетическая временная ошибка списка.' }, 503)
        : json(route, { dialogs: rows });
    }
    if (url.pathname === '/api/checklists') return json(route, { checklists: [checklist] });
    if (url.pathname === '/api/appeals') return json(route, { appeals: [] });
    unexpectedApi.push(url.pathname);
    return json(route, { detail: 'Неизвестный тестовый маршрут.' }, 404);
  });

  try {
    await page.goto(`${origin}/?lang=ru#dialogs`);
    await page.getByRole('heading', { name: 'Диалоги', exact: true }).waitFor();
    await expectRows(rows.map(row => row.conversation_id));
    check(!await page.locator('#demo-banner').isVisible(), 'Intercepted API mode must remain API mode');
    const initialGets = counts.apiGets;
    const zeroRow = page.locator('#dialog-rows tr').filter({ has: page.locator('[data-select="redesign-review-ru"]') });
    check(await zeroRow.locator('.score-pill').innerText() === '0', 'Zero must render as a score, not a missing value');
    const missingRow = page.locator('#dialog-rows tr').filter({ has: page.locator('[data-select="redesign-failed-ru"]') });
    check(await missingRow.locator('.score-empty').innerText() === '—', 'Missing score must remain distinct from zero');
    check(await zeroRow.locator('.dialog-title').textContent() === longTitle, 'Long API title must render literally without truncating data');
    check(await zeroRow.locator('img, script').count() === 0, 'Markup in title must remain escaped text');
    check(!await page.evaluate(() => window.__cqaRedesignXss), 'Escaped title must not execute');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Long unbroken title must not overflow the page');
    passed.push('zero vs absent score; long Cyrillic title and HTML-like text stay readable and escaped');

    await page.locator('[data-filter="status"]').selectOption('review');
    await expectRows(['redesign-review-ru', 'redesign-review-kz']);
    await page.locator('[data-filter="language"]').selectOption('RU');
    await expectRows(['redesign-review-ru']);
    await page.locator('#search-dialogs').fill('Ясность');
    await expectRows(['redesign-review-ru']);
    await page.locator('#search-dialogs').fill('НесуществующийСинтетическийЗапрос');
    await expectRows([]);
    await page.getByRole('heading', { name: 'Ничего не найдено', exact: true }).waitFor();
    await resetFilters();
    passed.push('review filter combines with language and search; empty results and reset restore all rows');

    await page.locator('[data-filter="status"]').selectOption('appeal');
    await expectRows(['redesign-appeal-en']);
    await resetFilters();
    await page.locator('[data-filter="status"]').selectOption('failed');
    await expectRows(['redesign-failed-ru', 'redesign-error-en']);
    await resetFilters();
    await page.locator('[data-filter="status"]').selectOption('completed');
    await expectRows(['redesign-review-ru', 'redesign-review-kz', 'redesign-appeal-en', 'redesign-normal-ru']);
    await resetFilters();
    passed.push('appeal filter, both failed/error status aliases, and completed filter including zero');

    check(!await page.locator('#selection-toolbar').isVisible(), 'Selection toolbar starts hidden');
    await page.locator('[data-select="redesign-review-ru"]').check();
    await page.locator('#selection-toolbar').waitFor({ state: 'visible' });
    check(!await page.locator('#evaluate-selected').isDisabled(), 'Selecting a row enables the evaluation action');
    check((await page.locator('.selection-count').innerText()).includes('1'), 'Selection count must reflect the selected row');
    await page.locator('[data-action="clear-selection"]').click();
    await page.locator('#selection-toolbar').waitFor({ state: 'hidden' });
    check(!await page.locator('[data-select="redesign-review-ru"]').isChecked(), 'Clear selection must clear the row checkbox');
    check(await page.locator('#evaluate-selected').isDisabled(), 'Clearing selection disables the evaluation action');
    check(counts.apiGets === initialGets, 'Filtering, searching and selecting must not call the API');
    passed.push('selection toolbar hidden → visible → hidden, with checkbox and action state in sync');

    listMode = 'error';
    await page.reload();
    await page.getByRole('heading', { name: 'Не удалось загрузить раздел', exact: true }).waitFor();
    await page.getByText('Синтетическая временная ошибка списка.', { exact: true }).waitFor();
    check(await page.getByRole('heading', { name: 'Нет подключения к данным', exact: true }).count() === 0, 'A generic HTTP error must not claim the connection is absent');
    check(!await page.locator('#demo-banner').isVisible(), 'HTTP failure must not silently enable demo mode');
    const getsBeforeRetry = counts.dialogGets;
    listMode = 'normal';
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await page.getByRole('heading', { name: 'Диалоги', exact: true }).waitFor();
    await expectRows(rows.map(row => row.conversation_id));
    check(counts.dialogGets > getsBeforeRetry, 'Retry must request the dialogs again');
    passed.push('HTTP 503 shows neutral error; retry loads the list without a demo fallback');

    check(JSON.stringify(rows) === originalRows, 'UI interactions must not mutate fixture evaluations');
    check(counts.rejectedWrites === 0, 'Read-only list flow must not attempt writes');
    check(counts.blockedExternal === 0, 'Unexpected external resource requested');
    check(unexpectedApi.length === 0, `Unexpected API paths: ${unexpectedApi.join(', ')}`);
    check(pageErrors.length === 0, JSON.stringify(pageErrors));
    return { passed, counts, pageErrors, realApiCalls: 0, paidCalls: 0 };
  } catch (error) {
    throw new Error(`${error.message}\nPassed: ${passed.join('; ')}\nCounts: ${JSON.stringify(counts)}\nPage errors: ${JSON.stringify(pageErrors)}`);
  } finally {
    await context.close();
  }
}
