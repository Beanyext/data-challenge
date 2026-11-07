import { createApi } from './api.mjs';
import { hydrateIcons } from './icons.mjs';
import { ui, translate as t, formatNumber, localizeMessage, getLocale } from './react-ui.js';
import { storeLanguageDraft, takeLanguageDraft, captureFormDrafts, restoreFormDrafts } from './language-draft.mjs';

hydrateIcons();

const $ = (s, root = document) => root.querySelector(s);
const num = formatNumber;
const main = $('#main');
const modal = $('#modal');
let toastTimer, routeRevision = 0, polling = false;
let saved = {};
try { saved = JSON.parse(localStorage.getItem('cqa-connection') || '{}'); } catch { /* Storage may be unavailable. */ }
const config = window.CQA_CONFIG || {};
const S = { demo:new URLSearchParams(location.search).get('demo') === '1' || (saved.demo ?? config.demo ?? false), baseUrl:saved.baseUrl ?? config.apiBase ?? '/api', rows:[], checklists:[], appeals:[], selected:new Set(), filters:{query:'', language:'', channel:'', status:''}, dialog:null, evaluation:null, audio:null, editor:null, criterionIndex:0, dirty:false, busy:false, appealFilter:'open', sort:null, savedNotice:null, pendingTurn:null };
let api;
let languageReload = false, currentModal = null;
let languageDraft = takeLanguageDraft(getLocale(), location.hash);
if (languageDraft) {
  S.filters = languageDraft.filters;
  S.selected = new Set(languageDraft.selected);
  S.appealFilter = languageDraft.appealFilter === 'all' ? 'all' : 'open';
  S.criterionIndex = Math.max(0, Number(languageDraft.criterionIndex) || 0);
  if (languageDraft.editor) { S.editor = languageDraft.editor; S.dirty = true; }
}
function prepareLanguageReload(locale) {
  const draft = { locale, route:location.hash, filters:S.filters, selected:[...S.selected], editor:S.dirty?S.editor:null, checklistId:S.editor?.id, criterionIndex:S.criterionIndex, appealFilter:S.appealFilter, modal:modal.open?currentModal:null, forms:captureFormDrafts(), scrollY:window.scrollY };
  if (!storeLanguageDraft(draft)) { notify('Не удалось сохранить незавершённый ввод. Смена языка отменена.',true); return false; }
  languageReload = true;
  return true;
}
async function restoreLanguageView() {
  const draft = languageDraft;
  languageDraft = null;
  if (!draft || location.hash !== draft.route) return;
  for (const form of draft.forms) if (form.decision && document.getElementById(`review-${form.decision}`)) { await showReview(form.decision); if (location.hash !== draft.route) return; }
  if (draft.modal && ['appeal','settings','import','evaluate'].includes(draft.modal.contents?.kind)) { openModal(draft.modal.title,draft.modal.contents,draft.modal.formId); if (draft.modal.contents.kind === 'evaluate') loadEstimate(Number(draft.modal.contents.count) || 1); }
  restoreFormDrafts(draft.forms);
  if (Number.isFinite(draft.scrollY)) window.scrollTo({top:draft.scrollY,behavior:'instant'});
}
function rememberJob(id) {try{if(id)sessionStorage.setItem('cqa-active-job',JSON.stringify({id,baseUrl:S.baseUrl,demo:S.demo}));else sessionStorage.removeItem('cqa-active-job');}catch{/* Jobs still run when browser storage is disabled. */}}

