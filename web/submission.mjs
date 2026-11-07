const CRITERIA = [
  { id: 'contact', alias: 'c01', type: 'binary', weight: 10, na: false },
  { id: 'discovery', alias: 'c02', type: 'binary', weight: 15, na: true },
  { id: 'identification', alias: 'c03', type: 'binary', weight: 20, na: true },
  { id: 'consultation', alias: 'c04', type: 'scale', weight: 20, na: true, values: [0, 5, 10, 15, 20], max: 20 },
  { id: 'empathy', alias: 'c05', type: 'binary', weight: 15, na: false },
  { id: 'dialogue', alias: 'c06', type: 'scale', weight: 15, na: false, values: [0, 4, 7, 10], max: 10 },
  { id: 'closure', alias: 'c07', type: 'binary', weight: 5, na: true },
  { id: 'critical', alias: 'c08', type: 'binary', weight: 0, na: false },
];
const BY_ID = new Map(CRITERIA.flatMap(c => [[c.id, c], [c.alias, c]]));
const MODES = new Set(['local', 'external_api', 'hybrid']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && Boolean(value.trim());
const unique = values => [...new Set(values)];
const DEMO_NAME = /(?:\bmock\b|\bdemo\b|учебн)/iu;
const SECRET = /(?:\b(?:sig|token|api[_-]?key|access[_-]?key|client[_-]?secret|password|authorization)\b["']?\s*[:=]\s*["']?[^\s,;]+|\bBearer\s+[A-Za-z0-9._~-]+|\b(?:sk|pk)[-_][A-Za-z0-9_-]{12,})/iu;
const URLS = /https?:\/\/[^\s<>"']+/giu;

function warnPersonalText(value, context, warnings) {
  if (typeof value !== 'string') return;
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
  const phone = /(?:\+7|8)[\s(.-]*\d{3}[\s).\-]*\d{3}[\s.\-]*\d{2}[\s.\-]*\d{2}\b/u;
  if (email.test(value) || phone.test(value) || /\b\d{12}\b/u.test(value)) warnings.push(`${context}: текст содержит возможные контакты или личный идентификатор. Проверьте и обезличьте обоснование перед публикацией.`);
}

function hasSignedUrl(value) {
  const urls = String(value).match(URLS) || [];
  return urls.some(url => {
    try {
      const parsed = new URL(url);
      return Boolean(parsed.username || parsed.password) || [...parsed.searchParams.keys()].some(k => /^(?:sig|signature|token|access_token|api[_-]?key|key|x-amz-.+|x-goog-signature|se)$/i.test(k));
    } catch { return /[?&](?:sig|token|key|signature)=/i.test(url); }
  });
}

function cleanText(value, context, errors, warnings, redact = false) {
  if (!nonempty(value)) { errors.push(`${context}: требуется непустая строка.`); return ''; }
  let text = value.trim();
  if (hasSignedUrl(text)) {
    if (!redact) { errors.push(`${context}: текст содержит подписанный адрес или данные доступа.`); return ''; }
    text = text.replace(URLS, url => hasSignedUrl(url) ? '[подписанный адрес скрыт]' : url);
    warnings.push(`${context}: подписанный адрес скрыт.`);
  }
  if (SECRET.test(text)) { errors.push(`${context}: текст содержит возможный ключ или токен.`); return ''; }
  return text;
}

// Match the public Python exporter: quoted spans are removed; six consecutive
// source words are enough to identify an unquoted transcript passage.
const QUOTED_TEXT = /«[^»]*»|“[^”]*”|„[^“”]*[“”]|"[^"]*"/gu;
const QUOTE_WORDS = 6;
const textWords = value => String(value ?? '').toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}_]+/gu) || [];
const phraseKey = words => words.join('\u0000');
function transcriptPrivacy(transcript) {
  const turns = (Array.isArray(transcript) ? transcript : []).map(turn => textWords(turn?.text));
  const grams = new Set();
  for (const words of turns) for (let i = 0; i + QUOTE_WORDS <= words.length; i++) grams.add(phraseKey(words.slice(i, i + QUOTE_WORDS)));
  return { turns, grams };
}
function publicText(text, privacy, context, errors, stripQuotes = false) {
  const output = stripQuotes ? text.replace(QUOTED_TEXT, '«…»') : text;
  const words = textWords(output);
  let leaked = stripQuotes && !words.length;
  for (let i = 0; i + QUOTE_WORDS <= words.length && !leaked; i++) leaked = privacy.grams.has(phraseKey(words.slice(i, i + QUOTE_WORDS)));
  // Directly validated JSON also rejects explicit short source quotations.
  if (!stripQuotes) for (const match of output.matchAll(QUOTED_TEXT)) {
    const quoted = textWords(match[0]);
    if (quoted.length && privacy.turns.some(turn => turn.some((_, i) => i + quoted.length <= turn.length && phraseKey(turn.slice(i, i + quoted.length)) === phraseKey(quoted)))) leaked = true;
  }
  if (leaked) errors.push(`${context}: текст содержит дословный фрагмент транскрипта или только цитату. Уберите цитаты и перескажите текст своими словами.`);
  return output;
}

