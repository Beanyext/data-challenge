import { buildSubmission } from './submission.mjs';
import { parseDatasetSource, parseEvaluationFiles, collectServerEntries } from './submission-source.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const unique = values => [...new Set(values)];
const LIMIT = 20 * 1024 * 1024;

/** Files and transcripts stay in this tab's memory; export never starts an evaluation. */
export function createSubmissionUI({ root, getApi, isDemo, teamName, notify }) {
  const state = { dataset:'dev', teamName, mode:'', modelName:'', source:'original', input:isDemo()?'files':'server', datasetFile:null, evaluationFiles:[], prepared:null, errors:[], warnings:[], busy:false, progress:'', acknowledged:false, serverApi:null };
  const automatic = { modelName:false, mode:false };
  const fileInputs = new Map();
  const onPage = () => Boolean(root.querySelector('#submission-page'));
  const invalidate = () => { state.prepared=null; state.errors=[]; state.warnings=[]; state.acknowledged=false; };
  const selected = (value, expected) => value === expected ? 'selected' : '';
  const target = () => `results/${state.dataset}/results.json`;
  function render() {
    if (state.input === 'server' && state.serverApi && state.serverApi !== getApi()) invalidate();
    for(const id of ['submission-dataset-file','submission-evaluation-files']) {
      const input=root.querySelector(`#${id}`);if(input)fileInputs.set(id,input);
    }
    const blockedServer = state.input === 'server' && isDemo();
    root.innerHTML = `<div id="submission-page"><div class="page-heading"><div><h1>Выгрузка результатов</h1><p>Подготовьте файл для сдачи и проверьте каждый диалог исходного набора.</p></div><span class="badge">Схема 1.0</span></div>
      <div class="submission-layout"><section class="panel"><div class="panel-heading"><h2>Подготовка файла</h2></div><form id="submission-form" class="panel-body form-stack" novalidate>
      <fieldset ${state.busy?'disabled':''}><legend class="sr-only">Настройки выгрузки</legend><div class="field-grid">
      <label>Набор<select name="dataset"><option value="dev" ${selected(state.dataset,'dev')}>DEV · 65 диалогов</option><option value="prod" ${selected(state.dataset,'prod')}>PROD · 10 чатов</option></select></label>
      <label>Название команды<input name="teamName" value="${esc(state.teamName)}" maxlength="160" autocomplete="organization"></label>
      <label class="full">Исходный JSON организаторов<input id="submission-dataset-file" type="file" accept=".json,application/json"><span class="muted small">${esc(state.datasetFile?.name || 'Выберите полный набор, чтобы проверить ID, количество и номера реплик.')} · до 20 МБ</span></label>
      <label class="full">Источник сохранённых оценок<select name="input"><option value="files" ${selected(state.input,'files')}>JSON-файлы оценщика</option><option value="server" ${selected(state.input,'server')}>Сервер команды</option></select></label>
      ${state.input==='files'?`<label class="full">Файлы оценщика<input id="submission-evaluation-files" type="file" accept=".json,application/json" multiple><span class="muted small">${state.evaluationFiles.length?`Выбрано файлов: ${state.evaluationFiles.length}.`:'Выберите отдельные оценки или JSON с массивом evaluations.'} Можно выбрать summary.json вместе с оценками: он будет пропущен.</span></label>`:`<div class="full notice ${blockedServer?'error':''}">${blockedServer?'Сейчас подключён учебный API. Для чтения настоящих оценок подключите сервер команды или выберите JSON-файлы оценщика.':'Будут прочитаны только сохранённые оценки всего исходного набора. Фильтры списка диалогов на выгрузку не влияют.'}</div>`}
      <label>Режим модели<select name="mode"><option value="">Укажите режим</option><option value="local" ${selected(state.mode,'local')}>Локальная</option><option value="external_api" ${selected(state.mode,'external_api')}>Внешний API</option><option value="hybrid" ${selected(state.mode,'hybrid')}>Гибридный</option></select></label>
      <label>Название модели<input name="modelName" value="${esc(state.modelName)}" maxlength="500" placeholder="Фактически использованные модели"></label>
      <label class="full">Версия оценок<select name="source"><option value="original" ${selected(state.source,'original')}>Исходные ответы AI</option><option value="final" ${selected(state.source,'final')}>Финальные ответы после пересмотра</option></select><span class="muted small">По умолчанию выбраны исходные ответы AI. Приложение к регламенту не уточняет выбор после пересмотра.</span></label>
      </div><p class="muted small">Название модели заполняется из оценок, если поле пустое. Для Anthropic режим определяется как внешний API. Для остальных источников укажите его самостоятельно.</p>
      <button class="btn btn-primary" type="submit" ${blockedServer?'disabled':''}>${state.busy?'Читаем результаты…':'Проверить результаты'}</button></fieldset>
      <p id="submission-progress" class="small muted" role="status">${esc(state.progress)}</p></form></section>
      <aside class="panel submission-guide"><div class="panel-heading"><h2>Перед сдачей</h2></div><div class="panel-body"><ol class="submission-steps"><li><strong>Проверьте исходный набор</strong><span>DEV: 60 чатов и 5 звонков. PROD: 10 контрольных чатов. Исходные ID сохраняются.</span></li><li><strong>Проверьте результаты</strong><span>Восемь критериев, исходные шкалы, N/A и балл. Реплики в файле нумеруются с 1.</span></li><li><strong>Сохраните в репозиторий</strong><span>Скачайте JSON и поместите его в <code id="submission-target">${target()}</code>. Затем сделайте commit и push в открытый репозиторий команды.</span></li></ol><p class="small muted">Экспорт читает готовые оценки. Новый вызов модели не запускается. Учебные и mock-оценки для сдачи запрещены.</p><a class="text-btn" href="#dialogs">К диалогам →</a></div></aside></div>
      <section id="submission-result" class="submission-result" aria-live="polite"></section></div>`;
    for(const [id,input] of fileInputs) {
      const files=id==='submission-dataset-file'?(state.datasetFile?[state.datasetFile]:[]):state.evaluationFiles;
      if(files.length===input.files.length && files.every((file,index)=>file===input.files[index])) root.querySelector(`#${id}`)?.replaceWith(input);
    }
    renderResult();
  }
  function renderResult() {
    const area=root.querySelector('#submission-result');
    if (!area) return;
    const issueList = (items, title, error=false) => items.length ? `<div class="notice ${error?'error':''}"><h2>${esc(title)} · ${items.length}</h2><ul class="submission-issues">${items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></div>` : '';
    const document=state.prepared;
    const failures=document?.results.filter(row=>row.status==='error').length || 0;
    const needsAck=state.warnings.length>0 || failures>0;
    area.innerHTML = issueList(state.errors,'Файл пока нельзя скачать',true) + (document?`<div class="panel"><div class="panel-heading"><h2>Формат проверен</h2><span class="badge badge-green">${document.results.length} результатов</span></div><div class="panel-body"><div class="submission-summary"><div><span class="muted small">Успешно</span><strong>${document.results.length-failures}</strong></div><div><span class="muted small">С ошибкой</span><strong class="${failures?'danger':''}">${failures}</strong></div><div><span class="muted small">Команда</span><strong>${esc(document.team_name)}</strong></div></div><p class="small">Модель: ${esc(document.model.name)} · ${esc(document.model.mode)}. ${state.source==='original'?'Исходные ответы AI.':'Финальные ответы после пересмотра.'}</p>${failures?'<div class="notice error">Есть диалоги со статусом error. Они остаются в файле с пустыми критериями и score: null. Можно исправить оценки и повторить проверку перед сдачей.</div>':''}${issueList(state.warnings,'Проверьте предупреждения')}${needsAck?`<label class="submission-ack"><input id="submission-acknowledge" type="checkbox" ${state.acknowledged?'checked':''}>Я проверил предупреждения${failures?' и записи со статусом error':''} и хочу сохранить этот файл.</label>`:''}<div class="actions"><button class="btn btn-primary" type="button" data-submission-action="download" ${needsAck&&!state.acknowledged?'disabled':''}>Скачать results.json</button><span class="small muted">Для ${target()}</span></div><p class="small muted">Скачивание не записывает файл в git и не отправляет результаты организаторам.</p></div></div>`:issueList(state.warnings,'Предупреждения'));
  }
  async function readJson(file) {
    if (!file || file.size>LIMIT) throw new Error('Выберите JSON-файл размером не более 20 МБ.');
    try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()).replace(/^\uFEFF/,'')); }
    catch { throw new Error('Не удалось прочитать JSON. Проверьте формат и кодировку UTF-8.'); }
  }
  function metadata(entries) {
    const evaluations=entries.flatMap(entry=>entry.evaluation?[entry.evaluation]:[]);
    if (!state.modelName.trim()) { state.modelName=unique(evaluations.flatMap(evaluation=>[evaluation.model,...(Array.isArray(evaluation.calls)?evaluation.calls.map(call=>call?.model):[])]).filter(name=>typeof name==='string'&&name.trim())).join(', ');automatic.modelName=true; }
    if (!state.mode) {
      const modes=unique(evaluations.map(evaluation=>evaluation.model_mode || (evaluation.provider==='anthropic'?'external_api':null)).filter(Boolean));
      if (modes.length===1 && evaluations.every(evaluation=>evaluation.model_mode || evaluation.provider==='anthropic')) {state.mode=modes[0];automatic.mode=true;}
    }
  }
  async function prepare() {
    if (state.busy) return;
    invalidate(); state.progress=''; state.busy=true;
    for(const name of ['modelName','mode'])if(automatic[name])state[name]='';
    const api=getApi(); state.serverApi=state.input==='server'?api:null;
    render();
    try {
      const source=parseDatasetSource(await readJson(state.datasetFile),{dataset:state.dataset});
      state.errors.push(...source.errors); state.warnings.push(...source.warnings);
      if (state.errors.length) return;
      let entries;
      if (state.input==='server') {
        const collected=await collectServerEntries(api,source.dialogs,{onProgress:({completed,total})=>{
          state.progress=`Прочитано ${completed} из ${total} диалогов.`;
          const status=root.querySelector('#submission-progress');if(status)status.textContent=state.progress;
        }});
        if (api!==getApi()) { state.errors.push('Подключение изменилось во время чтения. Повторите проверку.'); return; }
        entries=collected.entries; state.errors.push(...collected.errors); state.warnings.push(...collected.warnings);
      } else {
        if (!state.evaluationFiles.length || state.evaluationFiles.length>200 || state.evaluationFiles.reduce((sum,file)=>sum+file.size,0)>50*1024*1024) throw new Error('Выберите от 1 до 200 файлов оценщика общим размером до 50 МБ.');
        const files=[];
        for (const file of state.evaluationFiles) files.push({name:file.name,document:await readJson(file)});
        const parsed=parseEvaluationFiles(files);
        state.errors.push(...parsed.errors); state.warnings.push(...parsed.warnings);
        if (state.errors.length) return;
        const expected=new Set(source.dialogs.map(dialog=>dialog.conversation_id));
        const byId=new Map(parsed.evaluations.map(evaluation=>[evaluation.conversation_id,evaluation]));
        if (parsed.evaluations.some(evaluation=>!expected.has(evaluation.conversation_id))) state.errors.push('Среди оценок есть ID вне выбранного исходного набора.');
        const missing=source.dialogs.filter(dialog=>!byId.has(dialog.conversation_id)).length;
        if (missing) state.errors.push(`Не хватает сохранённых результатов: ${missing}. Загрузите оценки или явные записи об ошибке для всех диалогов.`);
        entries=source.dialogs.map(dialog=>{
          const evaluation=byId.get(dialog.conversation_id);
          if (evaluation?.error) return {dialog,evaluation,error:'Оценщик завершил обработку диалога с ошибкой. Подробности в локальном журнале оценщика.'};
          return {dialog,evaluation};
        });
      }
      if (state.errors.length) return;
      metadata(entries);
      const built=buildSubmission({dataset:state.dataset,teamName:state.teamName,model:{mode:state.mode,name:state.modelName},entries,expectedDialogs:source.dialogs,source:state.source});
      state.errors.push(...built.errors);state.warnings.push(...built.warnings);state.prepared=built.document;
    } catch (error) { state.errors.push(error.message); }
    finally { state.busy=false;state.errors=unique(state.errors);state.warnings=unique(state.warnings);if(onPage())render(); }
  }
  root.addEventListener('submit',event=>{if(event.target.id==='submission-form'){event.preventDefault();prepare();}});
  root.addEventListener('input',event=>{
    const input=event.target;
    if(input.form?.id!=='submission-form' || input.type==='file')return;
    if(['teamName','modelName'].includes(input.name)) {state[input.name]=input.value;if(input.name==='modelName')automatic.modelName=false;invalidate();renderResult();}
  });
  root.addEventListener('change',event=>{
    const input=event.target;
    if(input.id==='submission-acknowledge'){state.acknowledged=input.checked;renderResult();return;}
    if(input.form?.id!=='submission-form' || state.busy)return;
    if(input.type!=='file' && input.tagName!=='SELECT')return;
    invalidate();state.progress='';
    if(input.id==='submission-dataset-file') state.datasetFile=input.files[0] || null;
    else if(input.id==='submission-evaluation-files') state.evaluationFiles=[...input.files];
    else if(['dataset','input','mode','source'].includes(input.name)) {
      state[input.name]=input.value;
      if(input.name==='mode')automatic.mode=false;
      if(input.name==='dataset'){state.datasetFile=null;state.evaluationFiles=[];}
    }
    if(input.type==='file' || ['dataset','input'].includes(input.name))for(const name of ['modelName','mode'])if(automatic[name])state[name]='';
    render();
  });
  root.addEventListener('click',event=>{
    if(!event.target.closest('[data-submission-action="download"]'))return;
    const failures=state.prepared?.results.some(row=>row.status==='error');
    if(!state.prepared || state.busy || ((state.warnings.length || failures)&&!state.acknowledged))return;
    if(state.input==='server' && state.serverApi!==getApi()){invalidate();render();notify('Подключение изменилось. Повторите проверку.',true);return;}
    const blob=new Blob([JSON.stringify(state.prepared,null,2)+'\n'],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='results.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    notify(`Файл подготовлен. Сохраните его как ${target()}.`);
  });
  return { render };
}
