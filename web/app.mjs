import { createApi } from './api.mjs';
import { icon, hydrateIcons } from './icons.mjs';
import { renderEvaluationView } from './result-view.mjs';
import { renderScalePreview } from './forms-preview.mjs';

hydrateIcons();

const $ = (s, root = document) => root.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
const S = { demo:new URLSearchParams(location.search).get('demo') === '1' || (saved.demo ?? config.demo ?? false), baseUrl:saved.baseUrl ?? config.apiBase ?? '/api', rows:[], checklists:[], appeals:[], selected:new Set(), filters:{query:'', language:'', channel:'', status:''}, dialog:null, evaluation:null, audio:null, editor:null, criterionIndex:0, dirty:false, busy:false, appealFilter:'open' };
let api;
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
  $('#mode-label').textContent = S.demo ? 'Учебный пример' : 'API команды';
  $('#connection-label').textContent = S.demo ? 'Учебный пример' : 'Настройки подключения';
}
function section() { return (location.hash.slice(1).split('/')[0] || 'dialogs'); }
function route() { return location.hash.slice(1).split('/'); }
function checklistKey(c) { return `${c.id}@${c.version}`; }
function findChecklist(key) { return S.checklists.find(c => checklistKey(c) === key) || S.checklists.find(c => c.id === key) || S.checklists[0]; }
function checklistForEvaluation() { return S.evaluation?.checklist || S.checklists.find(c => c.id === S.evaluation?.checklist_id && c.version === S.evaluation?.checklist_version) || findChecklist(S.evaluation?.checklist_id); }
function nameForRow(row) { return row.title || row.subject || row.transcript?.find(t => t.speaker === 'client')?.text || 'Диалог поддержки'; }
function rowStatus(row) { return row.status || (row.evaluation_id ? 'completed' : 'pending'); }
function statusBadge(row) {
  const status = rowStatus(row);
  return `<span class="badge ${['completed','done','evaluated'].includes(status) ? 'badge-green' : status === 'failed' ? 'badge-red' : ''}"><span class="mini-dot" aria-hidden="true"></span>${esc(label(status))}</span>`;
}
function openModal(title, contents, formId) {
  $('#modal-content').innerHTML = `<div class="modal-heading"><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="Закрыть окно">${icon('close')}</button></div>${contents}`;
  if (!modal.open) modal.showModal();
  setTimeout(() => $(`#${formId} input, #${formId} textarea, #${formId} select`)?.focus(), 0);
}
function skeleton() { main.innerHTML = `<div class="panel loading" aria-label="Загрузка" aria-busy="true"><div class="skeleton wide"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton wide"></div></div>`; }
function empty(title, text, actions = '') { return `<div class="empty-state"><div class="empty-symbol" aria-hidden="true">${icon('dialogs')}</div><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions">${actions}</div></div>`; }
function showError(e) {
  main.innerHTML = `<div class="page-heading"><div><h1>Нет подключения к данным</h1><p>Интерфейс работает, но сервер пока не ответил.</p></div></div><section class="panel">${empty('Не удалось получить данные', errorText(e), '<button class="btn btn-primary" data-action="retry">Повторить</button><button class="btn" data-action="settings">Настроить API</button><button class="btn btn-ghost" data-action="demo">Открыть учебный пример</button>')}</section>`;
}
async function loadRoute() {
  const revision = ++routeRevision;
  const [page, id] = route();
  document.querySelectorAll('[data-nav]').forEach(a => a.setAttribute('aria-current', a.dataset.nav === (page === 'dialog' ? 'dialogs' : page || 'dialogs') ? 'page' : 'false'));
  $('#breadcrumb').textContent = ({dialogs:'Диалоги',dialog:'Карточка диалога',checklists:'Чек-листы',appeals:'Апелляции'}[page] || 'Диалоги');
  document.title = `CQA · ${$('#breadcrumb').textContent}`;
  skeleton();
  try {
    const [rows, checklists, appeals] = await Promise.all([api.listDialogs(), api.listChecklists(), api.listAppeals()]);
    if (revision !== routeRevision) return;
    S.rows = rows; S.checklists = checklists; S.appeals = appeals;
    $('#dialog-count').textContent = rows.length;
    $('#appeal-count').textContent = appeals.filter(a => a.status === 'open').length || '';
    if (page === 'dialog' && id) {
      const record = await api.getDialog(decodeURIComponent(id));
      const evaluationId = record.evaluation_id || rows.find(r => r.conversation_id === record.conversation_id)?.evaluation_id;
      const evaluation = evaluationId ? await api.getEvaluation(evaluationId) : null;
      if (revision !== routeRevision) return;
      S.dialog = record; S.evaluation = evaluation; S.audio = null;
      renderDialog();
    } else if (page === 'checklists') {
      if (!S.dirty || !S.editor) { S.editor = structuredClone(checklists.find(c=>c.id===S.editor?.id) || checklists[0] || freshChecklist()); S.criterionIndex = Math.min(S.criterionIndex,Math.max(0,S.editor.criteria.length-1)); }
      renderEditor();
    } else if (page === 'appeals') renderAppeals();
    else renderDialogs();
  } catch (e) { if (revision === routeRevision) showError(e); }
}
function renderDialogs() {
  const completed = S.rows.filter(r => typeof r.total === 'number');
  const average = completed.length ? completed.reduce((sum, r) => sum + r.total, 0) / completed.length : null;
  main.innerHTML = `<div class="page-heading"><div><div class="eyebrow">КАЧЕСТВО КЛИЕНТСКОГО СЕРВИСА</div><h1>Диалоги</h1><p>Оценки, доказательства и решения — в одном рабочем пространстве.</p></div><div class="actions"><button class="btn" data-action="import">${icon('download')}Импорт набора</button><button class="btn" data-action="upload">${icon('upload')}Загрузить JSON</button></div></div>
    <section class="stats-strip" aria-label="Сводка по диалогам"><div class="stat"><span class="stat-label">Всего диалогов</span><span class="stat-icon">${icon('dialogs')}</span><span class="stat-value">${S.rows.length}</span></div><div class="stat"><span class="stat-label">С оценкой</span><span class="stat-icon">${icon('circleCheck')}</span><span class="stat-value green">${completed.length}</span></div><div class="stat"><span class="stat-label">Средний балл</span><span class="stat-icon">${icon('chart')}</span><span class="stat-value">${num(average)}</span></div><div class="stat"><span class="stat-label">Грубые ошибки</span><span class="stat-icon">${icon('alert')}</span><span class="stat-value ${S.rows.some(r=>r.gross_error) ? 'red' : ''}">${S.rows.filter(r => r.gross_error).length}</span></div></section>
    <section class="panel"><div class="panel-heading"><h2>Все разговоры <span class="muted small">/ ${S.rows.length}</span></h2><button id="evaluate-selected" class="btn btn-primary" data-action="evaluate-selected" disabled>Оценить выбранные <span aria-hidden="true">↗</span></button></div>
    <div class="filters"><label class="search-field"><span aria-hidden="true">${icon('search')}</span><span class="sr-only">Поиск диалога</span><input id="search-dialogs" type="search" placeholder="Найти по ID или содержимому" value="${esc(S.filters.query)}"></label><label><span class="sr-only">Канал</span><select data-filter="channel"><option value="">Все каналы</option value="agent chat">Чаты</option><option value="voice call">Звонки</option></select></label><label><span class="sr-only">Язык</span><select data-filter="language"><option value="">Все языки</option value="RU">Русский</option><option value="KZ">Қазақша</option><option value="EN">English</option></select></label><label><span class="sr-only">Статус оценки</span><select data-filter="status"><option value="">Все статусы</option value="completed">С оценкой</option><option value="pending">Без оценки</option><option value="gross">Грубая ошибка</option></select></label></div>
    <div class="table-scroll"><table><thead><tr><th><input id="select-all" type="checkbox" aria-label="Выбрать все видимые диалоги"></th><th>Диалог</th><th>Канал</th><th>Язык</th><th>Статус</th><th>Балл</th><th><span class="sr-only">Открыть</span></th></tr></thead><tbody id="dialog-rows"></tbody></table></div><div id="list-empty" hidden></div><div class="table-foot"><span id="visible-count"></span><span>Оценка по выбранному чек-листу</span></div></section>`;
  document.querySelectorAll('[data-filter]').forEach(el => { el.value = S.filters[el.dataset.filter]; });
  renderRows();
}
function visibleRows() {
  const f = S.filters;
  return S.rows.filter(r => (!f.language || r.language === f.language) && (!f.channel || r.channel === f.channel) && (!f.query || `${r.conversation_id} ${nameForRow(r)} ${(r.transcript || []).map(t => t.text).join(' ')}`.toLocaleLowerCase().includes(f.query.toLocaleLowerCase())) && (!f.status || (f.status === 'gross' ? r.gross_error : f.status === 'completed' ? typeof r.total === 'number' : !r.evaluation_id)));
}
function renderRows() {
  const rows = visibleRows();
  $('#dialog-rows').innerHTML = rows.map(r => `<tr class="${S.selected.has(r.conversation_id) ? 'selected' : ''}"><td><input type="checkbox" data-select="${esc(r.conversation_id)}" aria-label="Выбрать ${esc(r.conversation_id)}" ${S.selected.has(r.conversation_id) ? 'checked' : ''}></td><td><button class="dialog-title" data-open="${esc(r.conversation_id)}">${esc(nameForRow(r))}</button><span class="dialog-subtitle">${esc(r.conversation_id)}</span></td><td><span class="channel-icon" aria-hidden="true">${icon(r.channel === 'voice call' ? 'phone' : 'dialogs')}</span>${channel(r.channel)}</td><td><span class="badge">${esc(r.language)}</span></td><td>${statusBadge(r)} ${r.gross_error ? '<span class="badge badge-red" title="Грубая ошибка">!</span>' : ''}</td><td class="score-cell">${num(r.total)} ${typeof r.total === 'number' ? '<span>/ 100</span>' : ''}</td><td><button class="icon-btn" data-open="${esc(r.conversation_id)}" aria-label="Открыть ${esc(r.conversation_id)}">${icon('chevron')}</button></td></tr>`).join('');
  $('#list-empty').hidden = rows.length > 0;
  $('#list-empty').innerHTML = S.rows.length ? empty('Ничего не найдено', 'Измените запрос или сбросьте фильтры.', '<button class="btn" data-action="reset-filters">Сбросить фильтры</button>') : empty('Добавьте первый диалог', 'Импортируйте набор по group_id или загрузите транскрипт в JSON.', '<button class="btn btn-primary" data-action="import">Импорт набора</button>');
  $('#visible-count').textContent = `Показано ${rows.length} из ${S.rows.length}`;
  $('#select-all').checked = rows.length > 0 && rows.every(r => S.selected.has(r.conversation_id));
  $('#select-all').indeterminate = rows.some(r => S.selected.has(r.conversation_id)) && !$('#select-all').checked;
  $('#evaluate-selected').disabled = !S.selected.size || S.busy;
  $('#evaluate-selected').textContent = S.selected.size ? `Оценить выбранные (${S.selected.size}) ↗` : 'Оценить выбранные ↗';
}
function renderDialog() {
  const record = S.dialog, ev = S.evaluation;
  main.innerHTML = `<a href="#dialogs" class="back-link">${icon('arrow-left')} Все диалоги</a><div class="detail-heading"><div><h1>${esc(record.title || 'Карточка диалога')}</h1><div class="detail-meta"><span class="muted small mono">${esc(record.conversation_id)}</span><span class="badge">${channel(record.channel)}</span><span class="badge">${esc(record.language)}</span>${statusBadge({...record,evaluation_id:ev?.id,total:ev?.total})}</div></div><div class="detail-actions"><label><span class="sr-only">Чек-лист для оценки</span><select id="evaluation-checklist">${S.checklists.map(c=>`<option value="${esc(c.id)}" ${c.id===ev?.checklist_id?'selected':''}>${esc(c.name)} · v${esc(c.version)}</option>`).join('')}</select></label><button class="btn btn-primary" data-action="evaluate-dialog" ${S.busy || !S.checklists.length ? 'disabled' : ''}>${ev ? 'Оценить заново' : 'Оценить диалог'} ↗</button></div></div>
    <div class="split-view detail-top"><section class="panel"><div class="panel-heading"><h2>Транскрипт</h2><span class="muted small">${record.transcript.length} реплик</span></div>${record.channel==='voice call'?'<div class="audio-block" id="audio-block"><button class="btn btn-small" data-action="audio">Загрузить запись</button><p class="audio-caption">Запись загружается по свежей ссылке.</p></div>':''}<div class="quiet-line">Оценивается оператор. Бот и система дают контекст.</div><div class="transcript" id="transcript">${record.transcript.map((t,i)=>`<article id="turn-${i}" class="turn turn-${esc(Object.hasOwn(roles,t.speaker)?t.speaker:'system')}" tabindex="-1"><div class="turn-meta"><strong>${esc(roles[t.speaker] || t.speaker)}</strong><span>№ ${i+1} · ${esc(t.timestamp)}</span></div><p>${esc(t.text)}</p></article>`).join('')}</div></section><section class="panel" id="evaluation-panel">${renderEvaluation(ev)}</section></div>`;
}
function renderEvaluation(ev) {
  return renderEvaluationView({ evaluation: ev, checklist: checklistForEvaluation(), appeals: S.appeals, dialog: S.dialog, demo: S.demo });
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
    const url=audio.url || audio.audio_url;
    let parsed;try{parsed=new URL(url,location.href);}catch{throw new Error('Сервер вернул некорректную ссылку на запись.');}
    if (!['http:','https:','blob:'].includes(parsed.protocol) && !(S.demo && parsed.protocol==='data:' && String(url).startsWith('data:audio/'))) throw new Error('Сервер вернул недопустимую ссылку на запись.');
    S.audio=audio;
    area.innerHTML=`<label class="small">${S.demo?'Учебный звуковой сигнал, не запись разговора':'Запись разговора'}</label><audio id="call-audio" controls preload="metadata" src="${esc(url)}"></audio><p class="audio-caption">Кнопка доказательства перематывает запись. Автовоспроизведение отключено.</p><button class="text-btn" data-action="refresh-audio">Обновить ссылку</button>`;
  } catch(e) { if($('#audio-block')) area.innerHTML=`<p class="danger small">${esc(errorText(e))}</p><button class="btn btn-small" data-action="audio">Повторить загрузку</button>`; }
}
function freshChecklist() { return {id:`checklist-${Date.now()}`,version:1,name:'Новый чек-лист',rounding:{digits:2},guidance:[],sections:[{id:'s1',name:'Общие критерии'}],criteria:[]}; }
function renderEditor() {
  const cl=S.editor, c=cl.criteria[S.criterionIndex];
  main.innerHTML=`<div class="page-heading"><div><h1>Чек-листы</h1><p>Настройте правила оценки. Сохранённая версия применяется при следующей проверке.</p></div><div class="actions"><button class="btn" data-action="new-checklist">Новый чек-лист</button><button class="btn btn-primary" data-action="save-checklist">Сохранить версию ${icon('check')}</button></div></div>
    <div class="editor-toolbar checklist-toolbar"><label>Конфигурация<select id="choose-checklist">${S.checklists.map(x=>`<option value="${esc(checklistKey(x))}" ${checklistKey(cl)===checklistKey(x)?'selected':''}>${esc(x.name)} · v${esc(x.version)}</option>`).join('')}${!S.checklists.some(x=>x.id===cl.id)?`<option selected value="">${esc(cl.name)}</option>`:''}</select></label><div class="weight-total"><span>Сумма весов</span><strong id="weight-total">${num(cl.criteria.filter(x=>!x.gross_error).reduce((sum,x)=>sum+Number(x.weight),0))}</strong></div><span id="dirty-label" class="badge ${S.dirty?'badge-amber':''}">${S.dirty?'Есть изменения':'Сохранено'}</span></div>
    <div class="editor-layout checklist-workbench"><aside class="panel checklist-navigation"><div class="panel-heading"><h2>Критерии</h2><span class="badge">${cl.criteria.length}</span></div><div class="editor-list">${cl.criteria.map((x,i)=>`<button class="editor-item ${i===S.criterionIndex?'active':''}" data-criterion-index="${i}" ${i===S.criterionIndex?'aria-current="true"':''}><span class="editor-index">${String(i+1).padStart(2,'0')}</span><span><strong>${esc(x.title)}</strong><small>${x.gross_error?'Грубая ошибка':`Вес ${num(x.weight)} · ${x.answer_type==='scale'?'Шкала':'Да / Нет'}`}</small></span></button>`).join('')}</div><div class="panel-body"><button class="btn" data-action="add-criterion">＋ Добавить критерий</button></div></aside>
    <section class="panel checklist-configuration"><div class="panel-body"><div class="checklist-name"><label>Название чек-листа<input data-edit="name" value="${esc(cl.name)}" required maxlength="160"></label></div>
    ${c?`<div class="editor-title-row"><div><span class="editor-eyebrow">Настройка критерия · ${esc(c.id)}</span><h2>Критерий ${String(S.criterionIndex+1).padStart(2,'0')}</h2></div><button class="btn btn-small btn-ghost danger" data-action="remove-criterion">Удалить критерий</button></div>
      <div class="editor-groups">
        <fieldset class="editor-fieldset"><legend><span class="editor-step" aria-hidden="true">01</span>Формулировка</legend><div class="field-grid"><label class="full">Название критерия<input data-criterion="title" value="${esc(c.title)}" required maxlength="200"></label><label class="full">Что считается выполнением<textarea data-criterion="description" required>${esc(c.description)}</textarea><span class="editor-help">Опишите действие оператора и условия, при которых критерий выполнен.</span></label></div></fieldset>
        <fieldset class="editor-fieldset"><legend><span class="editor-step" aria-hidden="true">02</span>Оценка и вес</legend><div class="field-grid"><label>Тип ответа<select data-criterion="answer_type"><option value="binary" ${c.answer_type==='binary'?'selected':''}>Да / Нет</option><option value="scale" ${c.answer_type==='scale'?'selected':''}>Числовая шкала</option></select></label><label>Вес критерия<input data-criterion="weight" type="number" min="0" max="100" step="0.1" value="${esc(c.weight)}" ${c.gross_error?'disabled':''}><span class="editor-help">${c.gross_error?'Грубая ошибка отмечается отдельно от баллов.':'Вклад критерия в итоговую оценку.'}</span></label>
        ${c.answer_type==='scale'?`<div class="full editor-scale"><label>Ступени шкалы<textarea data-criterion="steps" rows="6" placeholder="0 | Нет ответа&#10;10 | Полный ответ">${esc((c.scale?.steps||[]).map(s=>`${s.value} | ${s.label}`).join('\n'))}</textarea><span class="editor-help">Одна ступень на строку: число | описание. Максимум шкалы определяется по наибольшему числу.</span></label><aside class="editor-scale-guide" id="scale-preview">${renderScalePreview(c.scale)}</aside></div>`:''}</div></fieldset>
        <fieldset class="editor-fieldset"><legend><span class="editor-step" aria-hidden="true">03</span>Применимость</legend><div class="field-grid"><label class="full">Раздел<select data-criterion="section_id">${cl.sections.map(s=>`<option value="${esc(s.id)}" ${s.id===c.section_id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label class="full editor-option"><input data-criterion="na_allowed" type="checkbox" ${c.na_allowed?'checked':''}><span><strong>Разрешить ответ N/A</strong><small>Критерий может быть неприменим к конкретному диалогу.</small></span><span class="badge editor-neutral" aria-hidden="true">N/A</span></label>${c.na_allowed?`<label class="full">Когда критерий неприменим<textarea data-criterion="na_rule" required>${esc(c.na_rule)}</textarea></label>`:''}</div></fieldset>
        <fieldset class="editor-fieldset"><legend><span class="editor-step" aria-hidden="true">04</span>Особые условия</legend><div class="field-grid"><label class="full editor-option editor-option-critical"><input data-criterion="gross_error" type="checkbox" ${c.gross_error?'checked':''}><span><strong>Грубое нарушение</strong><small>Отдельный флаг без баллов.</small></span></label><label class="full">Пояснения для оценки<textarea data-criterion="notes">${esc(c.notes)}</textarea></label></div></fieldset>
      </div>`:empty('Добавьте критерий','Укажите название, правило, вес и допустимый тип ответа.')}
    <div id="editor-errors" role="alert"></div></div></section></div>`;
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
  if(field==='steps'&&$('#scale-preview')) $('#scale-preview').innerHTML=renderScalePreview(c?.scale);
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
async function saveChecklist(button) {
  const errors=validateChecklist(S.editor);
  if(errors.length) {$('#editor-errors').innerHTML=`<div class="notice error rule">${errors.map(esc).join('<br>')}</div>`;$('#editor-errors').scrollIntoView({block:'nearest'});return;}
  busyButton(button,true);
  try {
    const payload=structuredClone(S.editor);payload.criteria.forEach(c=>delete c._stepsText);
    const result=await api.saveChecklist(payload);
    S.editor=structuredClone(result);S.dirty=false;
    await loadRoute();notify(`Сохранена версия ${result.version}. Повторная оценка использует новые правила.`);
  } catch(e) {notify(errorText(e),true);busyButton(button,false);}
}
function renderAppeals() {
  const visible=S.appeals.filter(a=>S.appealFilter==='all'||a.status==='open');
  main.innerHTML=`<div class="page-heading"><div><h1>Апелляции</h1><p>Сопоставьте комментарий оператора с диалогом и сохраните обоснованное решение.</p></div><button class="btn" data-action="retry">${icon('rotate')} Обновить список</button></div><div class="view-tabs"><button class="btn ${S.appealFilter==='open'?'btn-dark':''}" data-appeal-filter="open">Открытые · ${S.appeals.filter(a=>a.status==='open').length}</button><button class="btn ${S.appealFilter==='all'?'btn-dark':''}" data-appeal-filter="all">Все обращения · ${S.appeals.length}</button></div>
    <section class="panel appeal-queue">${visible.length?visible.map(a=>`<article class="appeal-card" id="appeal-${esc(a.id)}"><div class="appeal-content"><div class="appeal-meta"><span class="badge ${a.status==='open'?'badge-amber':'badge-green'}">${esc(label(a.status))}</span><span class="muted small">${esc(a.conversation_id || a.evaluation_id)} · ${esc(a.criterion_id)}</span></div><h3>${esc(a.criterion_title || 'Пересмотр критерия')}</h3><div class="appeal-perspectives ${a.decision?'has-decision':''}"><section class="appeal-statement"><h4>Комментарий оператора</h4><p>${esc(a.comment)}</p></section>${a.decision?`<section class="appeal-statement appeal-decision"><h4>Решение проверяющего</h4><strong class="appeal-answer">Ответ: ${esc(label(a.decision.answer))}</strong><p>${esc(a.decision.reason)}</p></section>`:''}</div></div><div class="actions appeal-actions"><button class="btn btn-small" data-context="${esc(a.id)}">Открыть диалог ${icon('arrow-right')}</button>${a.status==='open'?`<button class="btn btn-small btn-primary" data-review="${esc(a.id)}">Рассмотреть</button>`:''}</div><div class="review-form" id="review-${esc(a.id)}" hidden></div></article>`).join(''):empty(S.appealFilter==='open'?'Нет открытых апелляций':'Апелляций пока нет','Чтобы оспорить оценку, откройте диалог и нажмите «Оспорить» у нужного критерия.','<a class="btn" href="#dialogs">Перейти к диалогам</a>')}</section>`;
}
async function showReview(id) {
  const appeal=S.appeals.find(a=>a.id===id);
  const area=document.getElementById(`review-${id}`);
  area.hidden=false;area.innerHTML='<p class="muted">Загрузка оценки…</p>';
  try {
    const ev=await api.getEvaluation(appeal.evaluation_id);
    const cl=ev.checklist || findChecklist(ev.checklist_id),c=cl.criteria.find(c=>c.id===appeal.criterion_id),item=ev.criteria.find(c=>c.criterion_id===appeal.criterion_id);
    area.innerHTML=`<form data-decision="${esc(id)}" class="form-stack appeal-review-layout"><aside class="appeal-current"><span class="editor-eyebrow">Текущая оценка</span><h4>${esc(c.title)}</h4><div class="appeal-current-answer"><span>Ответ по критерию</span><strong>${esc(label(item.answer))}</strong></div><p>${esc(item.explanation)}</p><button class="text-btn" type="button" data-context="${esc(id)}">Проверить фрагмент диалога ${icon('arrow-right')}</button></aside><div class="form-stack appeal-review-fields"><fieldset class="appeal-review-choice"><legend>Решение проверяющего</legend><div class="radio-row"><label><input type="radio" name="decision-status" value="confirmed" checked><span>Подтвердить оценку</span></label><label><input type="radio" name="decision-status" value="changed"><span>Изменить оценку</span></label></div></fieldset><label>Ответ после рассмотрения<select name="answer" data-original="${esc(item.answer)}" disabled>${answerOptions(c).map(v=>`<option value="${esc(v)}" ${String(v)===String(item.answer)?'selected':''}>${esc(label(v))}</option>`).join('')}</select><span class="editor-help">Для выбора другого ответа отметьте «Изменить оценку».</span></label><label>Причина решения<textarea name="reason" required maxlength="4000" placeholder="Объясните, что подтверждает решение"></textarea></label><div class="actions appeal-review-actions"><button class="btn btn-primary" type="submit">Сохранить решение</button><button class="btn" type="button" data-cancel-review="${esc(id)}">Отмена</button></div></div></form>`;
  } catch(e) {area.innerHTML=`<p class="danger">${esc(errorText(e))}</p>`;}
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
    else if(el.dataset.cancelReview) document.getElementById(`review-${el.dataset.cancelReview}`).hidden=true;
    else if(el.dataset.context){const a=S.appeals.find(a=>a.id===el.dataset.context);const ev=await api.getEvaluation(a.evaluation_id);location.hash=`dialog/${encodeURIComponent(ev.conversation_id)}`;}
    else if(el.dataset.resumeJob) pollJob(el.dataset.resumeJob);
    else switch(el.dataset.action){
      case 'close-modal':modal.close();break;
      case 'settings':showSettings();break;
      case 'retry':await loadRoute();break;
      case 'demo':S.demo=true;S.selected.clear();connect();await loadRoute();break;
      case 'import':showImport();break;
      case 'upload':$('#upload-file').click();break;
      case 'audio':await loadAudio();break;
      case 'refresh-audio':S.audio=null;await loadAudio();break;
      case 'reset-filters':S.filters={query:'',channel:'',language:'',status:''};renderDialogs();break;
      case 'evaluate-selected':showEvaluate([...S.selected]);break;
      case 'evaluate-dialog':showEvaluate([S.dialog.conversation_id],$('#evaluation-checklist').value);break;
      case 'save-checklist':await saveChecklist(el);break;
      case 'new-checklist':if(S.dirty&&!confirm('Отменить несохранённые изменения чек-листа?'))break;S.editor=freshChecklist();S.dirty=true;S.criterionIndex=0;renderEditor();break;
      case 'add-criterion':{const ids=new Set(S.editor.criteria.map(c=>c.id));let i=S.editor.criteria.length+1;while(ids.has(`c${String(i).padStart(2,'0')}`))i++;S.editor.criteria.push({id:`c${String(i).padStart(2,'0')}`,section_id:S.editor.sections[0]?.id||'s1',title:'Новый критерий',description:'',answer_type:'binary',scale:null,weight:10,na_allowed:false,na_rule:null,notes:null,gross_error:false});S.criterionIndex=S.editor.criteria.length-1;S.dirty=true;renderEditor();break;}
      case 'remove-criterion':if(!confirm('Удалить критерий из этой версии? Сохранённые оценки останутся прежними.'))break;S.editor.criteria.splice(S.criterionIndex,1);S.criterionIndex=Math.max(0,S.criterionIndex-1);S.dirty=true;renderEditor();break;
    }
  }catch(e){notify(errorText(e),true);}
});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='search-dialogs'){S.filters.query=el.value;renderRows();}
  if(el.dataset.edit||el.dataset.criterion) updateEditor(el);
});
document.addEventListener('change',async event=>{
  const el=event.target;
  if(el.dataset.filter){S.filters[el.dataset.filter]=el.value;renderRows();}
  if(el.dataset.select){el.checked?S.selected.add(el.dataset.select):S.selected.delete(el.dataset.select);renderRows();}
  if(el.id==='select-all'){visibleRows().forEach(r=>el.checked?S.selected.add(r.conversation_id):S.selected.delete(r.conversation_id));renderRows();}
  if(el.id==='choose-checklist'){if(S.dirty&&!confirm('Отменить несохранённые изменения?')){el.value=checklistKey(S.editor);return;}S.editor=structuredClone(findChecklist(el.value));S.dirty=false;S.criterionIndex=0;renderEditor();}
  if(el.name==='decision-status'){const select=$('select[name=answer]',el.form);select.disabled=el.value==='confirmed';if(select.disabled)select.value=select.dataset.original;}
  if(el.id==='upload-file'&&el.files[0]) {
    const file=el.files[0];
    try{if(file.size>5*1024*1024)throw new Error('Файл больше 5 МБ. Загрузите меньший JSON.');JSON.parse(await file.text());await api.uploadDialog(file);S.selected.clear();location.hash='dialogs';await loadRoute();notify('Транскрипт загружен.');}catch(e){notify(e instanceof SyntaxError?'Файл должен содержать корректный JSON.':errorText(e),true);}finally{el.value='';}
  }
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!form.matches('#settings-form,#import-form,#appeal-form,#evaluate-form,[data-decision]'))return;
  event.preventDefault();const button=$('button[type=submit]',form);busyButton(button,true);const values=new FormData(form);
  try{
    if(form.id==='settings-form') {
      const base=String(values.get('baseUrl')).trim();let parsed;
      try{parsed=new URL(base,location.origin);}catch{throw new Error('Укажите корректный адрес API.');}
      if(!base||base.startsWith('//')||!['http:','https:'].includes(parsed.protocol)||parsed.search||parsed.hash||parsed.username||parsed.password)throw new Error('Используйте адрес API без ключей, параметров и пароля.');
      S.baseUrl=base.replace(/\/$/,'');S.demo=values.get('mode')==='demo';
      try{localStorage.setItem('cqa-connection',JSON.stringify({baseUrl:S.baseUrl,demo:S.demo}));}catch{notify('Браузер не разрешил сохранить настройки.');}
      const url=new URL(location.href);url.searchParams.delete('demo');history.replaceState(null,'',url);
      S.editor=null;S.dirty=false;S.selected.clear();connect();modal.close();await loadRoute();
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
      await api.decideAppeal(form.dataset.decision,{answer,reason,status:values.get('decision-status')});await loadRoute();notify('Решение сохранено. Итог пересчитан.');
    }
  }catch(e){notify(errorText(e),true);}finally{busyButton(button,false);}
});
window.addEventListener('hashchange',async()=>{window.scrollTo({top:0});await loadRoute();main.focus({preventScroll:true});});
window.addEventListener('beforeunload',event=>{if(S.dirty){event.preventDefault();event.returnValue='';}});
try{connect();loadRoute();let active;try{active=JSON.parse(sessionStorage.getItem('cqa-active-job')||'null');}catch{/* Ignore malformed browser state. */}if(active?.id&&active.baseUrl===S.baseUrl&&active.demo===S.demo)pollJob(active.id);}catch(e){showError(e);}