function exactKeys(value, keys, context, errors) {
  if (!object(value)) { errors.push(`${context}: ожидается объект.`); return false; }
  const allowed = new Set(keys);
  if (Object.keys(value).some(key => !allowed.has(key))) errors.push(`${context}: есть поля вне формата сдачи.`);
  for (const key of keys) if (!own(value, key)) errors.push(`${context}: отсутствует поле ${key}.`);
  return true;
}

function expectedSet(dataset, expectedDialogs, errors) {
  if (!['dev', 'prod'].includes(dataset)) errors.push('Набор должен быть dev или prod.');
  const required = dataset === 'dev' ? 65 : dataset === 'prod' ? 10 : null;
  if (!Array.isArray(expectedDialogs)) { errors.push('Нужен исходный список диалогов выбранного набора.'); return new Map(); }
  if (required !== null && expectedDialogs.length !== required) errors.push(`Исходный набор ${dataset} должен содержать ровно ${required} диалогов.`);
  const result = new Map();
  let chats = 0, calls = 0;
  expectedDialogs.forEach((dialog, index) => {
    const where = `Исходный диалог ${index + 1}`;
    if (!object(dialog) || !nonempty(dialog.conversation_id)) { errors.push(`${where}: нет исходного ID.`); return; }
    if (SECRET.test(dialog.conversation_id) || hasSignedUrl(dialog.conversation_id)) { errors.push(`${where}: ID содержит данные доступа.`); return; }
    if (result.has(dialog.conversation_id)) errors.push(`${where}: исходный ID повторяется.`);
    result.set(dialog.conversation_id, dialog);
    if (!Array.isArray(dialog.transcript)) errors.push(`${where}: нужен исходный массив transcript.`);
    if (dialog.channel === 'agent chat') chats++;
    else if (dialog.channel === 'voice call') calls++;
    else errors.push(`${where}: неизвестный канал.`);
  });
  if (dataset === 'dev' && (chats !== 60 || calls !== 5)) errors.push('DEV должен содержать 60 чатов и 5 звонков.');
  if (dataset === 'prod' && (chats !== 10 || calls !== 0)) errors.push('PROD должен содержать ровно 10 чатов без звонков.');
  return result;
}

function validateValue(value, criterion, context, errors) {
  if (value === null) {
    if (!criterion.na) errors.push(`${context}: N/A для этого критерия запрещён.`);
    return criterion.na;
  }
  if (criterion.type === 'binary') {
    if (typeof value !== 'boolean') { errors.push(`${context}: требуется boolean, а не строка или число.`); return false; }
  } else if (typeof value !== 'number' || !Number.isFinite(value) || !criterion.values.includes(value)) {
    errors.push(`${context}: значение не входит в исходную шкалу.`); return false;
  }
  return true;
}

