import { createApi } from './api.mjs';
import { attentionReasons, filterDialogs, summarizeDialogs, reviewExcerpt, dialogTitle, evaluationChecklist } from './dialog-utils.mjs';
import { compareChecklists, renderChecklistDiff } from './checklist-diff.mjs';
import { buildReport } from './report.mjs';
import { createSubmissionUI } from './submission-ui.mjs';

const $ = (s, root = document) => root.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg class="icon" aria-hidden="true" focusable="false"><use href="./icons.svg#${name}"></use></svg>`;
const num = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : '—';
const label = value => ({ yes:'Да', no:'Нет', na:'N/A', open:'Открыта', confirmed:'Подтверждена', changed:'Пересмотрена', completed:'Оценён', done:'Оценён', evaluated:'Оценён', pending:'Без оценки', new:'Без оценки', queued:'В очереди', running:'В обработке', failed:'Ошибка' }[value] ?? String(value ?? '—'));
const channel = value => value === 'voice call' ? 'Звонок' : 'Чат';
const roles = {operator:'Оператор', client:'Клиент', bot:'Бот', system:'Система'};
const main = $('#main');
const modal = $('#modal');
let toastTimer, routeRevision = 0, polling = false;
let saved = {};
try { saved = JSON.parse(localStorage.getItem('cqa-connection') || '{}'); } catch { /* Storage may be unavailable. */ }
const config = window.CQA_CONFIG || {};
const S = { demo:new URLSearchParams(location.search).get('demo') === '1' || (saved.demo ?? config.demo ?? false), baseUrl:saved.baseUrl ?? config.apiBase ?? '/api', rows:[], checklists:[], appeals:[], selected:new Set(), filters:{query:'', language:'', channel:'', status:''}, dialog:null, evaluation:null, audio:null, editor:null, criterionIndex:0, dirty:false, busy:false, appealFilter:'open', queue:'all', summaryScope:'filtered', editorBase:null, pendingChecklist:null, reviewContexts:new Map(), reviewDrafts:new Map(), savingChecklist:false };
let api;
const submissionUI = createSubmissionUI({root:main,getApi:()=>api,isDemo:()=>S.demo,teamName:config.teamName || 'seeusoon',notify});
function rememberJob(id) {try{if(id)sessionStorage.setItem('cqa-active-job',JSON.stringify({id,baseUrl:S.baseUrl,demo:S.demo}));else sessionStorage.removeItem('cqa-active-job');}catch{/* Jobs still run when browser storage is disabled. */}}

function notify(text, error = false) {
  clearTimeout(toastTimer);
  $('#notifications').innerHTML = `<div class="toast ${error ? 'error' : ''}">${esc(text)}</div>`;
  toastTimer = setTimeout(() => { $('#notifications').textContent = ''; }, 6500);
}
function errorText(e) { const message=String(e?.message || 'Не удалось выполнить действие. Повторите попытку.');return /\b(sig|token|api[_-]?key|authorization|password)\b/i.test(message)?'Ошибка запроса. Подробности с данными доступа скрыты.':message.replace(/https?:\/\/\S+/gi,'[адрес скрыт]').slice(0,300); }
function busyButton(button, busy) { if (button) { button.disabled = busy; button.setAttribute('aria-busy', String(busy)); } }
function connect() {
  api = createApi({ baseUrl:S.baseUrl, demo:S.demo });
  $('#demo-banner').hidden = !S.demo;
  $('#mode-label').textContent = S.demo ? 'Учебный пример' : 'Данные сервера';
  $('#connection-label').textContent = S.demo ? 'Учебный пример' : 'Настройки подключения';
}
function section() { return (location.hash.slice(1).split('/')[0] || 'dialogs'); }
function route() { return location.hash.slice(1).split('/'); }
function checklistKey(c) { return `${c.id}@${c.version}`; }
function findChecklist(key) { return S.checklists.find(c => checklistKey(c) === key) || S.checklists.find(c => c.id === key) || S.checklists[0]; }
function checklistForEvaluation() { return evaluationChecklist(S.evaluation,S.checklists); }
function nameForRow(row) { return dialogTitle(row); }
function rowStatus(row) { return row.status || (row.evaluation_id ? 'completed' : 'pending'); }
function statusBadge(row) {
  const status = rowStatus(row);
  return `<span class="badge ${['completed','done','evaluated'].includes(status) ? 'badge-green' : status === 'failed' ? 'badge-red' : ''}"><span class="mini-dot" aria-hidden="true"></span>${esc(label(status))}</span>`;
}
function openModal(title, contents, formId) {
  modal.classList.remove('wide-modal');
  $('#modal-content').innerHTML = `<div class="modal-heading"><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="Закрыть окно">${icon('close')}</button></div>${contents}`;
  if (!modal.open) modal.showModal();
  setTimeout(() => $(`#${formId} input, #${formId} textarea, #${formId} select`)?.focus(), 0);
}
function skeleton() { main.innerHTML = `<div class="panel loading" aria-label="Загрузка" aria-busy="true"><div class="skeleton wide"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton wide"></div></div>`; }
function empty(title, text, actions = '') { return `<div class="empty-state"><div class="empty-symbol" aria-hidden="true">▤</div><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions">${actions}</div></div>`; }
function showError(e) {
  main.innerHTML = `<div class="page-heading"><div><h1>Нет подключения к данным</h1><p>Интерфейс работает, но сервер пока не ответил.</p></div></div><section class="panel">${empty('Не удалось получить данные', errorText(e), '<button class="btn btn-primary" data-action="retry">Повторить</button><button class="btn" data-action="settings">Настроить API</button><button class="btn btn-ghost" data-action="demo">Открыть учебный пример</button>')}</section>`;
}
async function loadRoute() {
  const revision = ++routeRevision;
  const [page, id] = route();
  document.querySelectorAll('[data-nav]').forEach(a => a.setAttribute('aria-current', a.dataset.nav === (['dialog','report'].includes(page) ? 'dialogs' : page || 'dialogs') ? 'page' : 'false'));
  $('#breadcrumb').textContent = ({dialogs:'Диалоги',dialog:'Карточка диалога',report:'Отчёт',checklists:'Чек-листы',appeals:'Апелляции',submission:'Выгрузка'}[page] || 'Диалоги');
  document.title = `CQA · ${$('#breadcrumb').textContent}`;
  $('#demo-banner').hidden = !S.demo || page==='submission';
  if(page==='submission'){submissionUI.render();return;}
  skeleton();
  try {
    const [rows, checklists, appeals] = await Promise.all([api.listDialogs(), api.listChecklists(), api.listAppeals()]);
    if (revision !== routeRevision) return;
    const resolvedAppeals=await Promise.all(appeals.map(async appeal=>{if(appeal.conversation_id)return appeal;const row=rows.find(r=>r.evaluation_id===appeal.evaluation_id);if(row)return {...appeal,conversation_id:row.conversation_id};try{const ev=await api.getEvaluation(appeal.evaluation_id);return {...appeal,conversation_id:ev.conversation_id};}catch{return {...appeal,context_unavailable:true};}}));
    if(revision!==routeRevision)return;
    S.rows = rows; S.checklists = checklists; S.appeals = resolvedAppeals; S.reviewContexts.clear();
    $('#dialog-count').textContent = rows.length;
    $('#appeal-count').textContent = appeals.filter(a => a.status === 'open').length || '';
    if (['dialog','report'].includes(page) && id) {
      const record = await api.getDialog(decodeURIComponent(id));
      const evaluationId = record.evaluation_id || rows.find(r => r.conversation_id === record.conversation_id)?.evaluation_id;
      const evaluation = evaluationId ? await api.getEvaluation(evaluationId) : null;
      if (revision !== routeRevision) return;
      S.dialog = record; S.evaluation = evaluation; S.audio = null;
      if(page==='report')renderReport();else renderDialog();
    } else if (page === 'checklists') {
      if (!S.dirty || !S.editor) { const current=checklists.find(c=>c.id===S.editor?.id) || checklists[0]; S.editor = structuredClone(current || freshChecklist()); S.editorBase=current?structuredClone(current):null; S.criterionIndex = Math.min(S.criterionIndex,Math.max(0,S.editor.criteria.length-1)); }
      renderEditor();
    } else if (page === 'appeals') renderAppeals();
    else renderDialogs();
  } catch (e) { if (revision === routeRevision) showError(e); }
}
function queueBadge(row) {
  const names={gross:'Грубая ошибка',review:'Нужна проверка',appeal:'Открытая апелляция'};
  return attentionReasons(row,S.appeals).map(reason=>`<span class="badge ${reason==='gross'?'badge-red':'badge-amber'}">${names[reason]}</span>`).join(' ');
}
function renderDialogs() {
  const attention=S.rows.filter(row=>attentionReasons(row,S.appeals).length).length;
  main.innerHTML = `<div class="page-heading"><div><h1>Диалоги</h1><p>Проверяйте качество работы операторов и обоснования оценок.</p></div><div class="actions"><a class="btn" href="#submission">Выгрузить для сдачи</a><button class="btn" data-action="import">${icon('download')}Импорт набора</button><button class="btn" data-action="upload">${icon('plus')}Загрузить JSON</button></div></div>
    <div class="summary-toolbar"><p id="summary-caption" class="stats-caption"></p><label>Охват сводки<select id="summary-scope"><option value="filtered" ${S.summaryScope==='filtered'?'selected':''}>Текущая выборка</option><option value="all" ${S.summaryScope==='all'?'selected':''}>Весь набор</option></select></label></div><section id="dialog-summary" class="stats-strip" aria-label="Сводка диалогов"></section>
    <div class="view-tabs queue-tabs" role="group" aria-label="Очередь диалогов"><button class="btn ${S.queue==='all'?'btn-dark':''}" data-queue="all" aria-pressed="${S.queue==='all'}">Все диалоги · ${S.rows.length}</button><button class="btn ${S.queue==='attention'?'btn-dark':''}" data-queue="attention" aria-pressed="${S.queue==='attention'}">Требует внимания · ${attention}</button></div>
    ${S.appeals.some(a=>a.status==='open'&&a.context_unavailable)?'<div class="notice queue-notice">У части апелляций не удалось получить связанный диалог. Они остаются в разделе «Апелляции».</div>':''}
    <section class="panel"><div class="panel-heading"><h2>${S.queue==='attention'?'Очередь проверки':'Все разговоры'} <span id="list-heading-count" class="muted small"></span></h2><button id="evaluate-selected" class="btn btn-primary" data-action="evaluate-selected" disabled>Оценить выбранные <span aria-hidden="true">↗</span></button></div>
    <div class="filters"><label class="search-field"><span aria-hidden="true">${icon('search')}</span><span class="sr-only">Поиск диалога</span><input id="search-dialogs" type="search" placeholder="Найти по ID или содержимому" value="${esc(S.filters.query)}"></label><label><span class="sr-only">Канал</span><select data-filter="channel"><option value="">Все каналы</option><option value="agent chat">Чаты</option><option value="voice call">Звонки</option></select></label><label><span class="sr-only">Язык</span><select data-filter="language"><option value="">Все языки</option><option value="RU">Русский</option><option value="KZ">Қазақша</option><option value="EN">English</option></select></label><label><span class="sr-only">Статус оценки</span><select data-filter="status"><option value="">Все статусы</option><option value="completed">С оценкой</option><option value="pending">Без оценки</option><option value="gross">Грубая ошибка</option><option value="review">Нужна проверка</option><option value="appeal">Открытая апелляция</option></select></label></div>
    <div class="table-scroll"><table><thead><tr><th><input id="select-all" type="checkbox" aria-label="Выбрать все видимые диалоги"></th><th>Диалог</th><th>Канал</th><th>Язык</th><th>Статус</th><th>Балл</th><th><span class="sr-only">Открыть</span></th></tr></thead><tbody id="dialog-rows"></tbody></table></div><div id="list-empty" hidden></div><div class="table-foot"><span id="visible-count" aria-live="polite"></span><span>${S.queue==='attention'?'Приоритет: грубые ошибки, проверка, апелляции':'Оценка по выбранному чек-листу'}</span></div></section>`;
  document.querySelectorAll('[data-filter]').forEach(el => { el.value = S.filters[el.dataset.filter]; });
  renderRows();
}
function visibleRows() { return filterDialogs(S.rows,{...S.filters,queue:S.queue},S.appeals); }
function renderSummary(rows) {
  const all=S.summaryScope==='all', summary=summarizeDialogs(all?S.rows:rows,S.appeals);
  $('#summary-caption').textContent=all?'Сводка по всему набору, независимо от фильтров.':`Сводка по текущей выборке: ${rows.length} из ${S.rows.length} диалогов. Учитываются очередь и все фильтры.`;
  $('#dialog-summary').setAttribute('aria-label',all?'Сводка по всему набору':'Сводка по текущей выборке');
  $('#dialog-summary').innerHTML=`<div class="stat"><span class="stat-label">Диалогов<br>в выборке</span><span class="stat-value">${summary.total}</span></div><div class="stat"><span class="stat-label">С оценкой</span><span class="stat-value green">${summary.evaluated}</span></div><div class="stat"><span class="stat-label">Средний балл<br>по оценённым</span><span class="stat-value">${num(summary.average)}</span></div><div class="stat"><span class="stat-label">Грубые<br>ошибки</span><span class="stat-value ${summary.gross?'red':''}">${summary.gross}</span></div>`;
}
function renderRows() {
  const rows = visibleRows();
  renderSummary(rows);
  $('#list-heading-count').textContent=`${rows.length} из ${S.rows.length}`;
  $('#dialog-rows').innerHTML = rows.map(r => `<tr class="${S.selected.has(r.conversation_id) ? 'selected' : ''}"><td><input type="checkbox" data-select="${esc(r.conversation_id)}" aria-label="Выбрать ${esc(r.conversation_id)}" ${S.selected.has(r.conversation_id) ? 'checked' : ''}></td><td><button class="dialog-title" data-open="${esc(r.conversation_id)}">${esc(nameForRow(r))}</button><span class="dialog-subtitle">${esc(r.conversation_id)}</span></td><td><span class="channel-icon" aria-hidden="true">${icon(r.channel === 'voice call' ? 'phone' : 'chat')}</span>${channel(r.channel)}</td><td><span class="badge">${esc(r.language)}</span></td><td><div class="row-status">${statusBadge(r)} ${queueBadge(r)}</div></td><td class="score-cell">${num(r.total)} ${Number.isFinite(r.total) ? '<span>/ 100</span>' : ''}</td><td><button class="icon-btn" data-open="${esc(r.conversation_id)}" aria-label="Открыть ${esc(r.conversation_id)}">${icon('arrow-up-right')}</button></td></tr>`).join('');
  $('#list-empty').hidden = rows.length > 0;
  $('#list-empty').innerHTML = S.rows.length ? empty('Ничего не найдено', 'Измените запрос, очередь или сбросьте фильтры.', '<button class="btn" data-action="reset-filters">Сбросить фильтры</button>') : empty('Добавьте первый диалог', 'Импортируйте набор по group_id или загрузите транскрипт в JSON.', '<button class="btn btn-primary" data-action="import">Импорт набора</button>');
  const hiddenSelected=[...S.selected].filter(id=>!rows.some(r=>r.conversation_id===id)).length;
  $('#visible-count').textContent = `Показано ${rows.length} из ${S.rows.length}${hiddenSelected?` · Выбрано вне фильтра: ${hiddenSelected}`:''}`;
  $('#select-all').checked = rows.length > 0 && rows.every(r => S.selected.has(r.conversation_id));
  $('#select-all').indeterminate = rows.some(r => S.selected.has(r.conversation_id)) && !$('#select-all').checked;
  $('#evaluate-selected').disabled = !S.selected.size || S.busy;
  $('#evaluate-selected').textContent = S.selected.size ? `Оценить выбранные (${S.selected.size}) ↗` : 'Оценить выбранные ↗';
}
function renderDialog() {
  const record = S.dialog, ev = S.evaluation;
  main.innerHTML = `<a href="#dialogs" class="back-link">← Все диалоги</a><div class="detail-heading"><div><h1>${esc(record.title || 'Карточка диалога')}</h1><div class="detail-meta"><span class="muted small mono">${esc(record.conversation_id)}</span><span class="badge">${channel(record.channel)}</span><span class="badge">${esc(record.language)}</span>${statusBadge({...record,evaluation_id:ev?.id,total:ev?.total})}</div></div><div class="detail-actions">${ev?`<a class="btn" href="#report/${encodeURIComponent(record.conversation_id)}">${icon('download')}Отчёт</a>`:''}<label><span class="sr-only">Чек-лист для оценки</span><select id="evaluation-checklist">${S.checklists.map(c=>`<option value="${esc(c.id)}" ${c.id===ev?.checklist_id?'selected':''}>${esc(c.name)} · v${esc(c.version)}</option>`).join('')}</select></label><button class="btn btn-primary" data-action="evaluate-dialog" ${S.busy || !S.checklists.length ? 'disabled' : ''}>${ev ? 'Оценить заново' : 'Оценить диалог'} ↗</button></div></div>
    <div class="split-view detail-top"><section class="panel"><div class="panel-heading"><h2>Транскрипт</h2><span class="muted small">${record.transcript.length} реплик</span></div>${record.channel==='voice call'?'<div class="audio-block" id="audio-block"><button class="btn btn-small" data-action="audio">Загрузить запись</button><p class="audio-caption">Запись загружается по свежей ссылке.</p></div>':''}<div class="quiet-line">Оценивается оператор. Бот и система дают контекст.</div><div class="transcript" id="transcript">${record.transcript.map((t,i)=>sourceTurn(t,i)).join('')}</div></section><section class="panel" id="evaluation-panel">${renderEvaluation(ev)}</section></div>`;
}
function renderEvaluation(ev) {
  if (!ev) return `<div class="panel-heading"><h2>Оценка качества</h2></div>${empty('Оценка ещё не выполнена', 'Выберите чек-лист и запустите оценку. Здесь появятся ответы, баллы и доказательства.')}`;
  const cl = checklistForEvaluation();
  const original = ev.original_total;
  return `<div class="panel-heading"><h2>Оценка качества</h2><span class="badge ${S.demo?'badge-amber':'badge-green'}">${S.demo?'Учебная оценка':esc(ev.model || 'AI-оценка')}</span></div><div class="result-overview"><div><div class="result-score">${num(ev.total)} <span>/ 100</span></div><div class="result-caption">${ev.total == null ? 'Нет применимых критериев' : 'Итоговый балл'}</div></div><div class="result-score-side"><span class="badge">Чек-лист v${esc(ev.checklist_version)}</span>${typeof original==='number'&&original!==ev.total?`<span class="small muted">Исходная оценка: <strong>${num(original)}</strong></span>`:'<span class="small muted">'+esc(ev.criteria.length)+' критериев</span>'}</div></div>${ev.gross_error?'<div class="notice error result-notice"><strong>Обнаружена грубая ошибка.</strong> Отметка рассматривается отдельно от итогового балла.</div>':''}${!cl?'<div class="notice result-notice">Исходная версия чек-листа недоступна. Правила другой версии не подставляются. Для пересмотра нужен исходный чек-лист.</div>':''}${ev.criteria.some(c=>c.needs_review)?'<div class="notice result-notice">Есть ответы, требующие проверки человеком. Проверьте обоснования перед использованием оценки.</div>':''}
    ${ev.sections?.length?`<div class="section-results">${ev.sections.map(s=>`<span class="section-result">${esc(s.name || cl?.sections?.find(x=>x.id===s.id)?.name || s.id)} <strong>${num(s.score)}</strong></span>`).join('')}</div>`:''}
    ${ev.criteria.map((item,i)=>renderCriterion(item,cl?.criteria?.find(c=>c.id===item.criterion_id),i)).join('')}`;
}
function renderCriterion(item, c, i) {
  const appeal = S.appeals.find(a=>a.evaluation_id===S.evaluation.id&&a.criterion_id===item.criterion_id&&a.status==='open');
  const decision = S.appeals.findLast(a=>a.evaluation_id===S.evaluation.id&&a.criterion_id===item.criterion_id&&a.decision);
  const answer = item.answer;
  const positive = c?.gross_error ? answer === 'no' : answer === 'yes' || typeof answer === 'number' && answer === c?.scale?.max;
  const answerClass = answer === 'na' ? '' : positive ? 'badge-green' : 'badge-amber';
  const range=item.checked_range;
  const validRange=range&&Number.isInteger(range.from)&&Number.isInteger(range.to)&&range.from>=0&&range.to>=range.from&&range.to<S.dialog.transcript.length;
  return `<article class="criterion" id="criterion-${esc(item.criterion_id)}"><div class="criterion-head"><div><span class="criterion-number">Критерий ${String(i+1).padStart(2,'0')}</span><h3>${esc(c?.title || item.criterion_id)}</h3></div><div class="criterion-badges"><span class="badge ${answerClass}">${esc(label(answer))}</span>${c?.gross_error ? '<span class="muted small">без баллов</span>' : `<span class="small mono">${answer==='na'?'не применяется':`${num(item.points ?? item.score)} / ${num(item.effective_weight ?? item.weight ?? c?.weight)}`}</span>`}</div></div><p>${esc(item.explanation || 'Обоснование не получено.')}</p>${item.na_reason?`<div class="notice small"><strong>Почему N/A:</strong> ${esc(item.na_reason)}</div>`:''}${item.needs_review?'<span class="badge badge-amber">Нужна проверка</span>':''}
    ${item.evidence?.length?`<details><summary>Цитаты из диалога</summary>${item.evidence.map(e=>`<blockquote>«${esc(e.quote)}»</blockquote>`).join('')}</details>`:''}
    <div class="criterion-foot"><div class="evidence-links">${(item.evidence || []).filter(e=>Number.isInteger(e.turn)&&e.turn>=0&&e.turn<S.dialog.transcript.length).map(e=>`<button class="evidence-link" data-turn="${esc(e.turn)}">Реплика ${Number(e.turn)+1} ↗</button>`).join('')}${validRange?`<button class="evidence-link" data-turn="${range.from}" data-range-end="${range.to}">Участок ${range.from+1}–${range.to+1} ↗</button>`:range?'<span class="badge badge-amber">Некорректный диапазон доказательства</span>':''}</div><button class="btn btn-small btn-ghost" data-appeal="${esc(item.criterion_id)}" ${appeal?'disabled':''}>${appeal?'Апелляция подана':'Оспорить'}</button></div>
    ${decision?`<div class="revision"><strong>Решение проверяющего: ${esc(label(decision.decision.answer))}</strong><br>${esc(decision.decision.reason)}${item.original_answer!==undefined?`<br><span class="muted">Исходный ответ: ${esc(label(item.original_answer))}</span>`:''}</div>`:''}${c?`<details><summary>Правило и вес критерия</summary><p>${esc(c.description)}</p><p>Вес: ${num(c.weight)}.${c.na_allowed?' N/A: '+esc(c.na_rule):' N/A не допускается.'}</p>${c.notes?`<p>${esc(c.notes)}</p>`:''}</details>`:''}</article>`;
}
async function highlightTurn(turn, end) {
  document.querySelectorAll('.turn.highlight').forEach(el=>el.classList.remove('highlight'));
  const first=Number(turn), last=end===undefined?first:Number(end);
  if (!Number.isInteger(first)||!Number.isInteger(last)||first<0||last>=S.dialog.transcript.length) return;
  for(let i=first;i<=last;i++) $(`#turn-${i}`)?.classList.add('highlight');
  const target=$(`#turn-${first}`);target?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});target?.focus({preventScroll:true});
  if (S.dialog.channel==='voice call') {
    await loadAudio();
    const offset = S.audio?.turn_offsets?.[first];
    if (typeof offset==='number' && Number.isFinite(offset) && $('#call-audio')) $('#call-audio').currentTime=Math.max(0,offset-3);
    else notify('Для этой реплики сервер не передал позицию в записи.');
  }
}
async function loadAudio() {
  if (S.audio && $('#call-audio')) return;
  const id = S.dialog.conversation_id;
  const area=$('#audio-block');
  if (!area) return;
  area.innerHTML='<p class="muted small" role="status">Получаем свежую ссылку на запись…</p>';
  try {
    const audio=await api.getAudio(id);
    if(S.dialog.conversation_id!==id || !$('#audio-block')) return;
    const url=validatedAudioUrl(audio);
    S.audio=audio;
    area.innerHTML=`<label class="small">${S.demo?'Учебный звуковой сигнал, не запись разговора':'Запись разговора'}</label><audio id="call-audio" controls preload="metadata" src="${esc(url)}"></audio><p class="audio-caption">Кнопка доказательства перематывает запись. Автовоспроизведение отключено.</p><button class="text-btn" data-action="refresh-audio">Обновить ссылку</button>`;
  } catch(e) { if($('#audio-block')) area.innerHTML=`<p class="danger small">${esc(errorText(e))}</p><button class="btn btn-small" data-action="audio">Повторить загрузку</button>`; }
}
function freshChecklist() { return {id:`checklist-${Date.now()}`,version:1,name:'Новый чек-лист',rounding:{digits:2},guidance:[],sections:[{id:'s1',name:'Общие критерии'}],criteria:[]}; }
function renderEditor() {
  const cl=S.editor, c=cl.criteria[S.criterionIndex];
  main.innerHTML=`<div class="page-heading"><div><h1>Чек-листы</h1><p>Критерии меняются здесь. Новая версия применяется при следующей оценке.</p></div><div class="actions"><button class="btn" data-action="new-checklist">Новый чек-лист</button><button class="btn btn-primary" data-action="save-checklist">Сохранить версию ↗</button></div></div><div class="editor-toolbar"><label>Конфигурация<select id="choose-checklist">${S.checklists.map(x=>`<option value="${esc(checklistKey(x))}" ${checklistKey(cl)===checklistKey(x)?'selected':''}>${esc(x.name)} · v${esc(x.version)}</option>`).join('')}${!S.checklists.some(x=>x.id===cl.id)?`<option selected value="">${esc(cl.name)}</option>`:''}</select></label><div class="weight-total">Сумма весов <strong id="weight-total">${num(cl.criteria.filter(x=>!x.gross_error).reduce((sum,x)=>sum+Number(x.weight),0))}</strong></div><span id="dirty-label" class="badge ${S.dirty?'badge-amber':''}">${S.dirty?'Есть изменения':'Сохранено'}</span></div><div class="editor-layout"><aside class="panel"><div class="panel-heading"><h2>Критерии</h2><span class="muted small">${cl.criteria.length}</span></div><div class="editor-list">${cl.criteria.map((x,i)=>`<button class="editor-item ${i===S.criterionIndex?'active':''}" data-criterion-index="${i}"><span class="editor-index">${String(i+1).padStart(2,'0')}</span><span><strong>${esc(x.title)}</strong><small>${x.gross_error?'Грубая ошибка':`Вес ${num(x.weight)} · ${x.answer_type==='scale'?'Шкала':'Да / Нет'}`}</small></span></button>`).join('')}</div><div class="panel-body"><button class="btn" data-action="add-criterion">＋ Добавить критерий</button></div></aside><section class="panel"><div class="panel-body"><label>Название чек-листа<input data-edit="name" value="${esc(cl.name)}" required maxlength="160"></label><hr>${c?`<div class="editor-title-row"><div><span class="muted small">${esc(c.id)}</span><h2>Настройка критерия</h2></div><button class="btn btn-small btn-ghost danger" data-action="remove-criterion">Удалить критерий</button></div><div class="field-grid"><label class="full">Название критерия<input data-criterion="title" value="${esc(c.title)}" required maxlength="200"></label><label class="full">Что считается выполнением<textarea data-criterion="description" required>${esc(c.description)}</textarea></label><label>Тип ответа<select data-criterion="answer_type"><option value="binary" ${c.answer_type==='binary'?'selected':''}>Да / Нет</option><option value="scale" ${c.answer_type==='scale'?'selected':''}>Числовая шкала</option></select></label><label>Вес критерия<input data-criterion="weight" type="number" min="0" max="100" step="0.1" value="${esc(c.weight)}" ${c.gross_error?'disabled':''}></label><label class="full">Раздел<select data-criterion="section_id">${cl.sections.map(s=>`<option value="${esc(s.id)}" ${s.id===c.section_id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>${c.answer_type==='scale'?`<label class="full">Ступени шкалы<textarea data-criterion="steps" rows="6" placeholder="0 | Нет ответа&#10;10 | Полный ответ">${esc((c.scale?.steps||[]).map(s=>`${s.value} | ${s.label}`).join('\n'))}</textarea><span class="muted small">Одна ступень на строку: число | описание. Максимум шкалы определяется по наибольшему числу.</span></label>`:''}<label class="full"><input data-criterion="gross_error" type="checkbox" ${c.gross_error?'checked':''}>Грубое нарушение: отдельный флаг без баллов</label><label class="full"><input data-criterion="na_allowed" type="checkbox" ${c.na_allowed?'checked':''}>Разрешить ответ N/A</label>${c.na_allowed?`<label class="full">Когда критерий неприменим<textarea data-criterion="na_rule" required>${esc(c.na_rule)}</textarea></label>`:''}<label class="full">Пояснения для оценки<textarea data-criterion="notes">${esc(c.notes)}</textarea></label></div>`:empty('Добавьте критерий','Укажите название, правило, вес и допустимый тип ответа.')}<div id="editor-errors" role="alert"></div></div></section></div>`;
}
function updateEditor(target) {
  if(target.dataset.edit) S.editor[target.dataset.edit]=target.value;
  const field=target.dataset.criterion,c=S.editor.criteria[S.criterionIndex];
  if(field&&c) {
    if(field==='steps') {
      c._stepsText=target.value;
      const steps=target.value.split('\n').filter(l=>l.trim()).map(l=>{const [value,...parts]=l.split('|');return {value:Number(value.trim()),label:parts.join('|').trim()};});
      c.scale={min:Math.min(...steps.map(x=>x.value)),max:Math.max(...steps.map(x=>x.value)),steps};
    } else c[field]=target.type==='checkbox'?target.checked:field==='weight'?Number(target.value):target.value;
    if(field==='gross_error'&&c.gross_error) {c.weight=0;c.answer_type='binary';c.scale=null;c.na_allowed=false;c.na_rule=null;}
    if(field==='answer_type') c.scale=target.value==='scale'?{min:0,max:10,steps:[{value:0,label:'Не выполнено'},{value:10,label:'Выполнено'}]}:null;
    if(field==='na_allowed'&&!c.na_allowed) c.na_rule=null;
  }
  S.dirty=true;
  if($('#dirty-label')) {$('#dirty-label').textContent='Есть изменения';$('#dirty-label').classList.add('badge-amber');}
  if($('#weight-total')) $('#weight-total').textContent=num(S.editor.criteria.filter(c=>!c.gross_error).reduce((sum,c)=>sum+Number(c.weight),0));
  if(['answer_type','gross_error','na_allowed'].includes(field)) renderEditor();
}
function validateChecklist(cl) {
  const errors=[];
  if(!cl.name.trim()) errors.push('Укажите название чек-листа.');
  if(!cl.criteria.length) errors.push('Добавьте хотя бы один критерий.');
  for(const c of cl.criteria) {
    if(!c.title.trim()||!c.description.trim()) errors.push(`${c.id}: нужны название и правило оценки.`);
    if(!Number.isFinite(c.weight)||c.weight<0||c.weight>100) errors.push(`${c.id}: вес должен быть от 0 до 100.`);
    if(c.na_allowed&&!c.na_rule?.trim()) errors.push(`${c.id}: укажите условие N/A.`);
    if(c.answer_type==='scale'&&(!c.scale?.steps?.length||!Number.isFinite(c.scale.max)||c.scale.max<=0||c.scale.steps.some(s=>!Number.isFinite(s.value)||s.value<0||!s.label)||new Set(c.scale.steps.map(s=>s.value)).size!==c.scale.steps.length)) errors.push(`${c.id}: проверьте ступени шкалы, числа не должны повторяться, максимум должен быть больше нуля.`);
  }
  return errors;
}
function previewChecklist() {
  const errors=validateChecklist(S.editor);
  if(errors.length) {$('#editor-errors').innerHTML=`<div class="notice error rule">${errors.map(esc).join('<br>')}</div>`;$('#editor-errors').scrollIntoView({block:'nearest'});return;}
  const payload=structuredClone(S.editor);payload.criteria.forEach(c=>delete c._stepsText);
  const result=compareChecklists(S.editorBase,payload);
  if(!result.changed) {notify('Изменений нет. Новая версия не требуется.');return;}
  S.pendingChecklist=payload;
  openModal('Проверить изменения',`<p class="modal-description">${S.editorBase?`Чек-лист «${esc(payload.name)}», исходная версия ${esc(S.editorBase.version)}.`:'Новый чек-лист.'} После сохранения изменения применятся к следующим оценкам. Выполненные оценки сохранят свою конфигурацию.</p>${renderChecklistDiff(result)}<form id="checklist-save-form"><div class="form-actions"><button type="button" class="btn" data-action="close-modal">Продолжить редактирование</button><button type="submit" class="btn btn-primary">Сохранить новую версию</button></div></form>`,'checklist-save-form');
  modal.classList.add('wide-modal');
}
async function saveChecklist(button) {
  if(!S.pendingChecklist||S.savingChecklist)return;
  S.savingChecklist=true;
  const submitted=structuredClone(S.pendingChecklist);
  modal.querySelectorAll('button').forEach(control=>{control.disabled=true;});
  busyButton(button,true);
  button.textContent='Сохранение…';
  try {
    const result=await api.saveChecklist(submitted);
    S.editor=structuredClone(result);S.editorBase=structuredClone(result);S.dirty=false;S.pendingChecklist=null;modal.close();
    await loadRoute();notify(`Сохранена версия ${result.version}. Повторная оценка использует новые правила.`);
  } catch(e) {notify(errorText(e),true);}
  finally{S.savingChecklist=false;modal.querySelectorAll('button').forEach(control=>{control.disabled=false;});busyButton(button,false);button.textContent='Сохранить новую версию';}
}
function renderReport() {
  const id=S.dialog.conversation_id;
  if(!S.evaluation){main.innerHTML=`<a href="#dialog/${encodeURIComponent(id)}" class="back-link">← К диалогу</a><section class="panel">${empty('Отчёт ещё не сформирован','Сначала выполните оценку диалога. Отчёт использует сохранённый результат и не вызывает модель.')}</section>`;return;}
  main.innerHTML=`<div class="print-toolbar"><a href="#dialog/${encodeURIComponent(id)}" class="btn">← К диалогу</a><p>Печать использует сохранённую оценку. В окне печати выберите «Сохранить как PDF».</p><button class="btn btn-primary" data-action="print-report">${icon('download')}Печать / PDF</button></div>${buildReport({dialog:S.dialog,evaluation:S.evaluation,checklist:checklistForEvaluation(),appeals:S.appeals,demo:S.demo})}`;
}
function sourceTurn(turn,index,prefix='turn',highlighted=false) {
  return `<article id="${esc(prefix)}-${index}" class="turn turn-${esc(Object.hasOwn(roles,turn.speaker)?turn.speaker:'system')} ${highlighted?'highlight':''}" tabindex="-1"><div class="turn-meta"><strong>${esc(roles[turn.speaker] || turn.speaker)}</strong><span>№ ${index+1} · ${esc(turn.timestamp)}</span></div><p>${esc(turn.text)}</p></article>`;
}
function validatedAudioUrl(audio) {
  const url=audio?.url || audio?.audio_url;
  if(typeof url!=='string'||!url.trim())throw new Error('Сервер не передал ссылку на запись.');
  let parsed;try{parsed=new URL(url,location.href);}catch{throw new Error('Сервер вернул некорректную ссылку на запись.');}
  if(!['http:','https:','blob:'].includes(parsed.protocol)&&!(S.demo&&parsed.protocol==='data:'&&url.startsWith('data:audio/')))throw new Error('Сервер вернул недопустимую ссылку на запись.');
  return url;
}
function renderAppeals() {
  const visible=S.appeals.filter(a=>S.appealFilter==='all'||a.status==='open');
  main.innerHTML=`<div class="page-heading"><div><h1>Апелляции</h1><p>Проверьте доказательства и сохраните обоснованное решение.</p></div><button class="btn" data-action="retry">Обновить список</button></div><div class="view-tabs"><button class="btn ${S.appealFilter==='open'?'btn-dark':''}" data-appeal-filter="open">Открытые · ${S.appeals.filter(a=>a.status==='open').length}</button><button class="btn ${S.appealFilter==='all'?'btn-dark':''}" data-appeal-filter="all">Все обращения · ${S.appeals.length}</button></div><section class="panel">${visible.length?visible.map(a=>`<article class="appeal-card" id="appeal-${esc(a.id)}"><div><div class="actions"><span class="badge ${a.status==='open'?'badge-amber':'badge-green'}">${esc(label(a.status))}</span><span class="muted small">${esc(a.conversation_id || a.evaluation_id)} · ${esc(a.criterion_id)}</span></div><h3>${esc(a.criterion_title || 'Пересмотр критерия')}</h3><p>${esc(a.comment)}</p>${a.decision?`<div class="revision"><strong>Ответ: ${esc(label(a.decision.answer))}</strong><br>${esc(a.decision.reason)}</div>`:''}</div><div class="actions"><button class="btn btn-small" data-context="${esc(a.id)}">Открыть диалог ↗</button>${a.status==='open'?`<button class="btn btn-small btn-primary" data-review="${esc(a.id)}">Рассмотреть</button>`:''}</div><div class="review-form" id="review-${esc(a.id)}" hidden></div></article>`).join(''):empty(S.appealFilter==='open'?'Нет открытых апелляций':'Апелляций пока нет','Чтобы оспорить оценку, откройте диалог и нажмите «Оспорить» у нужного критерия.','<a class="btn" href="#dialogs">Перейти к диалогам</a>')}</section>`;
}
async function showReview(id) {
  const appeal=S.appeals.find(a=>a.id===id);
  const area=document.getElementById(`review-${id}`);
  if(!appeal||!area)return;
  area.hidden=false;area.innerHTML='<p class="muted">Загрузка оценки и фрагмента диалога…</p>';
  try {
    const ev=await api.getEvaluation(appeal.evaluation_id);
    const record=await api.getDialog(ev.conversation_id);
    if(!area.isConnected)return;
    const cl=evaluationChecklist(ev,S.checklists);
    const criterion=cl?.criteria.find(c=>c.id===appeal.criterion_id),item=ev.criteria.find(c=>c.criterion_id===appeal.criterion_id);
    if(!criterion||!item)throw new Error('Не удалось получить исходный критерий этой оценки. Решение не сохранено.');
    const excerpt=reviewExcerpt(record,item);
    const draft=S.reviewDrafts.get(id),changing=draft?.status==='changed',choices=answerOptions(criterion);
    const selected=changing&&choices.map(String).includes(String(draft?.answer))?draft.answer:item.answer;
    S.reviewContexts.set(id,{record,item,excerpt});
    area.innerHTML=`<form data-decision="${esc(id)}" class="review-layout"><section class="review-evidence"><h3>Основание спорной оценки</h3><div class="notice"><strong>${esc(criterion.title)}</strong><br>Текущий ответ: ${esc(label(item.answer))}. ${esc(item.explanation)}</div><p class="small muted">${esc(criterion.description)}</p>${item.na_reason?`<p class="small"><strong>Причина N/A:</strong> ${esc(item.na_reason)}</p>`:''}${item.needs_review?'<span class="badge badge-amber">Требуется проверка человеком</span>':''}<h3>Фрагмент диалога</h3><p class="small muted">Выделены реплики основания. Соседние сообщения показаны для контекста.</p>${excerpt.invalidEvidence?'<div class="notice error">В оценке есть некорректная ссылка на реплику. Проверьте полный диалог.</div>':''}${excerpt.turns.length?`<div class="review-transcript">${excerpt.turns.map(t=>sourceTurn(t,t.index,`appeal-${id}-turn`,t.highlighted)).join('')}</div>`:'<div class="notice">Оценка не содержит корректной ссылки на реплику или проверенный участок. Откройте полный диалог перед решением.</div>'}${record.channel==='voice call'?`<div id="review-audio-${esc(id)}" class="review-audio"><button type="button" class="btn btn-small" data-review-audio="${esc(id)}">Прослушать фрагмент</button></div>`:''}<button class="text-btn" type="button" data-context="${esc(id)}">Открыть полный диалог ↗</button></section><div class="review-decision"><h3>Решение проверяющего</h3><fieldset><legend>Действие</legend><div class="radio-row"><label><input type="radio" name="decision-status" value="confirmed" ${!changing?'checked':''}>Подтвердить оценку</label><label><input type="radio" name="decision-status" value="changed" ${changing?'checked':''}>Изменить оценку</label></div></fieldset><label>Ответ по критерию<select name="answer" data-original="${esc(item.answer)}" ${changing?'':'disabled'}>${choices.map(v=>`<option value="${esc(v)}" ${String(v)===String(selected)?'selected':''}>${esc(label(v))}</option>`).join('')}</select></label><label>Причина решения<textarea name="reason" required maxlength="4000" placeholder="Объясните, что подтверждает решение">${esc(draft?.reason || '')}</textarea></label><div class="actions"><button class="btn btn-primary" type="submit">Сохранить решение</button><button class="btn" type="button" data-cancel-review="${esc(id)}">Отмена</button></div></div></form>`;
  } catch(e) {if(area.isConnected)area.innerHTML=`<p class="danger">${esc(errorText(e))}</p><button class="btn btn-small" data-review="${esc(id)}">Повторить загрузку</button>`;}
}
async function loadReviewAudio(id) {
  const context=S.reviewContexts.get(id),area=document.getElementById(`review-audio-${id}`);
  if(!context||!area)return;
  area.innerHTML='<p class="muted small" role="status">Получаем свежую ссылку на запись…</p>';
  try {
    const audio=await api.getAudio(context.record.conversation_id),url=validatedAudioUrl(audio);
    if(!area.isConnected)return;
    area.innerHTML=`<label class="small">${S.demo?'Учебный звуковой сигнал, не запись разговора':'Запись спорного диалога'}</label><audio controls preload="metadata" src="${esc(url)}"></audio><p class="small muted">Позиция соответствует основанию оценки, с отступом на 3 секунды. Автовоспроизведение отключено.</p><button type="button" class="text-btn" data-review-audio="${esc(id)}">Обновить запись</button>`;
    const player=$('audio',area),offset=audio.turn_offsets?.[context.excerpt.firstTurn];
    if(Number.isFinite(offset)&&offset>=0){const seek=()=>{player.currentTime=Math.max(0,offset-3);};if(player.readyState>=1)seek();else player.addEventListener('loadedmetadata',seek,{once:true});}
    else $('p',area).textContent='Сервер не передал позицию фрагмента. Запись доступна целиком, без автовоспроизведения.';
  } catch(e) {if(area.isConnected)area.innerHTML=`<p class="danger small">${esc(errorText(e))}</p><button type="button" class="btn btn-small" data-review-audio="${esc(id)}">Повторить загрузку</button>`;}
}
function captureReviewDraft(form) {
  if(!form?.dataset.decision)return;
  S.reviewDrafts.set(form.dataset.decision,{reason:$('[name=reason]',form)?.value || '',answer:$('[name=answer]',form)?.value,status:$('[name=decision-status]:checked',form)?.value || 'confirmed'});
}
function answerOptions(c) {return [...(c.answer_type==='scale'?c.scale.steps.map(s=>s.value):['yes','no']),...(c.na_allowed?['na']:[])];}
function showAppeal(criterionId) {
  const criterion=checklistForEvaluation()?.criteria.find(c=>c.id===criterionId);
  openModal('Оспорить оценку',`<p class="modal-description">${esc(criterion?.title || criterionId)}. Проверяющий увидит комментарий вместе с оценкой и фрагментом диалога.</p><form id="appeal-form" data-criterion-id="${esc(criterionId)}" class="form-stack"><label>Почему вы не согласны<textarea name="comment" required maxlength="4000" placeholder="Укажите, какой фрагмент стоит проверить" rows="4"></textarea></label><div class="form-actions"><button type="button" class="btn" data-action="close-modal">Отмена</button><button type="submit" class="btn btn-primary">Подать апелляцию</button></div></form>`,'appeal-form');
}
function showSettings() {
  if(S.busy) return notify('Дождитесь завершения оценки перед сменой источника данных.');
  openModal('Подключение к данным',`<p class="modal-description">Укажите адрес сервера вашей команды. Ключи AI и ссылка организаторов остаются на сервере.</p><form id="settings-form" class="form-stack"><fieldset><legend>Источник данных</legend><div class="form-stack"><label><input type="radio" name="mode" value="api" ${!S.demo?'checked':''}> Сервер команды</label><label><input type="radio" name="mode" value="demo" ${S.demo?'checked':''}> Учебный пример без AI</label></div></fieldset><label>Базовый адрес API<input name="baseUrl" value="${esc(S.baseUrl)}" placeholder="http://127.0.0.1:8000/api"></label><p class="muted small">Для сервера на том же адресе используйте /api. Учебные изменения сохраняются только в этом браузере.</p><div class="form-actions"><button class="btn" type="button" data-action="close-modal">Отмена</button><button class="btn btn-primary" type="submit">Подключиться</button></div></form>`,'settings-form');
}
function showImport() {
  openModal('Импорт набора',`<p class="modal-description">Сервер получит диалоги по group_id. Для контрольного набора введите значение от организаторов.</p><form id="import-form" class="form-stack"><label>Группа набора<input name="groupId" required maxlength="100" value="DEV" autocomplete="off"></label>${S.demo?'<div class="notice">Учебный режим не загружает набор организаторов. Для импорта подключите сервер команды.</div>':''}<div class="form-actions"><button class="btn" type="button" data-action="close-modal">Отмена</button><button class="btn btn-primary" type="submit">${S.demo?'Проверить учебный запрос':'Импортировать набор'}</button></div></form>`,'import-form');
}
function showEvaluate(ids, selectedChecklist) {
  if(S.busy) return notify('Предыдущее задание ещё выполняется. Дождитесь результата.');
  if(!ids.length) return notify('Сначала выберите диалог.',true);
  if(!S.checklists.length) return notify('Сначала создайте чек-лист.',true);
  openModal('Запустить оценку',`<p class="modal-description">Диалогов: ${ids.length}. Оценка пройдёт в фоне, прогресс появится над рабочим экраном.</p><form id="evaluate-form" class="form-stack"><label>Чек-лист<select name="checklistId">${S.checklists.map(c=>`<option value="${esc(c.id)}" ${c.id===selectedChecklist?'selected':''}>${esc(c.name)} · v${esc(c.version)}</option>`).join('')}</select></label><label><input name="confirm" type="checkbox" required>${S.demo?'Понимаю, что это учебная оценка без AI':'Подтверждаю запуск AI-оценки. Если сервер использует платный API, возможны расходы'}</label><div class="form-actions"><button type="button" class="btn" data-action="close-modal">Отмена</button><button type="submit" class="btn btn-primary">Оценить ${ids.length === 1?'диалог':'диалоги'}</button></div></form>`,'evaluate-form');
  $('#evaluate-form')._ids=ids;
}
async function pollJob(id) {
  if(polling) return;
  polling=true;S.busy=true;rememberJob(id);$('#job-banner').hidden=false;
  let failureCount=0;
  for(let i=0;i<300;i++) {
    try {
      const job=await api.getJob(id);failureCount=0;
      const total=Number(job.total)||1,completed=Number(job.completed)||0;
      $('#job-banner').innerHTML=`<strong>Оценка диалогов</strong> · ${completed} из ${total}<progress aria-label="Прогресс оценки" max="${total}" value="${completed}"></progress>`;
      if(['completed','done','finished','succeeded'].includes(job.status)) {polling=false;S.busy=false;rememberJob(null);$('#job-banner').hidden=true;S.selected.clear();await loadRoute();notify('Оценка завершена. Результаты обновлены.');return;}
      if(['failed','error','cancelled'].includes(job.status)) {polling=false;S.busy=false;rememberJob(null);$('#job-banner').innerHTML='<span class="danger">Оценка завершилась с ошибкой. Обновите диалоги и проверьте сервер.</span> <button class="text-btn" data-action="retry">Обновить диалоги</button>';await loadRoute();return;}
    } catch(e) {failureCount++;if(failureCount>=3){polling=false;S.busy=false;$('#job-banner').innerHTML=`<span class="danger">Не удалось получить результат задания. ${esc(errorText(e))}</span> <button class="text-btn" data-resume-job="${esc(id)}">Проверить ещё раз</button>`;return;}}
    await new Promise(resolve=>setTimeout(resolve,S.demo?450:1500));
  }
  polling=false;S.busy=false;$('#job-banner').innerHTML=`Задание ещё выполняется. <button class="text-btn" data-resume-job="${esc(id)}">Проверить прогресс</button>`;
}
document.addEventListener('click',async event=>{
  if(event.target.closest('.skip-link')){event.preventDefault();main.focus();return;}
  const el=event.target.closest('button, a[data-nav]');if(!el)return;
  try {
    if(el.dataset.open) location.hash=`dialog/${encodeURIComponent(el.dataset.open)}`;
    else if(el.dataset.turn!==undefined) await highlightTurn(el.dataset.turn,el.dataset.rangeEnd);
    else if(el.dataset.appeal) showAppeal(el.dataset.appeal);
    else if(el.dataset.criterionIndex!==undefined){S.criterionIndex=Number(el.dataset.criterionIndex);renderEditor();}
    else if(el.dataset.appealFilter){S.appealFilter=el.dataset.appealFilter;renderAppeals();}
    else if(el.dataset.review) await showReview(el.dataset.review);
    else if(el.dataset.reviewAudio) await loadReviewAudio(el.dataset.reviewAudio);
    else if(el.dataset.queue){S.queue=el.dataset.queue;renderDialogs();}
    else if(el.dataset.cancelReview){S.reviewDrafts.delete(el.dataset.cancelReview);document.getElementById(`review-${el.dataset.cancelReview}`).hidden=true;}
    else if(el.dataset.context){const a=S.appeals.find(a=>a.id===el.dataset.context);const ev=await api.getEvaluation(a.evaluation_id);location.hash=`dialog/${encodeURIComponent(ev.conversation_id)}`;}
    else if(el.dataset.resumeJob) pollJob(el.dataset.resumeJob);
    else switch(el.dataset.action){
      case 'close-modal':if(!S.savingChecklist)modal.close();break;
      case 'settings':showSettings();break;
      case 'retry':await loadRoute();break;
      case 'demo':S.demo=true;S.selected.clear();connect();await loadRoute();break;
      case 'import':showImport();break;
      case 'upload':$('#upload-file').click();break;
      case 'audio':await loadAudio();break;
      case 'refresh-audio':S.audio=null;await loadAudio();break;
      case 'reset-filters':S.queue='all';S.filters={query:'',channel:'',language:'',status:''};renderDialogs();break;
      case 'evaluate-selected':showEvaluate([...S.selected]);break;
      case 'evaluate-dialog':showEvaluate([S.dialog.conversation_id],$('#evaluation-checklist').value);break;
      case 'save-checklist':previewChecklist();break;
      case 'print-report':window.print();break;
      case 'new-checklist':if(S.dirty&&!confirm('Отменить несохранённые изменения чек-листа?'))break;S.editor=freshChecklist();S.editorBase=null;S.dirty=true;S.criterionIndex=0;renderEditor();break;
      case 'add-criterion':{const ids=new Set(S.editor.criteria.map(c=>c.id));let i=S.editor.criteria.length+1;while(ids.has(`c${String(i).padStart(2,'0')}`))i++;S.editor.criteria.push({id:`c${String(i).padStart(2,'0')}`,section_id:S.editor.sections[0]?.id||'s1',title:'Новый критерий',description:'',answer_type:'binary',scale:null,weight:10,na_allowed:false,na_rule:null,notes:null,gross_error:false});S.criterionIndex=S.editor.criteria.length-1;S.dirty=true;renderEditor();break;}
      case 'remove-criterion':if(!confirm('Удалить критерий из этой версии? Сохранённые оценки останутся прежними.'))break;S.editor.criteria.splice(S.criterionIndex,1);S.criterionIndex=Math.max(0,S.criterionIndex-1);S.dirty=true;renderEditor();break;
    }
  }catch(e){notify(errorText(e),true);}
});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.form?.dataset.decision)captureReviewDraft(el.form);
  if(el.id==='search-dialogs'){S.filters.query=el.value;renderRows();}
  if(el.dataset.edit||el.dataset.criterion) updateEditor(el);
});
document.addEventListener('change',async event=>{
  const el=event.target;
  if(el.id==='summary-scope'){S.summaryScope=el.value;renderSummary(visibleRows());}
  if(el.dataset.filter){S.filters[el.dataset.filter]=el.value;renderRows();}
  if(el.dataset.select){el.checked?S.selected.add(el.dataset.select):S.selected.delete(el.dataset.select);renderRows();}
  if(el.id==='select-all'){visibleRows().forEach(r=>el.checked?S.selected.add(r.conversation_id):S.selected.delete(r.conversation_id));renderRows();}
  if(el.id==='choose-checklist'){if(S.dirty&&!confirm('Отменить несохранённые изменения?')){el.value=checklistKey(S.editor);return;}S.editor=structuredClone(findChecklist(el.value));S.editorBase=structuredClone(S.editor);S.dirty=false;S.criterionIndex=0;renderEditor();}
  if(el.name==='decision-status'){const select=$('select[name=answer]',el.form);select.disabled=el.value==='confirmed';if(select.disabled)select.value=select.dataset.original;captureReviewDraft(el.form);}
  if(el.name==='answer'&&el.form?.dataset.decision)captureReviewDraft(el.form);
  if(el.id==='upload-file'&&el.files[0]) {
    const file=el.files[0];
    try{if(file.size>5*1024*1024)throw new Error('Файл больше 5 МБ. Загрузите меньший JSON.');JSON.parse(await file.text());await api.uploadDialog(file);S.selected.clear();location.hash='dialogs';await loadRoute();notify('Транскрипт загружен.');}catch(e){notify(e instanceof SyntaxError?'Файл должен содержать корректный JSON.':errorText(e),true);}finally{el.value='';}
  }
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!form.matches('#settings-form,#import-form,#appeal-form,#evaluate-form,#checklist-save-form,[data-decision]'))return;
  event.preventDefault();const button=$('button[type=submit]',form);busyButton(button,true);const values=new FormData(form);
  try{
    if(form.id==='checklist-save-form'){await saveChecklist(button);
    }else if(form.id==='settings-form') {
      const base=String(values.get('baseUrl')).trim();let parsed;
      try{parsed=new URL(base,location.origin);}catch{throw new Error('Укажите корректный адрес API.');}
      if(!base||base.startsWith('//')||!['http:','https:'].includes(parsed.protocol)||parsed.search||parsed.hash||parsed.username||parsed.password)throw new Error('Используйте адрес API без ключей, параметров и пароля.');
      S.baseUrl=base.replace(/\/$/,'');S.demo=values.get('mode')==='demo';
      try{localStorage.setItem('cqa-connection',JSON.stringify({baseUrl:S.baseUrl,demo:S.demo}));}catch{notify('Браузер не разрешил сохранить настройки.');}
      const url=new URL(location.href);url.searchParams.delete('demo');history.replaceState(null,'',url);
      S.editor=null;S.dirty=false;S.reviewDrafts.clear();S.selected.clear();connect();modal.close();await loadRoute();
    }else if(form.id==='import-form'){
      const group=String(values.get('groupId')).trim();if(!group)throw new Error('Укажите group_id набора.');
      const imported=await api.importDialogs(group);modal.close();location.hash='dialogs';await loadRoute();notify(S.demo?(imported.message || 'Учебный режим не загружает набор организаторов.'):'Набор импортирован.');
    }else if(form.id==='appeal-form'){
      const comment=String(values.get('comment')).trim();if(!comment)throw new Error('Добавьте причину апелляции.');
      await api.createAppeal({evaluation_id:S.evaluation.id,criterion_id:form.dataset.criterionId,comment});modal.close();await loadRoute();notify('Апелляция сохранена. Она доступна в очереди проверяющего.');
    }else if(form.id==='evaluate-form'){
      if(S.busy)throw new Error('Предыдущее задание ещё выполняется.');
      S.busy=true;
      try{const job=await api.evaluate(form._ids,String(values.get('checklistId')));if(!job.id)throw new Error('Сервер не вернул номер задания.');modal.close();document.querySelectorAll('[data-action="evaluate-dialog"],[data-action="evaluate-selected"]').forEach(b=>{b.disabled=true;});pollJob(job.id);}catch(e){S.busy=false;throw e;}
    }else if(form.dataset.decision){
      const select=$('select[name=answer]',form),raw=select.value,answer=['yes','no','na'].includes(raw)?raw:Number(raw),reason=String(values.get('reason')).trim();if(!reason)throw new Error('Укажите причину решения.');
      await api.decideAppeal(form.dataset.decision,{answer,reason,status:values.get('decision-status')});S.reviewDrafts.delete(form.dataset.decision);await loadRoute();notify('Решение сохранено. Итог пересчитан.');
    }
  }catch(e){notify(errorText(e),true);}finally{busyButton(button,false);}
});
window.addEventListener('hashchange',async()=>{window.scrollTo({top:0});await loadRoute();main.focus({preventScroll:true});});
modal.addEventListener('cancel',event=>{if(S.savingChecklist)event.preventDefault();});
window.addEventListener('beforeunload',event=>{if(S.dirty||[...S.reviewDrafts.values()].some(d=>d.reason.trim()||d.status==='changed')){event.preventDefault();event.returnValue='';}});
try{connect();loadRoute();let active;try{active=JSON.parse(sessionStorage.getItem('cqa-active-job')||'null');}catch{/* Ignore malformed browser state. */}if(active?.id&&active.baseUrl===S.baseUrl&&active.demo===S.demo)pollJob(active.id);}catch(e){showError(e);}
