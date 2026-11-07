const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && value.trim().length > 0;
const roles = new Set(['client', 'operator', 'bot', 'system']);

/** Read organizer records without normalizing text, changing order or renumbering turns. */
export function parseDatasetSource(input, { dataset } = {}) {
  const errors = [], warnings = [];
  const selected = typeof dataset === 'string' ? dataset.trim().toUpperCase() : '';
  if (!['DEV', 'PROD'].includes(selected)) errors.push('Выберите набор DEV или PROD.');
  if (input?.isSuccess === false) return { dialogs: [], groupId: null, errors: ['API организаторов сообщил об ошибке получения набора.'], warnings };
  if (own(input, 'isSuccess') && input.isSuccess !== true) return { dialogs: [], groupId: null, errors: ['Поле isSuccess в исходном ответе должно быть логическим true.'], warnings };
  const body = object(input?.data) ? input.data : input;
  const records = Array.isArray(body) ? body : object(body) && Array.isArray(body.records) ? body.records : null;
  if (!records) return { dialogs: [], groupId: null, errors: [...errors, 'Исходный JSON должен содержать массив records или быть массивом диалогов.'], warnings };
  let groupId = null;
  if (object(body) && own(body, 'dataset_group_id')) {
    if (identifier(body.dataset_group_id)) groupId = body.dataset_group_id.trim();
    else errors.push('В исходном наборе некорректный dataset_group_id.');
  }
  if (!groupId) warnings.push('В исходном JSON не указан dataset_group_id. Проверьте, что выбран правильный набор.');
  if (selected === 'PROD' && groupId?.toUpperCase() === 'DEV') errors.push('Источник DEV нельзя использовать для сдачи PROD.');
  if (object(body) && own(body, 'total_records')) {
    if (!Number.isInteger(body.total_records) || body.total_records < 0) errors.push('Поле total_records должно быть неотрицательным целым числом.');
    else if (body.total_records !== records.length) errors.push('Количество записей не совпадает с total_records в исходном JSON.');
  }
  const ids = new Set();
  let chats = 0, calls = 0;
  for (let index = 0; index < records.length; index++) {
    const record = records[index], prefix = `Диалог ${index + 1}: `;
    if (!object(record)) { errors.push(prefix + 'запись должна быть объектом.'); continue; }
    if (!identifier(record.conversation_id)) errors.push(prefix + 'нужен непустой строковый conversation_id.');
    else if (ids.has(record.conversation_id)) errors.push(prefix + 'conversation_id повторяется в исходном наборе.');
    else ids.add(record.conversation_id);
    if (record.channel === 'agent chat') chats++;
    else if (record.channel === 'voice call') calls++;
    else errors.push(prefix + 'канал должен быть agent chat или voice call.');
    if (!Array.isArray(record.transcript)) { errors.push(prefix + 'transcript должен быть массивом.'); continue; }
    for (let turn = 0; turn < record.transcript.length; turn++) {
      const item = record.transcript[turn];
      if (!object(item) || typeof item.text !== 'string' || !roles.has(item.speaker) || own(item, 'timestamp') && typeof item.timestamp !== 'string') {
        errors.push(prefix + `реплика ${turn + 1} должна содержать текст, допустимую роль и строковое время, если оно задано.`);
      }
    }
  }
  if (selected === 'DEV' && (records.length !== 65 || chats !== 60 || calls !== 5)) errors.push('Для DEV требуется ровно 65 диалогов: 60 чатов и 5 звонков.');
  if (selected === 'PROD' && (records.length !== 10 || chats !== 10 || calls !== 0)) errors.push('Для PROD требуется ровно 10 диалогов, все с каналом agent chat.');
  return { dialogs: errors.length ? [] : records, groupId, errors, warnings };
}

function organizerOutput(value) {
  return object(value) && (own(value, 'schema_version') || own(value, 'results'));
}

