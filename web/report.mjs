const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
const has = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const number = value => isNumber(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : 'Не передано';

function answer(value) {
  if (value === 'yes') return 'Да';
  if (value === 'no') return 'Нет';
  if (value === 'na') return 'N/A';
  return isNumber(value) ? number(value) : 'Ответ не получен';
}

function text(value) {
  // Access-bearing links have no place in an exported document.
  return String(value ?? '').replace(/https?:\/\/[^\s<>"'«»]+/gi, url => /[?&](?:sig|token|api[_-]?key|key|authorization|password)=/i.test(url) ? '[ссылка с данными доступа скрыта]' : url);
}

const safe = value => esc(text(value));

function time(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Не указано';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Не указано';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Almaty' }).format(date);
}

function snapshotFor(evaluation, checklist) {
  if (!evaluation || evaluation.checklist_id == null || evaluation.checklist_version == null) return null;
  const matches = value => value && typeof value === 'object'
    && value.id === evaluation.checklist_id
    && String(value.version) === String(evaluation.checklist_version)
    && Array.isArray(value.criteria);
  if (matches(evaluation.checklist)) return evaluation.checklist;
  return matches(checklist) ? checklist : null;
}

function score(value, absentText = 'Не передано') {
  if (value === null) return 'Не рассчитан';
  return isNumber(value) ? `${number(value)} <span>/ 100</span>` : absentText;
}

function validTurn(index, transcript) {
  return Number.isInteger(index) && index >= 0 && index < transcript.length
    && transcript[index] && typeof transcript[index] === 'object';
}

function renderTurns(transcript, indices) {
  const roles = { operator: 'Оператор', client: 'Клиент', bot: 'Бот', system: 'Система' };
  return `<ol class="report-turns">${indices.map(index => {
    const turn = transcript[index] || {};
    return `<li><div class="report-turn-label">Реплика ${index + 1} · ${safe(roles[turn.speaker] || turn.speaker || 'Роль не указана')} · ${safe(turn.timestamp || 'Время не указано')}</div><p>${safe(turn.text)}</p></li>`;
  }).join('')}</ol>`;
}

function renderEvidence(item, transcript) {
  const evidence = list(item.evidence);
  const range = item.checked_range;
  const fragments = new Set();
  let invalidReference = false;
  const quotes = evidence.map(entry => {
    const valid = validTurn(entry.turn, transcript);
    if (valid) {
      for (let index = Math.max(0, entry.turn - 1); index <= Math.min(transcript.length - 1, entry.turn + 1); index++) if (validTurn(index, transcript)) fragments.add(index);
    } else invalidReference = true;
    return `<div class="report-quote"><p class="report-evidence-label">${valid ? `Реплика ${entry.turn + 1} · ${safe(transcript[entry.turn].timestamp || 'Время не указано')}` : 'Ссылка на реплику недействительна'}</p><blockquote>${entry.quote ? `«${safe(entry.quote)}»` : 'Цитата не передана'}</blockquote></div>`;
  }).join('');
  let rangeLabel = '';
  if (range) {
    if (validTurn(range.from, transcript) && validTurn(range.to, transcript) && range.to >= range.from) {
      rangeLabel = `<p class="report-evidence-label">Проверенный участок: реплики ${range.from + 1}–${range.to + 1}.</p>`;
      if (range.to - range.from <= 5) {
        for (let index = range.from; index <= range.to; index++) {
          if (validTurn(index, transcript)) fragments.add(index);
          else invalidReference = true;
        }
      } else {
        for (const index of [range.from, range.from + 1, range.to - 1, range.to]) if (validTurn(index, transcript)) fragments.add(index);
        rangeLabel += '<p class="report-muted">Показаны начало и конец проверенного участка.</p>';
      }
    } else invalidReference = true;
  }
  if (!evidence.length && !range) return item.answer === 'na' ? '' : '<p class="report-muted">Доказательства в результате не переданы.</p>';
  return `<div class="report-evidence"><h4>Доказательства и контекст</h4>${quotes}${rangeLabel}${invalidReference ? '<p class="report-warning">В результате есть некорректная ссылка или диапазон. Требуется проверка.</p>' : ''}${fragments.size ? renderTurns(transcript, [...fragments].sort((a, b) => a - b)) : ''}</div>`;
}

function criterionReport(item, criterion, index, transcript, originalCriteria) {
  const gross = criterion?.gross_error === true || item.gross_error === true;
  const original = originalCriteria.find(value => value.criterion_id === item.criterion_id);
  const originalAnswer = has(item, 'original_answer') ? item.original_answer : original?.answer;
  const baseWeight = isNumber(item.weight) ? item.weight : criterion?.weight;
  const points = isNumber(item.points) ? item.points : isNumber(item.weighted_score) ? item.weighted_score : item.score;
  return `<article class="report-criterion"><header class="report-criterion-heading"><div><p class="report-kicker">Критерий ${index + 1} · ${safe(item.criterion_id || 'ID не указан')}</p><h3>${safe(criterion?.title || item.criterion_id || 'Название не передано')}</h3></div><strong class="report-answer">${answer(item.answer)}</strong></header>
    <dl class="report-criterion-metrics">${gross ? '<div><dt>Тип критерия</dt><dd>Грубое нарушение, без баллов</dd></div>' : `<div><dt>Баллы</dt><dd>${item.answer === 'na' ? 'Не применяется' : number(points)}</dd></div><div><dt>Базовый вес</dt><dd>${number(baseWeight)}</dd></div><div><dt>Действующий вес</dt><dd>${item.answer === 'na' ? 'Исключён' : number(item.effective_weight)}</dd></div>`}${originalAnswer !== undefined ? `<div><dt>Исходный ответ</dt><dd>${answer(originalAnswer)}</dd></div>` : ''}</dl>
    ${criterion?.description ? `<p class="report-rule"><strong>Правило:</strong> ${safe(criterion.description)}</p>` : ''}<p>${safe(item.explanation || 'Обоснование не передано.')}</p>
    ${item.answer === 'na' ? `<p class="report-na"><strong>Причина N/A:</strong> ${safe(item.na_reason || 'Причина не передана; требуется проверка.')}</p>` : ''}${item.needs_review ? '<p class="report-warning">Нужна проверка человеком.</p>' : ''}${has(item, 'review_reason') ? `<p class="report-decision"><strong>Причина пересмотра:</strong> ${safe(item.review_reason)}</p>` : ''}${renderEvidence(item, transcript)}</article>`;
}

function appealReport(appeal, criteria) {
  const criterion = criteria.find(value => value.id === appeal.criterion_id);
  const statuses = { open: 'Открыта', confirmed: 'Оценка подтверждена', changed: 'Оценка изменена' };
  return `<article class="report-appeal"><header><h3>${safe(criterion?.title || appeal.criterion_id || 'Критерий не указан')}</h3><p class="report-muted">${safe(statuses[appeal.status] || 'Статус не передан')}</p></header><p><strong>Комментарий:</strong> ${safe(appeal.comment || 'Не передан')}</p>${appeal.decision && typeof appeal.decision === 'object' ? `<dl class="report-criterion-metrics"><div><dt>Ответ проверяющего</dt><dd>${answer(appeal.decision.answer)}</dd></div><div><dt>Время решения</dt><dd>${time(appeal.decision.decided_at)}</dd></div></dl><p><strong>Причина решения:</strong> ${safe(appeal.decision.reason || 'Не передана')}</p>` : '<p class="report-muted">Решение ещё не принято.</p>'}</article>`;
}

/** Render a read-only report from a saved evaluation; never calculate a model score. */
export function buildReport({ dialog = {}, evaluation = null, checklist = null, appeals = [], demo = false } = {}) {
  dialog = dialog && typeof dialog === 'object' ? dialog : {};
  evaluation = evaluation && typeof evaluation === 'object' ? evaluation : null;
  const transcript = Array.isArray(dialog.transcript) ? dialog.transcript : [];
  const snapshot = snapshotFor(evaluation, checklist);
  const criteria = list(snapshot?.criteria);
  const results = list(evaluation?.criteria);
  const originalCriteria = list(evaluation?.original_criteria);
  const sections = list(evaluation?.sections);
  const shownAppeals = evaluation?.id != null ? list(appeals).filter(value => value.evaluation_id === evaluation.id) : [];
  const demonstration = demo === true || evaluation?.demo === true || ['mock', 'demo'].includes(evaluation?.provider) || evaluation?.model === 'mock';
  const voice = dialog.channel === 'voice call';
  const reviewRequired = results.some(value => value.needs_review === true);
  return `<section class="quality-report" aria-label="Отчёт о качестве диалога">
    <header class="report-header"><p class="report-brand">CQA · Контроль качества</p><h1>Отчёт о качестве диалога</h1><p class="report-subtitle">${safe(dialog.title || dialog.subject || dialog.conversation_id || 'Диалог не указан')}</p></header>
    ${demonstration ? '<p class="report-demo"><strong>Учебный отчёт.</strong> Вымышленные данные и оценки. Модель не вызывается; результаты не отражают точность AI.</p>' : ''}
    <dl class="report-metadata"><div><dt>Диалог</dt><dd>${safe(dialog.conversation_id || evaluation?.conversation_id || 'Не указан')}</dd></div><div><dt>Канал</dt><dd>${voice ? 'Звонок' : dialog.channel === 'agent chat' ? 'Чат' : 'Не указан'}</dd></div><div><dt>Язык</dt><dd>${safe(dialog.language || 'Не указан')}</dd></div><div><dt>Чек-лист</dt><dd>${safe(snapshot?.name || evaluation?.checklist_id || 'Не указан')} · версия ${safe(evaluation?.checklist_version ?? 'не указана')}</dd></div><div><dt>Модель</dt><dd>${safe(evaluation?.model || 'Не указана')}</dd></div><div><dt>Время оценки, Алматы</dt><dd>${time(evaluation?.evaluated_at)}</dd></div></dl>
    ${voice ? '<p class="report-muted report-audio-note">Запись доступна в карточке диалога.</p>' : ''}
    ${!evaluation ? '<p class="report-warning">Оценка ещё не выполнена. Баллы и обоснования не сформированы.</p>' : `<section class="report-summary" aria-label="Итог оценки"><div><h2>Итоговый балл</h2><p class="report-total">${score(evaluation.total)}</p></div><div><h2>Исходный балл</h2><p class="report-original">${score(evaluation.original_total)}</p></div><div><h2>Грубые ошибки</h2><p>${evaluation.gross_error === true ? 'Обнаружены' : evaluation.gross_error === false ? 'Не обнаружены' : 'Сведения не переданы'}</p><p class="report-muted">Отметка отдельно от итогового балла.</p></div></section>
      ${reviewRequired ? '<p class="report-warning">В оценке есть ответы, требующие проверки человеком.</p>' : ''}${!snapshot ? '<p class="report-warning">Снимок использованной версии чек-листа недоступен. Названия и правила другой версии не подставлялись.</p>' : ''}
      ${sections.length ? `<section class="report-section"><h2>Баллы по разделам</h2><dl class="report-section-scores">${sections.map(section => `<div><dt>${safe(section.name || list(snapshot?.sections).find(value => value.id === section.id)?.name || section.id || 'Раздел')}</dt><dd>${number(section.score)}</dd></div>`).join('')}</dl></section>` : ''}
      <section class="report-section"><h2>Оценка по критериям</h2>${results.length ? results.map((item, index) => criterionReport(item, criteria.find(value => value.id === item.criterion_id), index, transcript, originalCriteria)).join('') : '<p class="report-muted">Ответы по критериям не переданы.</p>'}</section>
      <section class="report-section"><h2>Апелляции и решения</h2>${shownAppeals.length ? shownAppeals.map(appeal => appealReport(appeal, criteria)).join('') : '<p class="report-muted">Для этой оценки апелляции отсутствуют.</p>'}</section>`}
    <footer class="report-footer">CQA · Прототип команды. Отчёт по сохранённым результатам; пересчёт AI-оценки при печати не выполняется.</footer>
  </section>`;
}