function finalScore(criteria) {
  let earnedTwice = 0, weights = 0;
  for (const criterion of CRITERIA) {
    const item = criteria.find(item => item.criterion_id === criterion.id);
    if (!item || criterion.id === 'critical' || item.value === null) continue;
    weights += criterion.weight;
    earnedTwice += criterion.type === 'binary' ? (item.value ? criterion.weight * 2 : 0) : item.value * (criterion.id === 'dialogue' ? 3 : 2);
  }
  if (!weights) return null;
  // Appendix weights yield integer half-points. Integer rational arithmetic avoids banker rounding.
  const numerator = BigInt(earnedTwice) * 5000n, denominator = BigInt(weights);
  return Number((2n * numerator + denominator) / (2n * denominator)) / 100;
}

function validateScore(score, criteria, context, errors) {
  if (!exactKeys(score, ['final_score', 'critical_flag'], context, errors)) return;
  if (typeof score.final_score !== 'number' || !Number.isFinite(score.final_score) || score.final_score < 0 || score.final_score > 100 || Number(score.final_score.toFixed(2)) !== score.final_score) {
    errors.push(`${context}: final_score должен быть числом от 0 до 100 с точностью до двух знаков.`);
  } else if (criteria.length === 8 && finalScore(criteria) !== score.final_score) errors.push(`${context}: итог не совпадает с расчётом по исходным весам.`);
  if (typeof score.critical_flag !== 'boolean') errors.push(`${context}: critical_flag должен быть boolean.`);
  else if (criteria.find(c => c.criterion_id === 'critical')?.value !== score.critical_flag) errors.push(`${context}: critical_flag не совпадает с критерием critical.`);
}

function checkSnapshot(snapshot, context, errors) {
  if (!object(snapshot) || !Array.isArray(snapshot.criteria) || snapshot.criteria.length !== 8) { errors.push(`${context}: снимок чек-листа не соответствует исходным восьми критериям.`); return; }
  const seen = new Set();
  for (const item of snapshot.criteria) {
    const criterion = BY_ID.get(item?.id ?? item?.criterion_id);
    if (!criterion || seen.has(criterion.id)) { errors.push(`${context}: в снимке неизвестный или повторный критерий.`); continue; }
    seen.add(criterion.id);
    if (item.answer_type !== criterion.type || typeof item.weight !== 'number' || item.weight !== criterion.weight || item.na_allowed !== criterion.na || Boolean(item.gross_error) !== (criterion.id === 'critical')) {
      errors.push(`${context}: тип, вес, N/A или признак грубой ошибки изменён у ${criterion.id}.`);
    }
    if (criterion.type === 'binary') {
      if (item.scale != null) errors.push(`${context}: у бинарного критерия ${criterion.id} не должно быть шкалы.`);
    } else {
      const values = Array.isArray(item.scale?.steps) ? item.scale.steps.map(s => s?.value) : [];
      if (item.scale?.min !== 0 || item.scale?.max !== criterion.max || values.length !== criterion.values.length || values.some(v => typeof v !== 'number') || JSON.stringify([...values].sort((a, b) => a - b)) !== JSON.stringify(criterion.values)) errors.push(`${context}: изменена исходная шкала ${criterion.id}.`);
    }
  }
}

function reviewed(evaluation) {
  // The team API includes unchanged original answers and an explicit null decision before any review.
  const untouchedServerMetadata=Array.isArray(evaluation.criteria) && evaluation.criteria.length>0
    && (evaluation.original_total==null || evaluation.original_total===evaluation.total)
    && evaluation.criteria.every(item=>own(item,'decision') && item.decision===null && own(item,'original_answer') && item.original_answer===item.answer && item.review_reason===null);
  return evaluation.reviewed === true || evaluation.revised === true || own(evaluation, 'final_criteria') ||
    Array.isArray(evaluation.appeals) && evaluation.appeals.some(a => a?.decision) ||
    evaluation.original_total!=null && own(evaluation, 'total') && evaluation.original_total !== evaluation.total ||
    Array.isArray(evaluation.criteria) && evaluation.criteria.some(c => ['original_answer', 'original_evidence', 'original_explanation', 'original_checked_range', 'review_reason', 'revised_answer', 'revised_evidence', 'revised_explanation', 'reviewed_evidence', 'revision', 'review_decision', 'reviewed_at'].some(key => own(c, key) && !(untouchedServerMetadata && ['original_answer','review_reason'].includes(key))));
}

