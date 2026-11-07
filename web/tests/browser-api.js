async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const clone = value => JSON.parse(JSON.stringify(value));
  const results = [];
  const counts = { evaluationPosts: 0, jobPolls: 0, checklistPosts: 0, appealPosts: 0, decisionPosts: 0, blockedExternal: 0 };
  let listMode = 'normal', jobStatus = 'running', releaseEvaluation, firstPostSeen, releaseChecklist, checklistSeen;
  const firstPost = new Promise(resolve => { firstPostSeen = resolve; });
  const checklistPost = new Promise(resolve => { checklistSeen = resolve; });
  const checklist = {
    id: 'api-original', version: 1, name: 'API: исходный чек-лист', rounding: { digits: 2 }, guidance: [],
    sections: [{ id: 's1', name: 'Контакт' }],
    criteria: [{ id: 'c01', section_id: 's1', title: 'Приветствие', description: 'Оператор поздоровался.', answer_type: 'binary', scale: null, weight: 100, na_allowed: false, na_rule: null, notes: null, gross_error: false }],
  };
  const record = {
    conversation_id: 'api-qa-001', channel: 'agent chat', language: 'RU', title: 'Учебный API: тарифы', audio_url: null,
    transcript: [{ timestamp: '00:00', speaker: 'client', text: 'Это вымышленный запрос для теста интерфейса.' }, { timestamp: '00:02', speaker: 'operator', text: 'Здравствуйте! Это вымышленный ответ.' }],
    evaluation_id: 'api-eval-initial', status: 'evaluated', total: 100, gross_error: false,
  };
  const checklists = [checklist], appeals = [];
  const evaluations = [{
    id: record.evaluation_id, conversation_id: record.conversation_id, checklist_id: checklist.id, checklist_version: 1,
    checklist: clone(checklist), model: 'Изолированный тест API, без AI', total: 100, original_total: 100, gross_error: false,
    sections: [{ id: 's1', score: 100 }],
    criteria: [{ criterion_id: 'c01', answer: 'yes', points: 100, weight: 100, effective_weight: 100, explanation: 'Синтетическая фикстура HTTP-контракта.', evidence: [{ turn: 1, quote: record.transcript[1].text }], checked_range: null, na_reason: null, needs_review: false }],
  }];
  const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  const waitForNode = async (predicate, description) => {
    const until = Date.now() + 10000;
    while (!predicate()) {
      if (Date.now() > until) throw new Error(description);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };

  // Every API request is intercepted. No server, model, organizer URL or paid API is called.
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:8765') {
      counts.blockedExternal++;
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = decodeURIComponent(url.pathname.slice(4));
    const method = request.method();
    if (path === '/dialogs' && method === 'GET') {
      if (listMode === 'error') return json(route, { detail: 'Тестовый API временно недоступен.' }, 503);
      if (listMode === 'malformed') return json(route, { records: 'not-an-array' });
      return json(route, { dialogs: [record] });
    }
    if (path === `/dialogs/${record.conversation_id}`) return json(route, record);
    if (path === '/checklists' && method === 'GET') return json(route, { checklists });
    if (path === '/checklists' && method === 'POST') {
      counts.checklistPosts++;
      const payload = request.postDataJSON();
      if(counts.checklistPosts===1){const gate=new Promise(resolve=>{releaseChecklist=resolve;});checklistSeen();await gate;}
      const saved = { ...payload, id: 'api-server-assigned-id', version: 1 };
      checklists.push(saved);
      return json(route, saved);
    }
    if (path === '/appeals' && method === 'GET') return json(route, { appeals });
    if (path === '/appeals' && method === 'POST') {
      counts.appealPosts++;
      const appeal = { id: `api-appeal-${counts.appealPosts}`, ...request.postDataJSON(), conversation_id: record.conversation_id, status: 'open', decision: null };
      appeals.push(appeal);
      return json(route, appeal);
    }
    if (/^\/appeals\/[^/]+\/decision$/.test(path) && method === 'POST') {
      counts.decisionPosts++;
      const appeal = appeals.find(a => a.id === path.split('/')[2]);
      const payload = request.postDataJSON();
      appeal.status = payload.status;
      appeal.decision = { answer: payload.answer, reason: payload.reason, decided_at: new Date().toISOString() };
      return json(route, appeal);
    }
    if (path === '/evaluations' && method === 'POST') {
      counts.evaluationPosts++;
      const payload = request.postDataJSON();
      check(payload.conversation_ids.length === 1 && payload.conversation_ids[0] === record.conversation_id, 'Evaluation must use selected dialog');
      check(payload.checklist_id === 'api-server-assigned-id', 'Evaluation must use newly saved checklist ID');
      if (counts.evaluationPosts === 1) {
        const gate = new Promise(resolve => { releaseEvaluation = resolve; });
        firstPostSeen();
        await gate;
      }
      return json(route, { id: 'api-job-1', status: 'queued', total: 1, completed: 0 });
    }
    if (path === '/jobs/api-job-1') {
      counts.jobPolls++;
      return json(route, { id: 'api-job-1', status: jobStatus, total: 1, completed: 0, evaluation_ids: [] });
    }
    if (path.startsWith('/evaluations/')) {
      const item = evaluations.find(e => e.id === path.split('/')[2]);
      return item ? json(route, item) : json(route, { detail: 'Тестовая оценка не найдена.' }, 404);
    }
    return json(route, { detail: `Нет тестового маршрута ${method} ${path}` }, 404);
  });

  try {
    await page.goto('http://127.0.0.1:8765/');
    await page.getByRole('heading', { name: 'Диалоги', exact: true }).waitFor();
    check(!await page.locator('#demo-banner').isVisible(), 'API mode must not show demo banner');
    check((await page.locator('#mode-label').innerText()) === 'Данные сервера', 'Explicit API mode');

    await page.getByRole('link', { name: 'Чек-листы', exact: true }).click();
    await page.getByRole('button', { name: 'Новый чек-лист', exact: true }).click();
    await page.locator('[data-edit=name]').fill('Новый чек-лист «API» & проверка');
    await page.getByRole('button', { name: '＋ Добавить критерий', exact: true }).click();
    await page.locator('[data-criterion=title]').fill('Критерий API');
    await page.locator('[data-criterion=description]').fill('Правило новой версии, сохранённое тестовым сервером.');
    await page.getByRole('button', { name: 'Сохранить версию ↗', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить новую версию', exact: true }).click();
    await checklistPost;
    check(await page.getByRole('button',{name:'Закрыть окно',exact:true}).isDisabled(),'Slow save prevents closing and losing newer draft');
    await page.keyboard.press('Escape');
    check(await page.locator('#modal').isVisible(),'Escape cannot close an outstanding checklist save');
    releaseChecklist();
    await page.getByText('Сохранено', { exact: true }).waitFor();
    check(counts.checklistPosts === 1, 'Checklist saved exactly once');
    check((await page.locator('#choose-checklist').inputValue()) === 'api-server-assigned-id@1', 'Server-assigned checklist remains selected after save');
    check((await page.locator('[data-edit=name]').inputValue()) === checklists[1].name, 'Checklist read returns the posted name');
    await page.getByRole('link', { name: /Диалоги/ }).click();
    await page.getByRole('link', { name: 'Чек-листы', exact: true }).click();
    check((await page.locator('#choose-checklist').inputValue()) === 'api-server-assigned-id@1', 'Saved checklist selection survives route change');
    results.push('stateful checklist POST/GET, server-assigned ID retained across navigation');

    await page.getByRole('link', { name: /Диалоги/ }).click();
    await page.getByRole('button', { name: 'Открыть api-qa-001', exact: true }).click();
    await page.locator('#criterion-c01 [data-appeal]').click();
    const comment = 'Учебное обращение «API» & <script>window.__apiUnsafe=1</script>';
    await page.getByRole('textbox', { name: 'Почему вы не согласны' }).fill(comment);
    await page.getByRole('button', { name: 'Подать апелляцию', exact: true }).click();
    await page.locator('#criterion-c01').getByRole('button', { name: 'Апелляция подана' }).waitFor();
    await page.getByRole('link', { name: /Апелляции/ }).click();
    await page.getByText(comment, { exact: true }).waitFor();
    check(appeals[0].comment === comment, 'Appeal mock stores actual posted comment');
    check(!await page.evaluate(() => window.__apiUnsafe), 'API response text must remain escaped');
    await page.getByRole('button', { name: 'Рассмотреть', exact: true }).click();
    await page.getByRole('textbox', { name: 'Причина решения' }).fill('Подтверждено на учебной фикстуре.');
    await page.getByRole('button', { name: 'Сохранить решение', exact: true }).click();
    await waitForNode(() => counts.decisionPosts === 1, 'Appeal decision POST missing');
    check(appeals[0].decision.reason === 'Подтверждено на учебной фикстуре.', 'Decision persisted by mock');
    results.push('stateful appeal POST/GET, review decision, escaped API text');

    await page.getByRole('link', { name: /Диалоги/ }).click();
    await page.getByRole('button', { name: 'Открыть api-qa-001', exact: true }).click();
    await page.locator('#evaluation-checklist').selectOption('api-server-assigned-id');
    await page.locator('[data-action=evaluate-dialog]').click();
    await page.getByRole('checkbox', { name: /Подтверждаю запуск AI-оценки/ }).check();
    await page.locator('#evaluate-form button[type=submit]').click();
    await firstPost;
    await page.evaluate(() => document.querySelector('#evaluate-form').requestSubmit());
    // Let both submit handlers settle while the first HTTP response remains held.
    await page.getByText('Предыдущее задание ещё выполняется.', { exact: true }).waitFor();
    check(counts.evaluationPosts === 1, 'Repeated submit must not create another evaluation POST');
    releaseEvaluation();
    await page.locator('#job-banner progress').waitFor();
    check(await page.locator('[data-action=evaluate-dialog]').isDisabled(), 'Launch disabled while job is running');
    const active = await page.evaluate(() => JSON.parse(sessionStorage.getItem('cqa-active-job')));
    check(active.id === 'api-job-1' && active.demo === false, 'Active API job saved for reload');
    results.push('one evaluation POST, duplicate submit guard, running job disables launch');

    const beforeReload = counts.jobPolls;
    await page.reload();
    await page.locator('#job-banner progress').waitFor();
    await waitForNode(() => counts.jobPolls > beforeReload, 'Reload did not resume polling');
    check(counts.evaluationPosts === 1, 'Reload must resume the same job without another POST');
    check(await page.locator('[data-action=evaluate-dialog]').isDisabled(), 'Reloaded running job still blocks launch');
    results.push('reload resumes sessionStorage job, no second paid-action POST');

    jobStatus = 'failed';
    await page.getByText('Оценка завершилась с ошибкой. Обновите диалоги и проверьте сервер.', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-action=evaluate-dialog]')?.disabled);
    check(await page.evaluate(() => sessionStorage.getItem('cqa-active-job') === null), 'Failed job removed from sessionStorage');
    const afterTerminal = counts.jobPolls;
    // Longer than two real-mode polling periods: catches a lingering polling loop.
    await page.waitForTimeout(3300);
    check(counts.jobPolls === afterTerminal, 'Terminal failure must stop polling');
    check(!await page.locator('[data-action=evaluate-dialog]').isDisabled(), 'Failed job restores launch controls');
    results.push('failed job stops polling, clears resume state and restores controls');

    listMode = 'error';
    await page.getByRole('link', { name: /Диалоги/ }).click();
    await page.getByRole('heading', { name: 'Нет подключения к данным', exact: true }).waitFor();
    await page.getByText('Тестовый API временно недоступен.', { exact: true }).waitFor();
    check(!await page.locator('#demo-banner').isVisible(), 'HTTP failure must not enable demo');
    listMode = 'normal';
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await page.getByRole('heading', { name: 'Диалоги', exact: true }).waitFor();
    listMode = 'malformed';
    await page.getByRole('link', { name: 'Чек-листы', exact: true }).click();
    await page.getByRole('heading', { name: 'Нет подключения к данным', exact: true }).waitFor();
    await page.getByText('Сервер вернул неожиданный формат списка. Проверьте контракт API.', { exact: true }).waitFor();
    check(!await page.locator('#demo-banner').isVisible(), 'Malformed API data must not enable demo');
    results.push('HTTP 503 and malformed API response show errors, retry works, no silent demo fallback');

    listMode='normal';
    checklists[0].version=2;
    checklists[0].criteria[0].title='Название только новой версии';
    evaluations[0].checklist={...clone(checklists[0]),version:999};
    await page.getByRole('link',{name:/Диалоги/}).click();
    await page.getByRole('button',{name:'Открыть api-qa-001',exact:true}).click();
    await page.getByText('Исходная версия чек-листа недоступна. Правила другой версии не подставляются. Для пересмотра нужен исходный чек-лист.',{exact:true}).waitFor();
    check((await page.locator('#criterion-c01 h3').innerText())==='c01','Missing snapshot never uses a newer criterion title');
    await page.locator('#criterion-c01 [data-appeal]').click();
    await page.getByRole('textbox',{name:'Почему вы не согласны'}).fill('Проверка отсутствующей исходной версии.');
    await page.getByRole('button',{name:'Подать апелляцию',exact:true}).click();
    await page.locator('#criterion-c01').getByRole('button',{name:'Апелляция подана'}).waitFor();
    await page.getByRole('link',{name:/Апелляции/}).click();
    await page.getByRole('button',{name:'Рассмотреть',exact:true}).click();
    await page.getByText('Не удалось получить исходный критерий этой оценки. Решение не сохранено.',{exact:true}).waitFor();
    check(await page.locator('[data-decision]').count()===0,'Cannot decide using a mismatched checklist snapshot');
    results.push('slow save guarded; missing historical snapshot warns and blocks unsafe review');

    check(counts.blockedExternal === 0, 'Unexpected external resource requested');
    check(pageErrors.length === 0, JSON.stringify(pageErrors));
    return { passed: results, counts, pageErrors, realApiCalls: 0, paidCalls: 0 };
  } catch (error) {
    await page.screenshot({ path: '/private/tmp/cqa-browser-api-failure.png', fullPage: true });
    throw new Error(`${error.message}\nPassed: ${results.join('; ')}\nCounts: ${JSON.stringify(counts)}\nScreenshot: /private/tmp/cqa-browser-api-failure.png`);
  } finally {
    releaseEvaluation?.();
    releaseChecklist?.();
    await context.close();
  }
}
