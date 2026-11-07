import { useEffect, useRef, useState, type FormEvent } from 'react';
import { buildSubmission } from '../submission.mjs';
import { parseDatasetSource, parseEvaluationFiles, collectServerEntries } from '../submission-source.mjs';
import { translate as t, getLocale } from './i18n';
import { submissionMessages } from './messages/submission';
import { Icon } from './shared';
import type { Api, DialogRecord, Notify } from './types';

const LIMIT = 20 * 1024 * 1024;
type Dataset = 'dev' | 'prod';
type Mode = '' | 'local' | 'external_api' | 'hybrid';
type JsonFile = Pick<File, 'name' | 'size' | 'arrayBuffer'>;
interface Fields { dataset: Dataset; teamName: string; mode: Mode; modelName: string; source: 'original' | 'final'; input: 'files' | 'server' }
interface SubmissionDocument { schema_version: '1.0'; team_name: string; model: { mode: string; name: string }; results: { conversation_id: string; status: 'ok' | 'error'; criteria: unknown[]; score: unknown; error?: string }[] }
interface Preparation { document: SubmissionDocument | null; errors: string[]; warnings: string[]; modelName: string; mode: Mode; inferred: { modelName: boolean; mode: boolean } }
interface SavedEvaluation { conversation_id: string; model?: string; provider?: string; model_mode?: Mode; calls?: { model?: string }[]; error?: unknown; [key: string]: unknown }
interface Entry { dialog: DialogRecord; evaluation?: SavedEvaluation; error?: string }
const unique = <T,>(values: T[]) => [...new Set(values)];

export async function readSubmissionJson(file: JsonFile | null): Promise<unknown> {
  if (!file || file.size > LIMIT) throw new Error('Выберите JSON-файл размером не более 20 МБ.');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).replace(/^\uFEFF/, '')); }
  catch { throw new Error('Не удалось прочитать JSON. Проверьте формат и кодировку UTF-8.'); }
}