function sourceCriteria(evaluation, source, context, errors, warnings) {
  const hasReview = reviewed(evaluation);
  if (source === 'original' && hasReview && !Array.isArray(evaluation.original_criteria)) {
    errors.push(`${context}: после пересмотра нужны original_criteria; восстановление исходных доказательств по отдельным ответам запрещено.`);
    return null;
  }
  if (source === 'final' && hasReview) warnings.push(`${context}: явно выбрана пересмотренная оценка.`);
  const hasOriginalTotal=own(evaluation,'original_total') && (hasReview || evaluation.original_total!=null);
  if (source === 'original') return {
    criteria: Array.isArray(evaluation.original_criteria) ? evaluation.original_criteria : evaluation.criteria,
    hasTotal: hasOriginalTotal || !hasReview && own(evaluation, 'total'),
    total: hasOriginalTotal ? evaluation.original_total : evaluation.total,
  };
  return { criteria: Array.isArray(evaluation.final_criteria) ? evaluation.final_criteria : evaluation.criteria, hasTotal: own(evaluation, 'final_total') || own(evaluation, 'total'), total: own(evaluation, 'final_total') ? evaluation.final_total : evaluation.total };
}

function evidenceTurns(item, length, context, errors) {
  const turns = new Set();
  if (own(item, 'evidence') && !Array.isArray(item.evidence)) errors.push(`${context}: evidence должен быть массивом.`);
  for (const evidence of Array.isArray(item.evidence) ? item.evidence : []) {
    const turn = evidence?.turn;
    if (!object(evidence) || !Number.isInteger(turn) || turn < 0 || turn >= length) errors.push(`${context}: ссылка на реплику выходит за исходный транскрипт.`);
    else turns.add(turn + 1);
  }
  if (own(item, 'evidence_turns')) {
    if (!Array.isArray(item.evidence_turns)) errors.push(`${context}: evidence_turns должен быть массивом.`);
    else for (const turn of item.evidence_turns) {
      if (!Number.isInteger(turn) || turn < 1 || turn > length) errors.push(`${context}: готовый индекс реплики выходит за исходный транскрипт.`);
      else turns.add(turn);
    }
  }
  if (item.checked_range != null) {
    const range = item.checked_range;
    const start = Array.isArray(range) ? range[0] : range.from;
    const end = Array.isArray(range) ? range[1] : range.to;
    if (!(object(range) || Array.isArray(range) && range.length === 2) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= length) errors.push(`${context}: checked_range выходит за исходный транскрипт.`);
    else for (let turn = start; turn <= end; turn++) turns.add(turn + 1);
  }
  return [...turns].sort((a, b) => a - b);
}

function observedModels(evaluation, context, errors, warnings) {
  const names = [];
  const sources = [evaluation.model, ...(Array.isArray(evaluation.calls) ? evaluation.calls.map(call => call?.model) : [])];
  for (const name of sources) {
    if (name == null) continue;
    if (!nonempty(name)) { errors.push(`${context}: имя фактически использованной модели некорректно.`); continue; }
    const safe = cleanText(name, `${context}, модель`, errors, warnings);
    if (DEMO_NAME.test(name)) errors.push(`${context}: mock/demo/учебная модель запрещена для сдачи.`);
    if (safe) names.push(safe);
  }
  if (!names.length) warnings.push(`${context}: в оценке нет имени модели; проверьте указанное общее имя модели.`);
  return unique(names);
}

