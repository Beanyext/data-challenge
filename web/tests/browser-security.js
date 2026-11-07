async (originalPage) => {
  const context = await originalPage.context().browser().newContext();
  const page = await context.newPage();
  let validRange = false;
  const checklist = { id: 'qa', version: 1, name: 'Учебный чек-лист', sections: [], criteria: [{ id: 'c1', title: 'Критерий', description: 'Правило', answer_type: 'binary', weight: 10, na_allowed: false }] };
  const record = { conversation_id: 'qa-security', language: 'RU', channel: 'voice call', evaluation_id: 'ev-qa', transcript: [{ speaker: 'operator', timestamp: '00:00', text: 'Вымышленная реплика' }] };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const evaluation = { id: 'ev-qa', conversation_id: record.conversation_id, checklist_id: 'qa', checklist_version: 1, total: 0, checklist, criteria: [{ criterion_id: 'c1', answer: 'no', points: 0, effective_weight: 10, explanation: 'Проверка диапазона', checked_range: validRange ? { from: 0, to: 0 } : { from: '<img src=x onerror=window.__rangeUnsafe=1>', to: 0 } }] };
    return route.fulfill({ json: path === '/api/dialogs' ? [record] : path === '/api/checklists' ? [checklist] : path === '/api/appeals' ? [] : path.endsWith('/audio') ? { url: 'https://[bad]/?sig=fictional-test-only' } : path.includes('/evaluations/') ? evaluation : record });
  });
  try {
    await page.goto('http://127.0.0.1:8765/#dialog/qa-security');
    await page.getByText('Некорректный диапазон доказательства', { exact: true }).waitFor();
    if (await page.locator('.evidence-links img').count() || await page.evaluate(() => window.__rangeUnsafe)) throw new Error('Range XSS');
    validRange = true;
    await page.reload();
    await page.locator('[data-turn="0"][data-range-end="0"]').click();
    if (await page.locator('.turn.highlight').count() !== 1) throw new Error('Control: valid range must still navigate');
    await page.getByText('Сервер передал некорректный адрес аудио.', { exact: true }).waitFor();
    const text = await page.locator('#audio-block').innerText();
    if (text.includes('sig') || text.includes('fictional-test-only')) throw new Error('Signed URL leaked');
    return { invalidRangeRejected: true, validRangeNavigates: true, malformedAudioUrlRedacted: true };
  } finally { await context.close(); }
}