/** Connect the existing strict validator to both saved-result sources; never invoke a model. */
export async function prepareSubmissionInput({ fields, datasetFile, evaluationFiles, api, onProgress }: {
  fields: Fields; datasetFile: JsonFile | null; evaluationFiles: JsonFile[]; api: Api;
  onProgress?: (value: { completed: number; total: number }) => void;
}): Promise<Preparation> {
  const result: Preparation = { document: null, errors: [], warnings: [], modelName: fields.modelName, mode: fields.mode, inferred: { modelName: false, mode: false } };
  try {
    const source = parseDatasetSource(await readSubmissionJson(datasetFile), { dataset: fields.dataset }) as { dialogs: DialogRecord[]; errors: string[]; warnings: string[] };
    result.errors.push(...source.errors); result.warnings.push(...source.warnings);
    if (result.errors.length) return result;
    let entries: Entry[];
    if (fields.input === 'server') {
      const collected = await collectServerEntries(api, source.dialogs, { onProgress }) as { entries: Entry[]; errors: string[]; warnings: string[] };
      entries = collected.entries; result.errors.push(...collected.errors); result.warnings.push(...collected.warnings);
    } else {
      if (!evaluationFiles.length || evaluationFiles.length > 200 || evaluationFiles.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) throw new Error('Выберите от 1 до 200 файлов оценщика общим размером до 50 МБ.');
      const files = [];
      for (const file of evaluationFiles) files.push({ name: file.name, document: await readSubmissionJson(file) });
      const parsed = parseEvaluationFiles(files) as { evaluations: SavedEvaluation[]; errors: string[]; warnings: string[] };
      result.errors.push(...parsed.errors); result.warnings.push(...parsed.warnings);
      if (result.errors.length) return result;
      const expected = new Set(source.dialogs.map(dialog => dialog.conversation_id));
      const byId = new Map(parsed.evaluations.map(evaluation => [evaluation.conversation_id, evaluation]));
      if (parsed.evaluations.some(evaluation => !expected.has(evaluation.conversation_id))) result.errors.push('Среди оценок есть ID вне выбранного исходного набора.');
      const missing = source.dialogs.filter(dialog => !byId.has(dialog.conversation_id)).length;
      if (missing) result.errors.push(t('Не хватает сохранённых результатов: {count}. Загрузите оценки или явные записи об ошибке для всех диалогов.', { count: missing }));
      entries = source.dialogs.map(dialog => {
        const evaluation = byId.get(dialog.conversation_id);
        return evaluation?.error ? { dialog, evaluation, error: 'Оценщик завершил обработку диалога с ошибкой. Подробности в локальном журнале оценщика.' } : { dialog, evaluation };
      });
    }
    if (result.errors.length) return result;
    const evaluations = entries.flatMap(entry => entry.evaluation ? [entry.evaluation] : []);
    if (!result.modelName.trim()) {
      result.modelName = unique(evaluations.flatMap(evaluation => [evaluation.model, ...(Array.isArray(evaluation.calls) ? evaluation.calls.map(call => call?.model) : [])]).filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))).join(', ');
      result.inferred.modelName = true;
    }
    if (!result.mode) {
      const modes = unique(evaluations.map(evaluation => evaluation.model_mode || (evaluation.provider === 'anthropic' ? 'external_api' : null)).filter((mode): mode is Exclude<Mode, ''> => Boolean(mode)));
      if (modes.length === 1 && evaluations.every(evaluation => evaluation.model_mode || evaluation.provider === 'anthropic')) { result.mode = modes[0]; result.inferred.mode = true; }
    }
    const built = buildSubmission({ dataset: fields.dataset, teamName: fields.teamName, model: { mode: result.mode, name: result.modelName }, entries, expectedDialogs: source.dialogs, source: fields.source }) as Pick<Preparation, 'document' | 'errors' | 'warnings'>;
    result.document = built.document; result.errors.push(...built.errors); result.warnings.push(...built.warnings);
  } catch (error) {
    result.errors.push(error instanceof Error && Object.hasOwn(submissionMessages, error.message) ? error.message : 'Не удалось подготовить файл. Проверьте исходные данные и повторите попытку.');
  }
  result.errors = unique(result.errors); result.warnings = unique(result.warnings);
  return result;
}

export function localizeSubmissionFeedback(message: string): string {
  const locale = getLocale();
  if (locale === 'ru') return message;
  let output = message;
  output = output.replace(/отсутствует поле ([A-Za-z_]+)\./g, (_, field: string) => t('отсутствует поле {field}.', { field }))
    .replace(/тип, вес, N\/A или признак грубой ошибки изменён у ([A-Za-z0-9_]+)\./g, (_, id: string) => t('тип, вес, N/A или признак грубой ошибки изменён у {id}.', { id }))
    .replace(/у бинарного критерия ([A-Za-z0-9_]+) не должно быть шкалы\./g, (_, id: string) => t('у бинарного критерия {id} не должно быть шкалы.', { id }))
    .replace(/изменена исходная шкала ([A-Za-z0-9_]+)\./g, (_, id: string) => t('изменена исходная шкала {id}.', { id }))
    .replace(/реплика (\d+) должна содержать текст, допустимую роль и строковое время, если оно задано\./g, (_, index: string) => t('реплика {index} должна содержать текст, допустимую роль и строковое время, если оно задано.', { index }))
    .replace(/Диалогов сервера вне исходного набора: (\d+)\. Они не включены в результат\./g, (_, count: string) => t('Диалогов сервера вне исходного набора: {count}. Они не включены в результат.', { count }))
    .replace(/Исходный набор (dev|prod) должен содержать ровно (\d+) диалогов\./g, (_, dataset: string, count: string) => t('Исходный набор {dataset} должен содержать ровно {count} диалогов.', { dataset, count }));
  // Validator diagnostics contain only safe static text and numeric positions, never source content.
  for (const source of Object.keys(submissionMessages).filter(key => !key.includes('{')).sort((a, b) => b.length - a.length)) {
    if (output.includes(source)) output = output.split(source).join(submissionMessages[source][locale]);
  }
  const prefixes: [RegExp, string][] = [[/Результат (\d+)/g, 'Результат {index}'], [/Исходный диалог (\d+)/g, 'Исходный диалог {index}'], [/Диалог (\d+)/g, 'Диалог {index}'], [/Файл (\d+)/g, 'Файл {index}'], [/оценка (\d+)/g, 'оценка {index}']];
  for (const [pattern, source] of prefixes) output = output.replace(pattern, (_, index: string) => t(source, { index }));
  return output;
}