/** Strict organizer JSON only. Internal evidence is zero-based; exported indices are one-based. */
export function buildSubmission(options = {}) {
  const { dataset, teamName, model, entries, expectedDialogs, source = 'original' } = object(options) ? options : {};
  const errors = [], warnings = [], observed = new Set();
  const expected = expectedSet(dataset, expectedDialogs, errors);
  const team = cleanText(teamName, 'Название команды', errors, warnings);
  const modelName = cleanText(model?.name, 'Модель', errors, warnings);
  if (!MODES.has(model?.mode)) errors.push('Укажите режим модели: local, external_api или hybrid.');
  if (modelName && DEMO_NAME.test(modelName)) errors.push('Mock/demo/учебная модель запрещена для сдачи.');
  if (!['original', 'final'].includes(source)) errors.push('Источник оценки должен быть original или final.');
  if (!Array.isArray(entries)) errors.push('Нужен массив оценок диалогов.');
  const results = [];
  (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
    const context = `Результат ${index + 1}`;
    const dialog = entry?.dialog;
    if (!object(dialog) || !nonempty(dialog.conversation_id)) { errors.push(`${context}: отсутствует исходный ID диалога.`); return; }
    const original = expected.get(dialog.conversation_id);
    if (!original) { errors.push(`${context}: ID отсутствует в исходном наборе.`); return; }
    if (dialog.demo === true || dialog.is_demo === true || dialog.mock === true) { errors.push(`${context}: учебный диалог запрещён для сдачи.`); return; }
    const evaluation = entry?.evaluation;
    if (object(evaluation) && (evaluation.demo === true || evaluation.is_demo === true || evaluation.mock === true || DEMO_NAME.test(String(evaluation.provider || '')) || [evaluation.model,...(Array.isArray(evaluation.calls)?evaluation.calls.map(call=>call?.model):[])].some(name=>DEMO_NAME.test(String(name || ''))))) { errors.push(`${context}: mock/demo-оценка запрещена для сдачи.`); return; }
    const row = { conversation_id: original.conversation_id };
    const privacy = transcriptPrivacy(original.transcript);
    if (own(entry, 'error')) {
      const value = entry.error instanceof Error ? entry.error.message : entry.error;
      const message = publicText(cleanText(value, `${context}, ошибка`, errors, warnings, true), privacy, `${context}, ошибка`, errors, true);
      results.push({ ...row, status: 'error', criteria: [], score: null, error: message });
      return;
    }
    if (!object(evaluation)) { errors.push(`${context}: оценки нет; явная ошибка не указана.`); return; }
    if (own(evaluation, 'conversation_id') && evaluation.conversation_id !== original.conversation_id) errors.push(`${context}: оценка относится к другому диалогу.`);
    observedModels(evaluation, context, errors, warnings).forEach(name => observed.add(name));
    if (own(evaluation, 'checklist')) checkSnapshot(evaluation.checklist, `${context}, чек-лист`, errors);
    if (own(evaluation, 'checklist_snapshot')) checkSnapshot(evaluation.checklist_snapshot, `${context}, снимок чек-листа`, errors);
    const selected = sourceCriteria(evaluation, source, context, errors, warnings);
    if (!selected) return;
    if (!Array.isArray(selected.criteria) || selected.criteria.length !== 8) { errors.push(`${context}: нужны ровно восемь критериев.`); return; }
    const seen = new Set(), criteria = [];
    for (const item of selected.criteria) {
      const criterion = BY_ID.get(item?.criterion_id);
      if (!criterion || seen.has(criterion.id)) { errors.push(`${context}: неизвестный или повторный критерий.`); continue; }
      seen.add(criterion.id);
      const where = `${context}, ${criterion.id}`;
      const resolvedReview = source === 'final' && object(item.decision) && ['confirmed', 'changed'].includes(item.decision.status) && item.decision.answer === item.answer && nonempty(item.decision.reason) && item.needs_review !== true;
      if (item.needs_review === true || Array.isArray(item.problems) && item.problems.length && !resolvedReview) errors.push(`${where}: ответ требует проверки и не готов к сдаче.`);
      let value = own(item, 'answer') ? item.answer : item.value;
      if (value === 'yes') value = true;
      else if (value === 'no') value = false;
      else if (value === 'na') value = null;
      validateValue(value, criterion, where, errors);
      const reviewRationale = source === 'final' && (object(item.decision) || nonempty(item.review_reason));
      const explanation = reviewRationale ? item.decision?.reason ?? item.review_reason : own(item, 'explanation') ? item.explanation : item.rationale;
      let rationale = cleanText(explanation, `${where}, обоснование`, errors, warnings, true);
      if (value === null && !reviewRationale && nonempty(item.na_reason)) {
        const reason = cleanText(item.na_reason, `${where}, причина N/A`, errors, warnings, true);
        if (reason && !rationale.includes(reason)) rationale += ` N/A: ${reason}`;
      }
      rationale = publicText(rationale, privacy, `${where}, обоснование`, errors, true);
      const evidence = evidenceTurns(item, Array.isArray(original.transcript) ? original.transcript.length : 0, where, errors);
      if (!evidence.length) warnings.push(`${where}: нет ссылок на реплики.`);
      criteria.push({ criterion_id: criterion.id, value, rationale, evidence_turns: evidence });
    }
    criteria.sort((a, b) => CRITERIA.findIndex(c => c.id === a.criterion_id) - CRITERIA.findIndex(c => c.id === b.criterion_id));
    if (criteria.length !== 8 || criteria.some(item => !CRITERIA.find(c => c.id === item.criterion_id) || item.value === undefined)) return;
    // Do not run integer scoring over invalid values; validation above will block generation.
    const valid = criteria.every(item => {
      const c = BY_ID.get(item.criterion_id);
      return item.value === null ? c.na : c.type === 'binary' ? typeof item.value === 'boolean' : typeof item.value === 'number' && c.values.includes(item.value);
    });
    if (!valid) return;
    const total = finalScore(criteria);
    if (selected.hasTotal && (typeof selected.total !== 'number' || !Number.isFinite(selected.total) || selected.total !== total)) errors.push(`${context}: сохранённый итог не совпадает с расчётом исходной оценки.`);
    const critical = criteria.find(c => c.criterion_id === 'critical').value;
    const flagKey = source === 'original' && own(evaluation, 'original_gross_error') ? 'original_gross_error' : source === 'final' || !reviewed(evaluation) ? 'gross_error' : null;
    if (flagKey && own(evaluation, flagKey) && evaluation[flagKey] !== critical) errors.push(`${context}: сохранённый признак грубой ошибки не совпадает с critical.`);
    results.push({ ...row, status: 'ok', criteria, score: { final_score: total, critical_flag: critical } });
  });
  for (const name of observed) if (!modelName.toLocaleLowerCase().includes(name.toLocaleLowerCase())) errors.push('Общее имя модели должно перечислять все фактически использованные модели, включая резервные вызовы.');
  const document = { schema_version: '1.0', team_name: team, model: { mode: model?.mode, name: modelName }, results };
  const checked = validateSubmission(document, { dataset, expectedDialogs });
  errors.push(...checked.errors); warnings.push(...checked.warnings);
  return { document: errors.length ? null : document, errors: unique(errors), warnings: unique(warnings) };
}