function notify(text, error = false) {
  clearTimeout(toastTimer);
  ui.toast(text,error);
  toastTimer = setTimeout(() => ui.clearToast(), 6500);
}
function errorText(e) { const message=String(e?.message || 'Не удалось выполнить действие. Повторите попытку.');return /\b(sig|token|api[_-]?key|authorization|password)\b/i.test(message)?t('Ошибка запроса. Подробности с данными доступа скрыты.'):localizeMessage(message.replace(/https?:\/\/\S+/gi,t('[адрес скрыт]')).slice(0,300)); }
function busyButton(button, busy) { if (button) { button.disabled = busy; button.setAttribute('aria-busy', String(busy)); } }
function connect() {
  api = createApi({ baseUrl:S.baseUrl, demo:S.demo });
  $('#demo-banner').hidden = !S.demo;
  $('#connection-label').textContent = t(S.demo ? 'Учебный пример' : 'Настройки подключения');
}
function section() { return (location.hash.slice(1).split('/')[0] || 'dialogs'); }
function route() { return location.hash.slice(1).split('/'); }
function checklistKey(c) { return `${c.id}@${c.version}`; }
function findChecklist(key) { return S.checklists.find(c => checklistKey(c) === key) || S.checklists.find(c => c.id === key) || S.checklists[0]; }
function checklistForEvaluation() { return S.evaluation?.checklist || S.checklists.find(c => c.id === S.evaluation?.checklist_id && c.version === S.evaluation?.checklist_version) || findChecklist(S.evaluation?.checklist_id); }
function nameForRow(row) { return row.title || row.subject || row.transcript?.find(t => t.speaker === 'client')?.text || 'Диалог поддержки'; }
function turnCount(conversationId) { const row=S.rows.find(r => r.conversation_id === conversationId); const n=Number(row?.turns ?? row?.transcript?.length); return Number.isFinite(n) && n > 0 ? n : undefined; }
function listStats() {
  const completed = S.rows.filter(r => typeof r.total === 'number');
  return { total:S.rows.length, completed:completed.length, average:completed.length ? completed.reduce((sum, r) => sum + r.total, 0) / completed.length : null, gross:S.rows.filter(r => r.gross_error).length };
}
// Results of the same checklist made with an earlier version keep their totals until they are evaluated again.
function staleRows(notice) { return S.rows.filter(r => r.checklist_id === notice.checklistId && r.checklist_version != null && Number(r.checklist_version) < notice.version).map(r => r.conversation_id); }
function savedNoticeView() { return S.savedNotice ? { ...S.savedNotice, stale:staleRows(S.savedNotice) } : null; }
function openModal(title, contents, formId) {
  currentModal = {title,contents,formId};
  ui.modal(title,contents);
  if (!modal.open) modal.showModal();
  setTimeout(() => $(`#${formId} input, #${formId} textarea, #${formId} select`)?.focus(), 0);
}
function skeleton() { ui.loading(); }
function showError(e) { ui.error(errorText(e)); }
async function loadRoute() {
  const revision = ++routeRevision;
  const [page, id] = route();
  document.querySelectorAll('[data-nav]').forEach(a => a.setAttribute('aria-current', a.dataset.nav === (page === 'dialog' ? 'dialogs' : page || 'dialogs') ? 'page' : 'false'));
  $('#breadcrumb').textContent = t({dialogs:'Диалоги',dialog:'Карточка диалога',checklists:'Чек-листы',appeals:'Апелляции'}[page] || 'Диалоги');
  document.title = `CQA · ${$('#breadcrumb').textContent}`;
  skeleton();
  try {
    const [rows, checklists, appeals] = await Promise.all([api.listDialogs(), api.listChecklists(), api.listAppeals()]);
    if (revision !== routeRevision) return;
    S.rows = rows; S.checklists = checklists; S.appeals = appeals;
    $('#dialog-count').textContent = rows.length;
    $('#appeal-count').textContent = appeals.filter(a => a.status === 'open').length || '';
    if (page !== 'checklists') S.savedNotice = null;
    if (page === 'dialog' && id) {
      const record = await api.getDialog(decodeURIComponent(id));
      const evaluationId = record.evaluation_id || rows.find(r => r.conversation_id === record.conversation_id)?.evaluation_id;
      const evaluation = evaluationId ? await api.getEvaluation(evaluationId) : null;
      if (revision !== routeRevision) return;
      S.dialog = record; S.evaluation = evaluation; S.audio = null;
      renderDialog();
    } else if (page === 'checklists') {
      if (!S.dirty || !S.editor) { S.editor = structuredClone(checklists.find(c=>c.id===(S.editor?.id || languageDraft?.checklistId)) || checklists[0] || freshChecklist()); S.criterionIndex = Math.min(S.criterionIndex,Math.max(0,S.editor.criteria.length-1)); }
      renderEditor();
    } else if (page === 'appeals') renderAppeals();
    else renderDialogs();
    await restoreLanguageView();
  } catch (e) { if (revision === routeRevision) showError(e); }
}
function renderDialogs() {
  ui.dialogs({rows:S.rows,stats:listStats(),filters:S.filters,sort:S.sort});
  renderRows();
}
function visibleRows() {
  const f = S.filters;
  const rows = S.rows.filter(r => (!f.language || r.language === f.language) && (!f.channel || r.channel === f.channel) && (!f.query || `${r.conversation_id} ${nameForRow(r)} ${(r.transcript || []).map(t => t.text).join(' ')}`.toLocaleLowerCase().includes(f.query.toLocaleLowerCase())) && (!f.status || (f.status === 'gross' ? r.gross_error : f.status === 'completed' ? typeof r.total === 'number' : !r.evaluation_id)));
  if (!S.sort) return rows;
  // Stable sort by score; conversations without a score stay at the end in both directions.
  const direction = S.sort === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => { const x = typeof a.total === 'number', y = typeof b.total === 'number'; return x !== y ? (x ? -1 : 1) : x ? direction * (a.total - b.total) : 0; });
}
function renderRows() {
  const rows = visibleRows();
  ui.rows(rows,S.selected,S.rows.length,S.filters,{sort:S.sort,stats:listStats()});
  $('#list-empty').hidden = rows.length > 0;
  $('#visible-count').textContent = t('Показано {visible} из {total}',{visible:rows.length,total:S.rows.length});
  $('#select-all').checked = rows.length > 0 && rows.every(r => S.selected.has(r.conversation_id));
  $('#select-all').indeterminate = rows.some(r => S.selected.has(r.conversation_id)) && !$('#select-all').checked;
  $('#evaluate-selected').disabled = !S.selected.size || S.busy;
  $('#evaluate-selected').textContent = S.selected.size ? t('Оценить выбранные ({count}) ↗',{count:S.selected.size}) : t('Оценить выбранные ↗');
}
function renderDialog() {
  ui.dialog({record:S.dialog,evaluation:S.evaluation,checklist:checklistForEvaluation(),checklists:S.checklists,appeals:S.appeals,demo:S.demo,busy:S.busy});
}
async function highlightTurn(turn, end, source) {
  const first=Number(turn), last=end===undefined?first:Number(end);
  if (!Number.isInteger(first)||!Number.isInteger(last)||first<0||last<first||!S.dialog?.transcript||last>=S.dialog.transcript.length) return;
  document.querySelectorAll('.turn.highlight, .result-criterion.evidence-selected').forEach(el=>el.classList.remove('highlight','evidence-selected'));
  source?.closest('.result-criterion')?.classList.add('evidence-selected');
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
  ui.audioLoading();
  try {
    const audio=await api.getAudio(id);
    if(S.dialog.conversation_id!==id || !$('#audio-block')) return;
    const url=audio.url || audio.audio_url;
    let parsed;try{parsed=new URL(url,location.href);}catch{throw new Error('Сервер вернул некорректную ссылку на запись.');}
    if (!['http:','https:','blob:'].includes(parsed.protocol) && !(S.demo && parsed.protocol==='data:' && String(url).startsWith('data:audio/'))) throw new Error('Сервер вернул недопустимую ссылку на запись.');
    S.audio=audio;
    ui.audio(url,S.demo);
  } catch(e) { if($('#audio-block')) ui.audioError(errorText(e)); }
}
function freshChecklist() { return {id:`checklist-${Date.now()}`,version:1,name:t('Новый чек-лист'),rounding:{digits:2},guidance:[],sections:[{id:'s1',name:t('Общие критерии')}],criteria:[]}; }
function renderEditor() {
  ui.editor({checklist:S.editor,checklists:S.checklists,criterionIndex:S.criterionIndex,dirty:S.dirty,saved:savedNoticeView()});
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
    if(field==='answer_type') c.scale=target.value==='scale'?{min:0,max:10,steps:[{value:0,label:t('Не выполнено')},{value:10,label:t('Выполнено')}]}:null;
    if(field==='na_allowed'&&!c.na_allowed) c.na_rule=null;
  }
  S.dirty=true;
  if($('#dirty-label')) {$('#dirty-label').textContent=t('Есть изменения');$('#dirty-label').classList.add('badge-amber');}
  if($('#weight-total')) $('#weight-total').textContent=num(S.editor.criteria.filter(c=>!c.gross_error).reduce((sum,c)=>sum+Number(c.weight),0));
  if(field==='steps'&&$('#scale-preview')) ui.scale(c?.scale);
  if(['answer_type','gross_error','na_allowed'].includes(field)) renderEditor();
}
function validateChecklist(cl) {
  const errors=[];
  if(!cl.name.trim()) errors.push(t('Укажите название чек-листа.'));
  if(!cl.criteria.length) errors.push(t('Добавьте хотя бы один критерий.'));
  for(const c of cl.criteria) {
    if(!c.title.trim()||!c.description.trim()) errors.push(t('{id}: нужны название и правило оценки.',{id:c.id}));
    if(!Number.isFinite(c.weight)||c.weight<0||c.weight>100) errors.push(t('{id}: вес должен быть от 0 до 100.',{id:c.id}));
    if(c.na_allowed&&!c.na_rule?.trim()) errors.push(t('{id}: укажите условие N/A.',{id:c.id}));
    if(c.answer_type==='scale'&&(!c.scale?.steps?.length||!Number.isFinite(c.scale.max)||c.scale.max<=0||c.scale.steps.some(s=>!Number.isFinite(s.value)||s.value<0||!s.label)||new Set(c.scale.steps.map(s=>s.value)).size!==c.scale.steps.length)) errors.push(t('{id}: проверьте ступени шкалы, числа не должны повторяться, максимум должен быть больше нуля.',{id:c.id}));
  }
  return errors;
}
async function saveChecklist(button) {
  const errors=validateChecklist(S.editor);
  if(errors.length) {ui.editorErrors(errors);$('#editor-errors').scrollIntoView({block:'nearest'});return;}
  busyButton(button,true);
  try {
    const payload=structuredClone(S.editor);payload.criteria.forEach(c=>delete c._stepsText);
    const result=await api.saveChecklist(payload);
    S.editor=structuredClone(result);S.dirty=false;
    S.savedNotice={checklistId:result.id,version:Number(result.version),criteria:(result.criteria||payload.criteria).length};
    await loadRoute();
    document.querySelector('.saved-banner')?.scrollIntoView({block:'nearest'});
  } catch(e) {notify(errorText(e),true);busyButton(button,false);}
}
function renderAppeals() { ui.appeals({appeals:S.appeals,filter:S.appealFilter,turnCounts:Object.fromEntries(S.appeals.map(a => [a.conversation_id ?? '', turnCount(a.conversation_id)]).filter(([, n]) => n))}); }
async function showReview(id) {
  const appeal=S.appeals.find(a=>a.id===id);
  const area=document.getElementById(`review-${id}`);
  area.hidden=false;ui.reviewMessage(id,'Загрузка оценки…');
  try {
    const ev=await api.getEvaluation(appeal.evaluation_id);
    if(document.getElementById(`review-${id}`)!==area) return;
    const cl=ev.checklist || findChecklist(ev.checklist_id),c=cl.criteria.find(c=>c.id===appeal.criterion_id),item=ev.criteria.find(c=>c.criterion_id===appeal.criterion_id);
    ui.review({appeal,criterion:c,item,transcriptLength:turnCount(appeal.conversation_id || ev.conversation_id)});
  } catch(e) {if(document.getElementById(`review-${id}`)===area) ui.reviewMessage(id,errorText(e),true);}
}
function showAppeal(criterionId) {
  const criterion=checklistForEvaluation()?.criteria.find(c=>c.id===criterionId);
  openModal('Оспорить оценку',{kind:'appeal',criterionId,title:criterion?.title || criterionId},'appeal-form');
}
function showSettings() {
  if(S.busy) return notify('Дождитесь завершения оценки перед сменой источника данных.');
  openModal('Подключение к данным',{kind:'settings',demo:S.demo,baseUrl:S.baseUrl},'settings-form');
}
function showImport() {
  openModal('Импорт набора',{kind:'import',demo:S.demo},'import-form');
}
function showEvaluate(ids, selectedChecklist) {
  if(S.busy) return notify('Предыдущее задание ещё выполняется. Дождитесь результата.');
  if(!ids.length) return notify('Сначала выберите диалог.',true);
  if(!S.checklists.length) return notify('Сначала создайте чек-лист.',true);
  openModal('Запустить оценку',{kind:'evaluate',count:ids.length,selectedChecklist,checklists:S.checklists,demo:S.demo},'evaluate-form');
  $('#evaluate-form')._ids=ids;
  loadEstimate(ids.length);
}
// Price and time come from the server's recent real evaluations. Without them the general confirmation text stays.
async function loadEstimate(count) {
  ui.estimate(null,count);
  try { const health=await api.getHealth(); if(modal.open && $('#evaluate-form')) ui.estimate(health,count); }
  catch { /* The estimate is optional. */ }
}
async function pollJob(id) {
  if(polling) return;
  polling=true;S.busy=true;rememberJob(id);$('#job-banner').hidden=false;
  let failureCount=0;
  for(let i=0;i<300;i++) {
    try {
      const job=await api.getJob(id);failureCount=0;
      const total=Number(job.total)||1,completed=Number(job.completed)||0;
      ui.job(completed,total);
      if(['completed','done','finished','succeeded'].includes(job.status)) {polling=false;S.busy=false;rememberJob(null);$('#job-banner').hidden=true;S.selected.clear();await loadRoute();notify('Оценка завершена. Результаты обновлены.');return;}
      if(['failed','error','cancelled'].includes(job.status)) {polling=false;S.busy=false;rememberJob(null);ui.jobFailed();await loadRoute();return;}
    } catch(e) {failureCount++;if(failureCount>=3){polling=false;S.busy=false;ui.jobRetry(id,errorText(e));return;}}
    await new Promise(resolve=>setTimeout(resolve,S.demo?450:1500));
  }
  polling=false;S.busy=false;ui.jobRetry(id);
}
document.addEventListener('click',async event=>{
  if(event.target.closest('.skip-link')){event.preventDefault();main.focus();return;}
  const el=event.target.closest('button, a[data-nav]');if(!el)return;
  try {
    if(el.dataset.open) location.hash=`dialog/${encodeURIComponent(el.dataset.open)}`;
    else if(el.dataset.turn!==undefined) await highlightTurn(el.dataset.turn,el.dataset.rangeEnd,el);
    else if(el.dataset.clearFilter && Object.hasOwn(S.filters,el.dataset.clearFilter)) {
      const key=el.dataset.clearFilter;
      S.filters[key]='';
      const control=key==='query'?$('#search-dialogs'):document.querySelector(`[data-filter="${key}"]`);
      if(control)control.value='';
      renderRows();
      control?.focus();
    }
    else if(el.dataset.appeal) showAppeal(el.dataset.appeal);
    else if(el.dataset.criterionIndex!==undefined){S.criterionIndex=Number(el.dataset.criterionIndex);renderEditor();}
    else if(el.dataset.appealFilter){S.appealFilter=el.dataset.appealFilter;renderAppeals();}
    else if(el.dataset.review) await showReview(el.dataset.review);
    else if(el.dataset.cancelReview) document.getElementById(`review-${el.dataset.cancelReview}`).hidden=true;
    else if(el.dataset.fragmentTurn!==undefined) showFragmentTurn(el.dataset.fragmentAppeal,el.dataset.fragmentTurn);
    else if(el.dataset.context){const a=S.appeals.find(a=>a.id===el.dataset.context);const cid=a.conversation_id||(await api.getEvaluation(a.evaluation_id)).conversation_id;S.pendingTurn=el.dataset.contextTurn!==undefined?Number(el.dataset.contextTurn):null;location.hash=`dialog/${encodeURIComponent(cid)}`;}
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
      case 'status-filter':{const value=S.filters.status===el.dataset.status?'':el.dataset.status;S.filters.status=value;const control=document.querySelector('[data-filter="status"]');if(control)control.value=value;renderRows();break;}
      case 'sort-score':S.sort=S.sort===null?'asc':S.sort==='asc'?'desc':null;renderRows();break;
      case 'dismiss-saved':S.savedNotice=null;ui.savedNotice(null);break;
      case 'reevaluate-saved':if(S.savedNotice)showEvaluate(staleRows(S.savedNotice),S.savedNotice.checklistId);break;
      case 'reset-filters':S.filters={query:'',channel:'',language:'',status:''};renderDialogs();$('#search-dialogs')?.focus();break;
      case 'clear-selection':S.selected.clear();renderRows();$('#select-all')?.focus();break;
      case 'evaluate-selected':showEvaluate([...S.selected]);break;
      case 'evaluate-dialog':showEvaluate([S.dialog.conversation_id],$('#evaluation-checklist').value);break;
      case 'save-checklist':await saveChecklist(el);break;
      case 'new-checklist':if(S.dirty&&!confirm(t('Отменить несохранённые изменения чек-листа?')))break;S.editor=freshChecklist();S.dirty=true;S.criterionIndex=0;renderEditor();break;
      case 'add-criterion':{const ids=new Set(S.editor.criteria.map(c=>c.id));let i=S.editor.criteria.length+1;while(ids.has(`c${String(i).padStart(2,'0')}`))i++;S.editor.criteria.push({id:`c${String(i).padStart(2,'0')}`,section_id:S.editor.sections[0]?.id||'s1',title:t('Новый критерий'),description:'',answer_type:'binary',scale:null,weight:10,na_allowed:false,na_rule:null,notes:null,gross_error:false});S.criterionIndex=S.editor.criteria.length-1;S.dirty=true;renderEditor();break;}
      case 'remove-criterion':if(!confirm(t('Удалить критерий из этой версии? Сохранённые оценки останутся прежними.')))break;S.editor.criteria.splice(S.criterionIndex,1);S.criterionIndex=Math.max(0,S.criterionIndex-1);S.dirty=true;renderEditor();break;
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
  if(el.id==='choose-checklist'){if(S.dirty&&!confirm(t('Отменить несохранённые изменения?'))){el.value=checklistKey(S.editor);return;}S.editor=structuredClone(findChecklist(el.value));S.dirty=false;S.criterionIndex=0;renderEditor();}
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
window.addEventListener('hashchange',async()=>{
  window.scrollTo({top:0});await loadRoute();main.focus({preventScroll:true});
  // A turn number in an appeal opens the conversation at that message.
  const turn=S.pendingTurn;S.pendingTurn=null;
  if(turn!=null&&section()==='dialog')await highlightTurn(turn);
});
function showFragmentTurn(appealId, turn) {
  const row=document.getElementById(`appeal-${appealId}-turn-${turn}`);
  if(!row)return;
  document.querySelectorAll('.appeal-fragment li.highlight').forEach(item=>item.classList.remove('highlight'));
  row.classList.add('highlight');
  row.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});
  row.focus({preventScroll:true});
}
window.addEventListener('beforeunload',event=>{if(S.dirty&&!languageReload){event.preventDefault();event.returnValue='';}});
try{ui.language(prepareLanguageReload,()=>{languageReload=false;notify('Не удалось обновить страницу. Повторите выбор языка.',true);});connect();loadRoute();let active;try{active=JSON.parse(sessionStorage.getItem('cqa-active-job')||'null');}catch{/* Ignore malformed browser state. */}if(active?.id&&active.baseUrl===S.baseUrl&&active.demo===S.demo)pollJob(active.id);}catch(e){showError(e);}