function cliSummary(file) {
  const name = typeof file.name === 'string' ? file.name.split(/[\\/]/).at(-1).toLowerCase() : '';
  const value = file.document;
  return name === 'summary.json' && object(value) && !own(value, 'conversation_id')
    && Array.isArray(value.models) && value.models.every(model => typeof model === 'string')
    && Number.isInteger(value.dialogs) && value.dialogs >= 0;
}

/** Accept evaluator output, never a final organizer submission with one-based evidence. */
export function parseEvaluationFiles(files) {
  const errors = [], warnings = [], evaluations = [], ids = new Set();
  if (!Array.isArray(files) || !files.length) return { evaluations, errors: ['Выберите JSON-файлы с исходными оценками.'], warnings };
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex], prefix = `Файл ${fileIndex + 1}: `;
    if (!object(file)) { errors.push(prefix + 'не передан объект файла.'); continue; }
    const value = file.document;
    if (organizerOutput(value) || organizerOutput(value?.data)) {
      errors.push(prefix + 'это готовый файл сдачи. Выберите исходные оценки, чтобы не преобразовать номера реплик повторно.'); continue;
    }
    if (value?.isSuccess === false) { errors.push(prefix + 'источник сообщил об ошибке.'); continue; }
    if (cliSummary(file)) { warnings.push(prefix + 'служебный summary.json пропущен; он не содержит оценки диалогов.'); continue; }
    const body = object(value?.data) && Array.isArray(value.data.evaluations) ? value.data : value;
    const items = Array.isArray(body) ? body : object(body) && Array.isArray(body.evaluations) ? body.evaluations : object(body) ? [body] : null;
    if (!items || !items.length) { errors.push(prefix + 'исходные оценки не найдены.'); continue; }
    for (let index = 0; index < items.length; index++) {
      const item = items[index], where = prefix + `оценка ${index + 1}: `;
      if (organizerOutput(item)) { errors.push(where + 'готовый формат сдачи не принимается как исходная оценка.'); continue; }
      if (!object(item) || !identifier(item.conversation_id)) { errors.push(where + 'нужен непустой строковый conversation_id.'); continue; }
      if (ids.has(item.conversation_id)) { errors.push(where + 'conversation_id повторяется среди загруженных оценок.'); continue; }
      ids.add(item.conversation_id);
      evaluations.push(item);
    }
  }
  return { evaluations: errors.length ? [] : evaluations, errors, warnings };
}

const evaluationId = value => identifier(value) || typeof value === 'number' && Number.isInteger(value) && value >= 0;
const waiting = new Set(['pending', 'queued', 'running', 'processing', 'evaluating', 'in_progress']);
const failed = new Set(['failed', 'error', 'cancelled', 'canceled']);
const status = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

