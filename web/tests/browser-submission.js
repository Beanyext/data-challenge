async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  const passed = [], issues = [], pageErrors = [], apiRequests = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const clone = value => JSON.parse(JSON.stringify(value));
  const criterionIds = ['contact', 'discovery', 'identification', 'consultation', 'empathy', 'dialogue', 'closure', 'critical'];
  const apiState = { records: [], evaluations: [], failEvaluation: null };
  let externalRequests = 0;
  page.on('pageerror', error => pageErrors.push(error.message));

  function fixture(dataset = 'prod') {
    const records = Array.from({ length: dataset === 'prod' ? 10 : 65 }, (_, i) => ({
      conversation_id: `${dataset}-browser-${i + 1}`,
      channel: dataset === 'dev' && i >= 60 ? 'voice call' : 'agent chat', language: 'RU', audio_url: null,
      transcript: [
        { speaker: 'bot', timestamp: '00:00', text: 'Вымышленный бот.' },
        { speaker: 'system', timestamp: '00:01', text: 'Вымышленное событие.' },
        { speaker: 'client', timestamp: '00:02', text: 'Вымышленный вопрос.' },
        { speaker: 'operator', timestamp: '00:03', text: 'Вымышленный ответ оператора.' },
        { speaker: 'system', timestamp: '00:04', text: 'Вымышленное завершение.' },
      ],
    }));
    const answers = ['yes', 'yes', 'yes', 20, 'yes', 10, 'yes', 'no'];
    const evaluations = records.map(record => ({
      conversation_id: record.conversation_id, provider: 'anthropic', model: 'qa-model-test', calls: [{ model: 'qa-model-test' }],
      criteria: answers.map((answer, i) => ({
        criterion_id: `c${String(i + 1).padStart(2, '0')}`, answer,
        explanation: 'Обоснование «кириллица» & <script>window.__submissionUnsafe=1</script>',
        evidence: [{ turn: 3, quote: 'Цитата не должна попасть в итоговый JSON.' }], checked_range: null, needs_review: false,
      })),
    }));
    return { records, evaluations, dataset: { isSuccess: true, error: '', data: { dataset_group_id: dataset.toUpperCase(), total_records: records.length, records } } };
  }

  const file = (name, value, raw = false) => ({ name, mimeType: 'application/json', buffer: Buffer.from(raw ? value : JSON.stringify(value)) });
  const prepare = () => page.getByRole('button', { name: 'Проверить результаты', exact: true }).click();
  const downloadButton = () => page.getByRole('button', { name: 'Скачать results.json', exact: true });
  const expectedSuccess = () => page.getByRole('heading', { name: 'Формат проверен', exact: true }).waitFor();
  async function open(demo = false) {
    // Navigating to the same URL/hash can keep the previous module's in-memory form state.
    await page.goto('about:blank');
    await page.goto(`http://127.0.0.1:8765/${demo ? '?demo=1' : ''}#submission`);
    await page.getByRole('heading', { name: 'Выгрузка результатов', exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
  }
  async function upload(input, { dataset = 'prod', evaluations = input.evaluations, source = 'original', mode = 'files' } = {}) {
    await page.locator('#submission-form select[name=dataset]').selectOption(dataset);
    await page.locator('#submission-form select[name=input]').selectOption(mode);
    await page.locator('#submission-dataset-file').setInputFiles(file('исходный-набор.json', input.dataset));
    if (mode === 'files') await page.locator('#submission-evaluation-files').setInputFiles(file('оценки.json', { evaluations }));
    if (source !== 'original') await page.locator('#submission-form select[name=source]').selectOption(source);
  }
  async function expectBlocked(pattern) {
    await prepare();
    await page.getByRole('heading', { name: /Файл пока нельзя скачать/ }).waitFor();
    if (pattern) check(pattern.test(await page.locator('#submission-result').innerText()), `Missing error matching ${pattern}`);
    check(await downloadButton().count() === 0, 'Invalid input still exposes a download action');
  }
  async function download() {
    const [event] = await Promise.all([page.waitForEvent('download'), downloadButton().click()]);
    check(event.suggestedFilename() === 'results.json', 'Unexpected downloaded filename');
    const stream = await event.createReadStream(), chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  function checkDocument(document, count, team = 'seeusoon') {
    check(JSON.stringify(Object.keys(document)) === JSON.stringify(['schema_version', 'team_name', 'model', 'results']), 'Noncanonical root fields');
    check(document.schema_version === '1.0' && document.team_name === team, 'Schema or team mismatch');
    check(document.model.mode === 'external_api' && document.model.name === 'qa-model-test', 'Model metadata mismatch');
    check(document.results.length === count, `Expected ${count} actual exported results`);
    const ok = document.results.find(row => row.status === 'ok');
    check(JSON.stringify(ok.criteria.map(c => c.criterion_id)) === JSON.stringify(criterionIds), 'Incorrect canonical criterion IDs');
    check(ok.criteria[0].value === true && ok.criteria[7].value === false, 'Binary native values lost');
    check(ok.criteria[3].value === 20 && ok.criteria[5].value === 10, 'Raw scale values lost');
    check(JSON.stringify(ok.criteria[0].evidence_turns) === '[4]', 'Zero-based turn 3 must become 4 including bot/system roles');
    check(ok.score.final_score === 100 && ok.score.critical_flag === false, 'Unexpected score');
    check(ok.criteria[0].rationale.includes('«…» & <script>'), 'Quoted spans must be scrubbed while special characters stay intact');
    check(!JSON.stringify(document).includes('Цитата не должна'), 'Raw quote leaked');
    check(!JSON.stringify(document).includes('audio_url') && !JSON.stringify(document).includes('transcript'), 'Source fields leaked');
  }
  async function scenario(name, run) {
    try { await run(); passed.push(name); }
    catch (error) {
      const screenshot = `/private/tmp/cqa-submission-failure-${issues.length + 1}.png`;
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      issues.push({ scenario: name, error: error.message, screenshot });
    }
  }

  // No live API traffic: all API routes are a read-only saved-results fixture.
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:8765') { externalRequests++; return route.abort('blockedbyclient'); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = decodeURIComponent(url.pathname.slice(4));
    apiRequests.push({ method: request.method(), path });
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (request.method() !== 'GET') return json({ detail: 'Test forbids every API write.' }, 405);
    if (path === '/dialogs') return json({ dialogs: apiState.records.map(record => ({ conversation_id: record.conversation_id, evaluation_id: `evaluation-${record.conversation_id}`, status: 'evaluated' })) });
    if (path.startsWith('/evaluations/')) {
      const id = path.slice('/evaluations/evaluation-'.length);
      if (id === apiState.failEvaluation) return json({ detail: 'Synthetic read failure.' }, 500);
      const evaluation = apiState.evaluations.find(e => e.conversation_id === id);
      return evaluation ? json(evaluation) : json({ detail: 'No saved test evaluation.' }, 404);
    }
    if (path.startsWith('/dialogs/')) {
      const record = apiState.records.find(d => d.conversation_id === path.slice('/dialogs/'.length));
      return record ? json({ ...record, evaluation_id: `evaluation-${record.conversation_id}` }) : json({ detail: 'No test dialog.' }, 404);
    }
    return json({ detail: 'Unexpected API endpoint in offline export test.' }, 404);
  });

  try {
    await scenario('direct #submission is independent from backend and other API reads', async () => {
      await open();
      check(apiRequests.length === 0, 'Direct export route unexpectedly loaded dialogs/checklists/appeals');
      check(await page.locator('#submission-form input[name=teamName]').inputValue() === 'seeusoon', 'Default team is not seeusoon');
      await expectBlocked(/JSON-файл/);
    });

    await scenario('PROD file export: actual downloaded JSON, raw CLI values and original indices', async () => {
      await open(); const input = fixture(); await upload(input); await prepare(); await expectedSuccess();
      checkDocument(await download(), 10);
      check(!await page.evaluate(() => window.__submissionUnsafe), 'Rationale caused script execution');
      check(apiRequests.length === 0, 'Offline export performed an API request');
    });

    await scenario('metadata edits invalidate download; repeat check and escaping work', async () => {
      await open(); await upload(fixture()); await prepare(); await expectedSuccess();
      const team = 'seeusoon «Команда» & <img src=x onerror=window.__submissionUnsafe=1>';
      await page.locator('#submission-form input[name=teamName]').fill(team);
      check(await downloadButton().count() === 0, 'Team edit did not invalidate prepared download');
      await prepare(); await expectedSuccess();
      checkDocument(await download(), 10, team);
      check(await page.locator('#submission-result img').count() === 0, 'Team markup not escaped');
      check(!await page.evaluate(() => window.__submissionUnsafe), 'Team caused script execution');
      await page.locator('#submission-form input[name=modelName]').fill('');
      check(await downloadButton().count() === 0, 'Model edit did not invalidate prepared download');
    });

    await scenario('replacing evaluation files refreshes inferred model name and mode in the same PROD form', async () => {
      await open();
      check(await page.locator('#submission-form input[name=teamName]').inputValue() === 'seeusoon', 'A new scenario must start with the default team');
      const input = fixture();
      for (const evaluation of input.evaluations) {
        evaluation.model = 'qa-model-first';
        evaluation.calls = [{ model: 'qa-model-first' }];
      }
      await upload(input); await prepare(); await expectedSuccess();
      const first = await download();
      check(first.model.mode === 'external_api' && first.model.name === 'qa-model-first', 'First file metadata was not inferred from Anthropic results');
      check(await page.locator('#submission-form select[name=dataset]').inputValue() === 'prod', 'Unexpected dataset before file replacement');

      const secondEvaluations = clone(input.evaluations);
      for (const evaluation of secondEvaluations) {
        evaluation.model = 'qa-model-second';
        evaluation.calls = [{ model: 'qa-model-second' }];
        evaluation.provider = 'local';
        evaluation.model_mode = 'local';
      }
      // Replace only the evaluator file: retain dataset, original records and the current UI instance.
      await page.locator('#submission-evaluation-files').setInputFiles(file('новые-локальные-оценки.json', { evaluations: secondEvaluations }));
      check(await downloadButton().count() === 0, 'Replacing the file must invalidate the previous download');
      await prepare(); await expectedSuccess();
      check(await page.locator('#submission-form select[name=mode]').inputValue() === 'local', 'Auto model mode remained stale after file replacement');
      check(await page.locator('#submission-form input[name=modelName]').inputValue() === 'qa-model-second', 'Auto model name remained stale after file replacement');
      const second = await download();
      check(second.model.mode === 'local' && second.model.name === 'qa-model-second', 'Downloaded metadata still describes the first file');
      check(second.results.length === 10 && second.team_name === 'seeusoon', 'File replacement changed team or result completeness');
      check(JSON.stringify(second.results.map(row => row.conversation_id)) === JSON.stringify(first.results.map(row => row.conversation_id)), 'File replacement changed authoritative source IDs');
    });

    await scenario('malformed JSON is blocked clearly', async () => {
      await open(); await page.locator('#submission-form select[name=input]').selectOption('files');
      await page.locator('#submission-dataset-file').setInputFiles(file('ошибка.json', '{bad', true));
      await expectBlocked(/Не удалось прочитать JSON/);
    });

    for (const [name, mutate, pattern] of [
      ['duplicate evaluation IDs', f => f.evaluations.push(clone(f.evaluations[0])), /повторяется/],
      ['missing evaluation ID', f => f.evaluations.pop(), /Не хватает/],
      ['foreign evaluation ID', f => { f.evaluations[0].conversation_id = 'foreign-id'; }, /вне выбранного|Не хватает/],
    ]) await scenario(`${name} blocks download`, async () => {
      await open(); const input = fixture(); mutate(input); await upload(input); await expectBlocked(pattern);
    });

    await scenario('demo/mock evaluations stay blocked even on ?demo=1', async () => {
      for (const mark of [e => { e.demo = true; }, e => { e.provider = 'mock'; }]) {
        await open(true); const input = fixture(); mark(input.evaluations[0]); await upload(input); await expectBlocked(/учебн|mock|demo/i);
      }
    });

    await scenario('error rows retain all 10 IDs, criteria [] and score null and require acknowledgement', async () => {
      await open(); const input = fixture(); input.evaluations[0] = { conversation_id: input.records[0].conversation_id, provider: 'anthropic', model: 'qa-model-test', error: 'Synthetic evaluator failure.' };
      await upload(input); await prepare(); await expectedSuccess();
      check(await downloadButton().isDisabled(), 'Error rows must require acknowledgement');
      await page.locator('#submission-acknowledge').check();
      const document = await download(); checkDocument(document, 10);
      const failed = document.results[0];
      check(failed.conversation_id === input.records[0].conversation_id && failed.status === 'error', 'Error ID or status lost');
      check(Array.isArray(failed.criteria) && failed.criteria.length === 0 && failed.score === null, 'Error row invented criteria/zero score');
    });

    await scenario('mock error-file flags cannot be discarded during entry mapping', async () => {
      await open(); const input = fixture(); input.evaluations[0] = { conversation_id: input.records[0].conversation_id, demo: true, provider: 'mock', model: 'mock', error: 'Synthetic mock failure.' };
      await upload(input); await expectBlocked(/учебн|mock|demo/i);
    });

    await scenario('missing proof is allowed only after warning acknowledgement', async () => {
      await open(); const input = fixture(); input.evaluations[0].criteria[0].evidence = [];
      await upload(input); await prepare(); await expectedSuccess();
      check(await downloadButton().isDisabled(), 'Warnings did not block download pending acknowledgement');
      await page.locator('#submission-acknowledge').check();
      const document = await download();
      check(document.results[0].criteria[0].evidence_turns.length === 0, 'Missing proof was invented');
      check(document.results.length === 10, 'Warning removed a dialog');
    });

    await scenario('fictional personal contact in rationale requires privacy warning acknowledgement', async () => {
      await open();
      const input = fixture();
      input.evaluations[0].criteria[0].explanation = 'Вымышленный контакт для проверки предупреждения: person@example.invalid. Обоснование фикстуры.';
      await upload(input); await prepare(); await expectedSuccess();
      check(/обезлич/iu.test(await page.locator('#submission-result').innerText()), 'Missing instruction to anonymize personal contact information');
      check(await downloadButton().isDisabled(), 'Privacy warning must block download until acknowledged');
      await page.locator('#submission-acknowledge').check();
      check(!await downloadButton().isDisabled(), 'Acknowledgement did not enable privacy-warning download');
      const document = await download();
      check(document.results.length === 10 && document.team_name === 'seeusoon', 'Privacy warning changed completeness or team');
    });

    await scenario('quoted source text is scrubbed and verbatim public rationales are blocked in RU/KK/EN', async () => {
      for (const passage of [
        'Это вымышленная секретная реплика клиента для проверки защиты',
        'Бұл қорғанысты тексеруге арналған клиенттің ойдан шығарылған құпия сөзі',
        'This fictional private client passage tests safe public result exports',
      ]) {
        await open();const input=fixture();input.records[0].transcript[3].text=passage;
        input.evaluations[0].criteria[0].explanation=`Проверено действие: «${passage}». Основание доступно в интерфейсе.`;
        await upload(input);await prepare();await expectedSuccess();
        const exported=await download(),criterion=exported.results[0].criteria[0];
        check(!JSON.stringify(exported).includes(passage),'Raw transcript quote leaked into a public download');
        check(criterion.rationale.includes('«…»') && criterion.value===true && JSON.stringify(criterion.evidence_turns)==='[4]','Quote scrub changed the answer or proof indices');
        input.evaluations[0].criteria[0].explanation=`Основание: ${passage}.`;
        await page.locator('#submission-evaluation-files').setInputFiles(file('оценки-с-цитатой.json',{evaluations:input.evaluations}));
        await expectBlocked(/перескажите/);
        check(!(await page.locator('#submission-result').innerText()).includes(passage),'Privacy error echoed the transcript');
      }
    });

    await scenario('reviewed originals require original snapshot; explicit final source works', async () => {
      await open(); const input = fixture(), originalCriteria=clone(input.evaluations[0].criteria); input.evaluations[0].criteria[0].original_answer = 'yes'; input.evaluations[0].criteria[0].answer = 'no'; input.evaluations[0].criteria[0].review_reason = 'Synthetic human review.'; input.evaluations[0].total = 90; input.evaluations[0].original_total = 100;
      await upload(input); await expectBlocked(/original_criteria/);
      await page.locator('#submission-form select[name=source]').selectOption('final');
      await prepare(); await expectedSuccess(); await page.locator('#submission-acknowledge').check();
      const document = await download();
      check(document.results[0].criteria[0].value === false && document.results[0].score.final_score === 90, 'Explicit final answer/score not used');
      check(document.results[0].criteria[0].rationale === 'Synthetic human review.', 'Final export lost the reviewer reason or reused the original model rationale');
      input.evaluations[0].original_criteria=originalCriteria;
      await page.locator('#submission-evaluation-files').setInputFiles(file('оценки-с-исходным-снимком.json',{evaluations:input.evaluations}));
      await page.locator('#submission-form select[name=source]').selectOption('original');
      await prepare();await expectedSuccess();
      const originalDocument=await download();checkDocument(originalDocument,10);
      check(originalDocument.results[0].criteria[0].rationale === originalCriteria[0].explanation.replace('«кириллица»','«…»'), 'Original export was overwritten by the reviewer reason');
    });

    await scenario('DEV exports all 65 originals including five calls; responsive export layout', async () => {
      await open(); const input = fixture('dev'); await upload(input, { dataset: 'dev' }); await prepare(); await expectedSuccess();
      checkDocument(await download(), 65);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Submission layout overflow at ${width}px`);
      }
      await page.screenshot({ path: '/private/tmp/cqa-submission-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: '/private/tmp/cqa-submission-mobile.png', fullPage: true });
    });

    await scenario('server collection is GET-only and keeps failed evaluation as one of ten error rows', async () => {
      await open(); const input = fixture(); apiState.records = input.records; apiState.evaluations = input.evaluations; apiState.failEvaluation = input.records[2].conversation_id;
      const start = apiRequests.length;
      await upload(input, { mode: 'server' }); await prepare(); await expectedSuccess();
      check(await downloadButton().isDisabled(), 'Server read error needs acknowledgement');
      await page.locator('#submission-acknowledge').check();
      const document = await download(); checkDocument(document, 10);
      check(document.results[2].status === 'error' && document.results[2].score === null, 'Failed server read was dropped or scored');
      const reads = apiRequests.slice(start);
      check(reads.length === 11 && reads.every(r => r.method === 'GET'), 'Server collection must use one list GET and ten saved evaluation GETs');
      check(!reads.some(r => /checklists|appeals|jobs/.test(r.path)), 'Collection loaded unrelated API resources');
    });

    await scenario('demo workspace permits independent file export and blocks demo API collection', async () => {
      await open(true); const input = fixture(); const start = apiRequests.length;
      await upload(input); await prepare(); await expectedSuccess(); checkDocument(await download(),10);
      check(!await page.locator('#demo-banner').isVisible(), 'Workspace banner mislabeled independently loaded results');
      await page.locator('#submission-form select[name=input]').selectOption('server');
      check(await page.getByRole('button', { name: 'Проверить результаты', exact: true }).isDisabled(), 'Demo API source was not blocked');
      check((await page.locator('#submission-form').innerText()).includes('учебный API'), 'Missing demo API explanation');
      check(apiRequests.length === start, 'Demo source attempted real API reads');
    });

    check(apiRequests.every(r => r.method === 'GET'), 'Unexpected API write/paid action');
    check(externalRequests === 0, 'Unexpected external resources');
    return { passed, issues, apiRequests, pageErrors, externalRequests, paidCalls: 0, screenshots: ['/private/tmp/cqa-submission-desktop.png', '/private/tmp/cqa-submission-mobile.png'] };
  } finally { await context.close(); }
}