export function SubmissionWorkspace({ api, demo, teamName, notify, active, connectionError='', onSettings }: { api: Api; demo: boolean; teamName: string; notify: Notify; active: boolean; connectionError?:string; onSettings?:()=>void }) {
  const [fields, setFields] = useState<Fields>({ dataset: 'dev', teamName, mode: '', modelName: '', source: 'original', input: demo ? 'files' : 'server' });
  const [datasetFile, setDatasetFile] = useState<File | null>(null), [evaluationFiles, setEvaluationFiles] = useState<File[]>([]);
  const [result, setResult] = useState<Preparation | null>(null), [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [acknowledged, setAcknowledged] = useState(false);
  const currentApi = useRef(api), preparedApi = useRef<Api | null>(null), revision = useRef(0), running = useRef(false), automatic = useRef({ modelName: false, mode: false });
  const sourceInput = useRef<HTMLInputElement>(null), filesInput = useRef<HTMLInputElement>(null);
  currentApi.current = api;
  useEffect(() => {
    if (fields.input === 'server') { revision.current++; running.current = false; setBusy(false); setResult(null); setAcknowledged(false); setProgress(''); }
  }, [api, fields.input]);
  useEffect(() => () => { revision.current++; }, []);
  const invalidate = () => { revision.current++; setResult(null); setAcknowledged(false); setProgress(''); };
  function clearAutomatic(next: Fields) { return { ...next, modelName: automatic.current.modelName ? '' : next.modelName, mode: automatic.current.mode ? '' as Mode : next.mode }; }
  function change<K extends keyof Fields>(key: K, value: Fields[K]) {
    if (running.current) return;
    invalidate();
    if (key === 'modelName') automatic.current.modelName = false;
    if (key === 'mode') automatic.current.mode = false;
    let next = { ...fields, [key]: value };
    if (key === 'dataset') { setDatasetFile(null); setEvaluationFiles([]); if (sourceInput.current) sourceInput.current.value = ''; if (filesInput.current) filesInput.current.value = ''; }
    if (key === 'dataset' || key === 'input') next = clearAutomatic(next);
    setFields(next);
  }
  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (running.current || fields.input === 'server' && (demo || api.demo || Boolean(connectionError))) return;
    running.current = true; const run = ++revision.current, captured = api, snapshot = clearAutomatic(fields);
    setBusy(true); setResult(null); setAcknowledged(false); setProgress(''); setFields(snapshot);
    const prepared = await prepareSubmissionInput({ fields: snapshot, datasetFile, evaluationFiles, api: captured, onProgress: ({ completed, total }) => { if (run === revision.current) setProgress(t('Прочитано {completed} из {total} диалогов.', { completed, total })); } });
    if (run !== revision.current) return;
    if (snapshot.input === 'server' && captured !== currentApi.current) {
      setResult({ ...prepared, document: null, errors: ['Подключение изменилось во время чтения. Повторите проверку.'] });
    } else {
      automatic.current = prepared.inferred; preparedApi.current = snapshot.input === 'server' ? captured : null;
      setFields(previous => ({ ...previous, modelName: prepared.modelName, mode: prepared.mode })); setResult(prepared);
    }
    running.current = false; setBusy(false);
  }
  const target = `results/${fields.dataset}/results.json`;
  const failures = result?.document?.results.filter(row => row.status === 'error').length || 0;
  const needsAck = Boolean(result?.warnings.length || failures), blockedServer = fields.input === 'server' && (demo || api.demo || Boolean(connectionError));
  function download() {
    if (!result?.document || busy || needsAck && !acknowledged) return;
    if (fields.input === 'server' && preparedApi.current !== currentApi.current) { invalidate(); notify(t('Подключение изменилось. Повторите проверку.'), true); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.document, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'results.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(t('Файл подготовлен. Сохраните его как {path}.', { path: target }));
  }
  const issues = (items: string[], title: string, error = false) => items.length > 0 && <div className={`notice ${error ? 'error' : ''}`}><h2>{t(title)} · {items.length}</h2><ul className="submission-issues">{items.map((item, index) => <li key={`${index}-${item}`}>{localizeSubmissionFeedback(item)}</li>)}</ul></div>;
  if (!active) return null;
  return <div id="submission-page"><div className="page-heading"><div><h1>{t('Выгрузка результатов')}</h1><p>{t('Подготовьте файл для сдачи и проверьте каждый диалог исходного набора.')}</p></div><span className="badge">{t('Схема 1.0')}</span></div>
    <div className="submission-layout"><section className="panel"><div className="panel-heading"><h2>{t('Подготовка файла')}</h2></div><form id="submission-form" className="panel-body form-stack" noValidate onSubmit={prepare}>
      <fieldset disabled={busy}><legend className="sr-only">{t('Настройки выгрузки')}</legend><div className="field-grid">
        <label>{t('Набор')}<select name="dataset" value={fields.dataset} onChange={event => change('dataset', event.target.value as Dataset)}><option value="dev">{t('DEV · 65 диалогов')}</option><option value="prod">{t('PROD · 10 чатов')}</option></select></label>
        <label>{t('Название команды')}<input name="teamName" value={fields.teamName} maxLength={160} autoComplete="organization" onChange={event => change('teamName', event.target.value)}/></label>
        <label className="full">{t('Исходный JSON организаторов')}<input ref={sourceInput} id="submission-dataset-file" type="file" accept=".json,application/json" onChange={event => { invalidate(); setDatasetFile(event.target.files?.[0] || null); setFields(previous => clearAutomatic(previous)); }}/><span className="muted small">{datasetFile?.name || t('Выберите полный набор, чтобы проверить ID, количество и номера реплик.')} · {t('До 20 МБ на файл')}</span></label>
        <label className="full">{t('Источник сохранённых оценок')}<select name="input" value={fields.input} onChange={event => change('input', event.target.value as Fields['input'])}><option value="files">{t('JSON-файлы оценщика')}</option><option value="server">{t('Сервер команды')}</option></select></label>
        {fields.input === 'files' ? <label className="full">{t('Файлы оценщика')}<input ref={filesInput} id="submission-evaluation-files" type="file" accept=".json,application/json" multiple onChange={event => { invalidate(); setEvaluationFiles(Array.from(event.target.files || [])); setFields(previous => clearAutomatic(previous)); }}/><span className="muted small">{evaluationFiles.length ? t('Выбрано файлов: {count}.', { count: evaluationFiles.length }) : t('Выберите отдельные оценки или JSON с массивом evaluations.')} {t('Можно выбрать summary.json вместе с оценками: он будет пропущен.')}</span></label> : <div className={`full notice ${blockedServer ? 'error' : ''}`}>{t(connectionError ? 'Адрес API некорректен. Исправьте подключение или выберите JSON-файлы.' : blockedServer ? 'Сейчас подключён учебный API. Для чтения настоящих оценок подключите сервер команды или выберите JSON-файлы оценщика.' : 'Будут прочитаны только сохранённые оценки всего исходного набора. Фильтры списка диалогов на выгрузку не влияют.')}{connectionError && onSettings && <button type="button" className="text-btn" onClick={onSettings}>{t('Настроить API')}</button>}</div>}
        <label>{t('Режим модели')}<select name="mode" value={fields.mode} onChange={event => change('mode', event.target.value as Mode)}><option value="">{t('Укажите режим')}</option><option value="local">{t('Локальная')}</option><option value="external_api">{t('Внешний API')}</option><option value="hybrid">{t('Гибридный')}</option></select></label>
        <label>{t('Название модели')}<input name="modelName" value={fields.modelName} maxLength={500} placeholder={t('Фактически использованные модели')} onChange={event => change('modelName', event.target.value)}/></label>
        <label className="full">{t('Версия оценок')}<select name="source" value={fields.source} onChange={event => change('source', event.target.value as Fields['source'])}><option value="original">{t('Исходные ответы AI')}</option><option value="final">{t('Финальные ответы после пересмотра')}</option></select><span className="muted small">{t('По умолчанию выбраны исходные ответы AI. Приложение к регламенту не уточняет выбор после пересмотра.')}</span></label>
      </div><p className="muted small">{t('Название модели заполняется из оценок, если поле пустое. Для Anthropic режим определяется как внешний API. Для остальных источников укажите его самостоятельно.')}</p><button className="btn btn-primary" type="submit" disabled={blockedServer}>{t(busy ? 'Читаем результаты…' : 'Проверить результаты')}</button></fieldset><p id="submission-progress" className="small muted" role="status">{progress}</p>
    </form></section><aside className="panel submission-guide"><div className="panel-heading"><h2>{t('Перед сдачей')}</h2></div><div className="panel-body"><ol className="submission-steps"><li><strong>{t('Проверьте исходный набор')}</strong><span>{t('DEV: 60 чатов и 5 звонков. PROD: 10 контрольных чатов. Исходные ID сохраняются.')}</span></li><li><strong>{t('Проверьте результаты')}</strong><span>{t('Восемь критериев, исходные шкалы, N/A и балл. Реплики в файле нумеруются с 1.')}</span></li><li><strong>{t('Сохраните в репозиторий')}</strong><span>{t('Скачайте JSON и поместите его в')} <code id="submission-target">{target}</code>. {t('Затем сделайте commit и push в открытый репозиторий команды.')}</span></li></ol><p className="small muted">{t('Экспорт читает готовые оценки. Новый вызов модели не запускается. Учебные и mock-оценки для сдачи запрещены.')}</p><a className="text-btn" href="#dialogs">{t('К диалогам')} <Icon name="arrow-right"/></a></div></aside></div>
    <section id="submission-result" className="submission-result" aria-live="polite">{result && <>{issues(result.errors, 'Файл пока нельзя скачать', true)}{result.document ? <div className="panel"><div className="panel-heading"><h2>{t('Формат проверен')}</h2><span className="badge badge-green">{t('{count} результатов', { count: result.document.results.length })}</span></div><div className="panel-body"><div className="submission-summary"><div><span className="muted small">{t('Успешно')}</span><strong>{result.document.results.length - failures}</strong></div><div><span className="muted small">{t('С ошибкой')}</span><strong className={failures ? 'danger' : ''}>{failures}</strong></div><div><span className="muted small">{t('Команда')}</span><strong>{result.document.team_name}</strong></div></div><p className="small">{t('Модель')}: {result.document.model.name} · {result.document.model.mode}. {t(fields.source === 'original' ? 'Исходные ответы AI' : 'Финальные ответы после пересмотра')}.</p>{failures > 0 && <div className="notice error">{t('Есть диалоги со статусом error. Они остаются в файле с пустыми критериями и score: null. Можно исправить оценки и повторить проверку перед сдачей.')}</div>}{issues(result.warnings, 'Проверьте предупреждения')}{needsAck && <label className="submission-ack"><input id="submission-acknowledge" type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/>{t(failures ? 'Я проверил предупреждения и записи со статусом error и хочу сохранить этот файл.' : 'Я проверил предупреждения и хочу сохранить этот файл.')}</label>}<div className="actions"><button className="btn btn-primary" type="button" data-submission-action="download" disabled={needsAck && !acknowledged || busy} onClick={download}><Icon name="download"/>{t('Скачать results.json')}</button><span className="small muted">{t('Для {path}', { path: target })}</span></div><p className="small muted">{t('Скачивание не записывает файл в git и не отправляет результаты организаторам.')}</p></div></div> : issues(result.warnings, 'Предупреждения')}</>}</section>
  </div>;
}