/** Collect saved results through GET-only methods; the source dataset remains authoritative. */
export async function collectServerEntries(api, dialogs, { onProgress } = {}) {
  const errors = [], warnings = [];
  const result = entries => ({ entries, errors, warnings });
  if (api?.demo === true) { errors.push('Учебный API нельзя использовать как источник результатов для сдачи.'); return result([]); }
  if (!api || typeof api.listDialogs !== 'function' || typeof api.getDialog !== 'function' || typeof api.getEvaluation !== 'function') {
    errors.push('Не настроен серверный API для чтения сохранённых оценок.'); return result([]);
  }
  if (!Array.isArray(dialogs) || !dialogs.length) { errors.push('Сначала загрузите исходный набор диалогов.'); return result([]); }
  const expected = new Set();
  for (let index = 0; index < dialogs.length; index++) {
    const dialog = dialogs[index];
    if (!object(dialog) || !identifier(dialog.conversation_id) || expected.has(dialog.conversation_id)) {
      errors.push('Исходный набор содержит отсутствующие или повторяющиеся conversation_id.'); return result([]);
    }
    expected.add(dialog.conversation_id);
  }
  let rows;
  try { rows = await api.listDialogs(); } catch {
    errors.push('Не удалось прочитать список диалогов с сервера. Проверьте подключение и повторите сбор.'); return result([]);
  }
  if (!Array.isArray(rows)) { errors.push('Сервер вернул некорректный список диалогов.'); return result([]); }
  const snapshot = new Map();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!object(row) || !identifier(row.conversation_id) || snapshot.has(row.conversation_id)) {
      errors.push('Список сервера содержит некорректные или повторяющиеся conversation_id.'); return result([]);
    }
    snapshot.set(row.conversation_id, { evaluationId: row.evaluation_id, status: status(row.status), hasError: Boolean(row.error) });
  }
  const unrelated = [...snapshot.keys()].filter(id => !expected.has(id)).length;
  if (unrelated) warnings.push(`Диалогов сервера вне исходного набора: ${unrelated}. Они не включены в результат.`);
  let completed = 0, cursor = 0;
  const entries = new Array(dialogs.length);
  const progress = async () => {
    if (typeof onProgress !== 'function') return;
    try { await onProgress({ completed, total: dialogs.length }); } catch {
      if (!warnings.includes('Не удалось обновить индикатор прогресса.')) warnings.push('Не удалось обновить индикатор прогресса.');
    }
  };
  const notReady = (value, hasError = false) => hasError || failed.has(status(value)) ? 'Сохранённая оценка завершилась с ошибкой.' : waiting.has(status(value)) ? 'Оценка ещё выполняется. Дождитесь завершения и повторите сбор.' : null;
  const collect = async dialog => {
    const entry = { dialog }, row = snapshot.get(dialog.conversation_id);
    if (!row) return { ...entry, error: 'Диалог исходного набора отсутствует в списке сервера.' };
    const rowError = notReady(row.status, row.hasError);
    if (rowError) return { ...entry, error: rowError };
    let id = row.evaluationId;
    if (id == null || id === '') {
      let detail;
      try { detail = await api.getDialog(dialog.conversation_id); } catch { return { ...entry, error: 'Не удалось прочитать карточку диалога с сервера.' }; }
      if (!object(detail) || own(detail, 'conversation_id') && detail.conversation_id !== dialog.conversation_id) return { ...entry, error: 'Карточка сервера не соответствует исходному диалогу.' };
      const detailError = notReady(detail.status, Boolean(detail.error));
      if (detailError) return { ...entry, error: detailError };
      id = detail.evaluation_id;
    }
    if (!evaluationId(id)) return { ...entry, error: 'Для диалога нет сохранённой оценки.' };
    let evaluation;
    try { evaluation = await api.getEvaluation(id); } catch { return { ...entry, error: 'Не удалось прочитать сохранённую оценку с сервера.' }; }
    if (!object(evaluation) || !identifier(evaluation.conversation_id) || evaluation.conversation_id !== dialog.conversation_id) return { ...entry, error: 'Сохранённая оценка не соответствует исходному диалогу.' };
    const evaluationError = notReady(evaluation.status, Boolean(evaluation.error));
    if (evaluationError) {
      // Retain provenance for the submission guard, without forwarding raw error text.
      const provenance = Object.fromEntries(['conversation_id', 'demo', 'is_demo', 'mock', 'provider', 'model'].filter(key => own(evaluation, key)).map(key => [key, evaluation[key]]));
      if (Array.isArray(evaluation.calls)) provenance.calls = evaluation.calls.map(call => ({ model: call?.model }));
      return { ...entry, evaluation: provenance, error: evaluationError };
    }
    return { ...entry, evaluation };
  };
  await progress();
  await Promise.all(Array.from({ length: Math.min(4, dialogs.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= dialogs.length) return;
      try { entries[index] = await collect(dialogs[index]); } catch { entries[index] = { dialog: dialogs[index], error: 'Не удалось собрать результат диалога. Повторите сбор.' }; }
      completed++;
      await progress();
    }
  }));
  return result(entries);
}