/** Validate uploaded submission without coercion or changing the supplied document. */
export function validateSubmission(document, { dataset, expectedDialogs } = {}) {
  const errors = [], warnings = [];
  const expected = expectedSet(dataset, expectedDialogs, errors);
  if (!exactKeys(document, ['schema_version', 'team_name', 'model', 'results'], 'Документ', errors)) return { valid: false, errors: unique(errors), warnings };
  if (document.schema_version !== '1.0') errors.push('schema_version должен быть строкой 1.0.');
  cleanText(document.team_name, 'Название команды', errors, warnings);
  if (exactKeys(document.model, ['mode', 'name'], 'Модель', errors)) {
    if (!MODES.has(document.model.mode)) errors.push('Укажите режим модели: local, external_api или hybrid.');
    cleanText(document.model.name, 'Модель', errors, warnings);
    if (DEMO_NAME.test(String(document.model.name || ''))) errors.push('Mock/demo/учебная модель запрещена для сдачи.');
  }
  if (!Array.isArray(document.results)) { errors.push('results должен быть массивом.'); return { valid: false, errors: unique(errors), warnings }; }
  if (document.results.length !== expected.size) errors.push('Количество результатов не совпадает с исходным набором.');
  const seen = new Set();
  document.results.forEach((row, index) => {
    const context = `Результат ${index + 1}`;
    if (!object(row)) { errors.push(`${context}: ожидается объект.`); return; }
    if (typeof row.conversation_id !== 'string' || !expected.has(row.conversation_id)) errors.push(`${context}: ID отсутствует в исходном наборе.`);
    if (seen.has(row.conversation_id)) errors.push(`${context}: ID повторяется.`);
    seen.add(row.conversation_id);
    const dialog = expected.get(row.conversation_id);
    const privacy = transcriptPrivacy(dialog?.transcript);
    if (!['ok', 'error'].includes(row.status)) { errors.push(`${context}: status должен быть ok или error.`); return; }
    if (row.status === 'error') {
      exactKeys(row, ['conversation_id', 'status', 'criteria', 'score', 'error'], context, errors);
      if (!Array.isArray(row.criteria) || row.criteria.length !== 0 || row.score !== null) errors.push(`${context}: при error нужны criteria: [] и score: null.`);
      publicText(cleanText(row.error, `${context}, ошибка`, errors, warnings), privacy, `${context}, ошибка`, errors);
      warnPersonalText(row.error, `${context}, ошибка`, warnings);
      return;
    }
    exactKeys(row, ['conversation_id', 'status', 'criteria', 'score'], context, errors);
    if (!Array.isArray(row.criteria) || row.criteria.length !== 8) { errors.push(`${context}: нужны ровно восемь критериев.`); return; }
    const ids = new Set(), validCriteria = [];
    for (const item of row.criteria) {
      if (!exactKeys(item, ['criterion_id', 'value', 'rationale', 'evidence_turns'], `${context}, критерий`, errors)) continue;
      const criterion = CRITERIA.find(c => c.id === item.criterion_id);
      if (!criterion || ids.has(item.criterion_id)) { errors.push(`${context}: неизвестный или повторный канонический criterion_id.`); continue; }
      ids.add(criterion.id);
      if (validateValue(item.value, criterion, `${context}, ${criterion.id}`, errors)) validCriteria.push(item);
      publicText(cleanText(item.rationale, `${context}, ${criterion.id}, обоснование`, errors, warnings), privacy, `${context}, ${criterion.id}, обоснование`, errors);
      warnPersonalText(item.rationale, `${context}, ${criterion.id}`, warnings);
      if (!Array.isArray(item.evidence_turns)) errors.push(`${context}, ${criterion.id}: evidence_turns должен быть массивом.`);
      else {
        const max = Array.isArray(dialog?.transcript) ? dialog.transcript.length : 0;
        if (item.evidence_turns.some(turn => !Number.isInteger(turn) || turn < 1 || turn > max)) errors.push(`${context}, ${criterion.id}: индекс реплики вне исходного транскрипта.`);
        if (new Set(item.evidence_turns).size !== item.evidence_turns.length) errors.push(`${context}, ${criterion.id}: индексы реплик повторяются.`);
        if (item.evidence_turns.some((turn, i, list) => i > 0 && list[i - 1] > turn)) errors.push(`${context}, ${criterion.id}: индексы реплик должны быть отсортированы.`);
        if (!item.evidence_turns.length) warnings.push(`${context}, ${criterion.id}: нет ссылок на реплики.`);
      }
    }
    validateScore(row.score, validCriteria, `${context}, итог`, errors);
  });
  if ([...expected.keys()].some(id => !seen.has(id))) errors.push('Не для всех исходных диалогов есть результат.');
  return { valid: errors.length === 0, errors: unique(errors), warnings: unique(warnings) };
}
