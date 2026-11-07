import type { ReactNode } from 'react';
import type { Appeal, Checklist, DialogRecord, Evaluation, Filters, Health, ScoreSort } from './types';
import { Icon, EmptyState, channel, dialogTitle, label, number } from './shared';
import { Slot } from './slots';
import { EvaluationView } from './result';
import { useState } from 'react';
import { ActiveFilters, DensitySwitch, readDensity, SelectionSummary } from './list-tools';
import { PrintButton, ReviewSummary } from './review-tools';
import { PrintReport } from './print-report';
import { translate as t, translatePlural, formatDecimal } from './i18n';
import { plainTurnRefs, scoreTone, turnTime } from './text';

export function StatusBadge({ record }: { record: DialogRecord }) {
  const status = record.status || (record.evaluation_id ? 'completed' : 'pending');
  return <span className={`badge ${['completed', 'done', 'evaluated'].includes(status) ? 'badge-green' : status === 'failed' ? 'badge-red' : ''}`}><span className="mini-dot" aria-hidden="true"/>{label(status)}</span>;
}
/** List status column: only what needs attention. A finished evaluation needs no label. */
export function RowStatuses({ record }: { record: DialogRecord }) {
  const status = record.status || (record.evaluation_id ? 'evaluated' : 'new');
  const items: { key: string; text: string; tone: string; icon?: string }[] = [];
  if (record.gross_error) items.push({ key: 'gross', text: t('Грубая ошибка'), tone: 'badge-red gross-error-badge', icon: 'alert' });
  if ((record.open_appeals ?? 0) > 0) items.push({ key: 'appeal', text: t('Апелляция'), tone: 'badge-amber' });
  if (record.needs_review) items.push({ key: 'review', text: t('Нужна проверка'), tone: 'badge-amber' });
  if (status === 'error' || status === 'failed') items.push({ key: 'error', text: t('Ошибка оценки'), tone: 'badge-red' });
  if (status === 'pending' || status === 'queued' || status === 'running') items.push({ key: 'pending', text: t('Оценивается'), tone: 'badge-pending' });
  if (status === 'new' || !record.evaluation_id && !items.length) items.push({ key: 'new', text: t('Без оценки'), tone: 'badge-quiet' });
  return <div className="row-statuses">{items.map(item => <span key={item.key} className={`badge ${item.tone}`}>{item.icon && <Icon name={item.icon}/>}{item.text}</span>)}</div>;
}
export function ScorePill({ total }: { total: unknown }) {
  const tone = scoreTone(total);
  if (!tone) return <span className="score-empty" aria-label={t('Нет балла')}>—</span>;
  return <span className={`score-pill score-${tone}`}>{number(total)}</span>;
}
export function DialogRows({ rows, selected }: { rows: DialogRecord[]; selected: Set<string> }) {
  return <>{rows.map(record => <tr key={`${record.conversation_id}:${selected.has(record.conversation_id)}`} className={selected.has(record.conversation_id) ? 'selected' : ''}>
    <td><input type="checkbox" data-select={record.conversation_id} aria-label={t('Выбрать {id}', { id: record.conversation_id })} defaultChecked={selected.has(record.conversation_id)}/></td>
    <td><button className="dialog-title" data-open={record.conversation_id}>{dialogTitle(record)}</button><span className="dialog-subtitle">{record.conversation_id}</span>
      {record.gross_error && record.gross_error_reason && <span className="dialog-gross-reason"><Icon name="alert"/><span>{plainTurnRefs(record.gross_error_reason)}</span></span>}</td>
    <td><span className="channel-icon" aria-hidden="true"><Icon name={record.channel === 'voice call' ? 'phone' : 'dialogs'}/></span>{channel(record.channel)}</td>
    <td><span className="badge">{record.language}</span></td><td><RowStatuses record={record}/></td>
    <td className="score-cell"><ScorePill total={record.total}/></td>
    <td><button className="icon-btn" data-open={record.conversation_id} aria-label={t('Открыть {id}', { id: record.conversation_id })}><Icon name="chevron"/></button></td>
  </tr>)}</>;
}
export interface ListStats { total: number; completed: number; average: number | null; gross: number }
/** One-line summary. Two figures double as filters: evaluated conversations and gross errors. */
export function DialogKpis({ stats, status }: { stats: ListStats; status: string }) {
  return <section className="kpi-bar" aria-label={t('Сводка по диалогам')}>
    <div className="kpi"><span className="kpi-label">{t('Всего диалогов')}</span><strong className="kpi-value">{number(stats.total)}</strong></div>
    <button type="button" className="kpi kpi-action" data-action="status-filter" data-status="completed" aria-pressed={status === 'completed'} title={t('Показать только диалоги с оценкой')}>
      <span className="kpi-label">{t('С оценкой')}</span><strong className="kpi-value">{number(stats.completed)}</strong></button>
    <div className="kpi"><span className="kpi-label">{t('Средний балл')}</span><strong className="kpi-value">{number(stats.average)}</strong></div>
    <button type="button" className={`kpi kpi-action ${stats.gross ? 'kpi-danger' : ''}`} data-action="status-filter" data-status="gross" aria-pressed={status === 'gross'} title={t('Показать только диалоги с грубой ошибкой')}>
      <span className="kpi-label">{t('Грубые ошибки')} <span className="kpi-link">· {t(status === 'gross' ? 'Показаны' : 'Показать')}</span></span><strong className="kpi-value">{number(stats.gross)}</strong></button>
  </section>;
}
export function ScoreHeader({ sort }: { sort: ScoreSort }) {
  return <th className="score-heading" aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none'}>
    <button type="button" className="sort-button" data-action="sort-score" title={t(sort === 'asc' ? 'Сейчас по возрастанию. Нажмите: по убыванию' : sort === 'desc' ? 'Сейчас по убыванию. Нажмите: исходный порядок' : 'Сортировать по баллу')}>
      {t('Балл')}<Icon name={sort === 'asc' ? 'sort-asc' : sort === 'desc' ? 'sort-desc' : 'sort'}/>
    </button>
  </th>;
}
export function DialogsView({ rows, stats, filters, sort = null }: { rows: DialogRecord[]; stats: ListStats; filters: Filters; sort?: ScoreSort }) {
  const [density, setDensity] = useState(readDensity);
  return <>
    <div className="page-heading page-heading-compact" data-reveal><div><h1>{t('Диалоги')}</h1></div><div className="actions"><button className="btn" data-action="import"><Icon name="download"/>{t('Импорт набора')}</button><button className="btn" data-action="upload"><Icon name="upload"/>{t('Загрузить JSON')}</button></div></div>
    <Slot name="dialog-kpis" fallback={<DialogKpis stats={stats} status={filters.status}/>}/>
    <section className="panel dialog-list" data-density={density} data-reveal><div className="panel-heading"><h2>{t('Все разговоры')} <span className="muted small">/ {rows.length}</span></h2><DensitySwitch value={density} onChange={setDensity}/></div>
      <div className="filters"><label className="search-field"><span className="filter-label">{t('Поиск диалога')}</span><span className="search-input"><span aria-hidden="true"><Icon name="search"/></span><input id="search-dialogs" type="search" placeholder={t('Найти по ID или содержимому')} defaultValue={filters.query}/></span></label>
        <label><span className="filter-label">{t('Канал')}</span><select data-filter="channel" defaultValue={filters.channel}><option value="">{t('Все каналы')}</option><option value="agent chat">{t('Чаты')}</option><option value="voice call">{t('Звонки')}</option></select></label>
        <label><span className="filter-label">{t('Язык')}</span><select data-filter="language" defaultValue={filters.language}><option value="">{t('Все языки')}</option><option value="RU">{t('Русский')}</option><option value="KZ">{t('Қазақша')}</option><option value="EN">{t('English')}</option></select></label>
        <label><span className="filter-label">{t('Статус оценки')}</span><select data-filter="status" defaultValue={filters.status}><option value="">{t('Все статусы')}</option><option value="completed">{t('С оценкой')}</option><option value="pending">{t('Без оценки')}</option><option value="gross">{t('Грубая ошибка')}</option></select></label>
      </div><Slot name="active-filters" fallback={<ActiveFilters filters={filters}/>}/>
      <div className="list-toolbar"><Slot name="list-selection" fallback={<SelectionSummary count={0}/>}/><button id="evaluate-selected" className="btn btn-primary" data-action="evaluate-selected" disabled>{t('Оценить выбранные')} <Icon name="arrow-right"/></button></div>
      <div className="table-scroll" role="region" aria-label={t('Список диалогов')} tabIndex={0}><table><thead><tr><th data-select-label={t("Выбрать все диалоги")}><input id="select-all" type="checkbox" aria-label={t('Выбрать все видимые диалоги')}/></th><th>{t('Диалог')}</th><th>{t('Канал')}</th><th>{t('Язык')}</th><th>{t('Статус')}</th><Slot name="score-heading" fallback={<ScoreHeader sort={sort}/>}/><th><span className="sr-only">{t('Открыть')}</span></th></tr></thead><tbody id="dialog-rows"><Slot name="dialog-rows"/></tbody></table></div>
      <div id="list-empty" hidden><Slot name="list-empty"/></div><div className="table-foot"><span id="visible-count"/><span>{t('Оценка по выбранному чек-листу')}</span></div>
    </section>
  </>;
}

export function DialogView({ record, evaluation, checklist, checklists, appeals, demo, busy }: { record: DialogRecord; evaluation: Evaluation | null; checklist?: Checklist; checklists: Checklist[]; appeals: Appeal[]; demo: boolean; busy: boolean }) {
  const roles: Record<string, string> = { operator: t('Оператор'), client: t('Клиент'), bot: t('Бот'), system: t('Система') };
  const transcript = record.transcript || [];
  return <><div className="dialog-workspace">
    <a href="#dialogs" className="back-link"><Icon name="arrow-left"/> {t('Все диалоги')}</a>
    <div className="detail-heading" data-reveal><div><h1>{dialogTitle(record, 'Карточка диалога')}</h1><div className="detail-meta"><span className="muted small mono">{record.conversation_id}</span><span className="badge">{channel(record.channel)}</span><span className="badge">{record.language}</span><StatusBadge record={{ ...record, evaluation_id: evaluation?.id, total: evaluation?.total }}/></div></div><div className="detail-actions"><PrintButton/><label><span className="sr-only">{t('Чек-лист для оценки')}</span><select id="evaluation-checklist" defaultValue={evaluation?.checklist_id}>{checklists.map(item => <option key={`${item.id}@${item.version}`} value={item.id}>{item.name} · v{item.version}</option>)}</select></label><button className="btn btn-primary" data-action="evaluate-dialog" disabled={busy || !checklists.length}>{t(evaluation ? 'Оценить заново' : 'Оценить диалог')} <Icon name="arrow-right"/></button></div></div>
    {evaluation && <ReviewSummary evaluation={evaluation}/>}
    <div className="split-view detail-top"><section className="panel" data-reveal><div className="panel-heading"><h2>{t('Транскрипт')}</h2><span className="muted small">{t('{count} реплик', { count: transcript.length })}</span></div>
      {record.channel === 'voice call' && <div className="audio-block" id="audio-block"><Slot name="audio-block" fallback={<><button className="btn btn-small" data-action="audio">{t('Загрузить запись')}</button><p className="audio-caption">{t('Запись загружается по свежей ссылке.')}</p></>}/></div>}
      <div className="quiet-line">{t('Оценивается оператор. Бот и система дают контекст.')}</div><div className="transcript" id="transcript">{transcript.map((turn, index) => <article id={`turn-${index}`} className={`turn turn-${Object.hasOwn(roles, turn.speaker) ? turn.speaker : 'system'}`} tabIndex={-1} key={index}><div className="turn-meta"><strong>{roles[turn.speaker] || turn.speaker}</strong><span>№ {index + 1}{turnTime(turn) && ` · ${turnTime(turn)}`}</span><span className="turn-evidence-label">{t('Доказательство')}</span></div><p>{turn.text}</p></article>)}</div>
    </section><section className="panel" id="evaluation-panel" data-reveal><EvaluationView evaluation={evaluation} checklist={checklist} appeals={appeals} dialog={record} demo={demo}/></section></div>
  </div><PrintReport record={record} evaluation={evaluation} checklist={checklist} appeals={appeals} demo={demo}/></>;
}
export function LoadingView() { return <div className="panel loading" aria-label={t('Загрузка')} aria-busy="true"><div className="skeleton wide"/><div className="skeleton"/><div className="skeleton"/><div className="skeleton wide"/></div>; }
export function ErrorView({ message }: { message: string }) { return <><div className="page-heading" data-reveal><div><h1>{t('Нет подключения к данным')}</h1><p>{t('Интерфейс работает, но сервер пока не ответил.')}</p></div></div><section className="panel" data-reveal><EmptyState title={t('Не удалось получить данные')} text={message} actions={<><button className="btn btn-primary" data-action="retry">{t('Повторить')}</button><button className="btn" data-action="settings">{t('Настроить API')}</button><button className="btn btn-ghost" data-action="demo">{t('Открыть учебный пример')}</button></>}/></section></>; }

/** Price and duration of a run, from the server's recent real evaluations. Shown above the paid-run confirmation. */
export function EstimateNote({ health, count }: { health?: Health | null; count: number }) {
  if (!health) return null;
  if (health.provider === 'mock') return <p className="estimate-note estimate-free">{t('Тестовый режим: модель не вызывается, оценка бесплатная.')}</p>;
  if (health.provider === 'demo') return <p className="estimate-note estimate-free">{t('Учебный пример: модель не вызывается, оценка бесплатная.')}</p>;
  const model = health.model || 'AI';
  const estimate = health.estimate;
  const cost = estimate?.cost_per_dialog_usd;
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return <p className="estimate-note">{t('Модель {model}. Примерную цену покажем после первых оценок.', { model })}</p>;
  const perDialog = typeof estimate?.seconds_per_dialog === 'number' && estimate.seconds_per_dialog > 0 ? estimate.seconds_per_dialog : null;
  const workers = Math.max(1, Math.floor(Number(estimate?.workers) || 1));
  const seconds = perDialog == null ? null : Math.ceil(count / workers) * perDialog;
  const time = seconds == null ? null : seconds < 60 ? t('{s} с', { s: Math.max(1, Math.ceil(seconds)) }) : t('{m} мин', { m: Math.ceil(seconds / 60) });
  const total = `$${formatDecimal(count * cost, 2)}`;
  const first = time
    ? translatePlural(count, { one: 'Оценка {count} диалога: ≈ {cost} и около {time}.', few: 'Оценка {count} диалогов: ≈ {cost} и около {time}.', many: 'Оценка {count} диалогов: ≈ {cost} и около {time}.' }, { cost: total, time })
    : translatePlural(count, { one: 'Оценка {count} диалога: ≈ {cost}.', few: 'Оценка {count} диалогов: ≈ {cost}.', many: 'Оценка {count} диалогов: ≈ {cost}.' }, { cost: total });
  const basis = translatePlural(Number(estimate?.based_on) || 0, { one: 'Модель {model}, в среднем {cost} за диалог по {count} последней оценке.', few: 'Модель {model}, в среднем {cost} за диалог по {count} последним оценкам.', many: 'Модель {model}, в среднем {cost} за диалог по {count} последним оценкам.' }, { model, cost: `$${formatDecimal(cost, 2, 3)}` });
  return <p className="estimate-note"><strong>{first}</strong> {basis}</p>;
}

export type ModalProps = { kind: 'appeal'; criterionId: string; title: string } | { kind: 'settings'; demo: boolean; baseUrl: string } | { kind: 'import'; demo: boolean } | { kind: 'evaluate'; count: number; selectedChecklist?: string; checklists: Checklist[]; demo: boolean };
export function ModalContents({ data }: { data: ModalProps }) {
  let content: ReactNode;
  if (data.kind === 'appeal') content = <><p className="modal-description">{data.title}. {t('Проверяющий увидит комментарий вместе с оценкой и фрагментом диалога.')}</p><form id="appeal-form" data-criterion-id={data.criterionId} className="form-stack"><label>{t('Почему вы не согласны')}<textarea name="comment" required maxLength={4000} placeholder={t('Укажите, какой фрагмент стоит проверить')} rows={4}/></label><div className="form-actions"><Cancel/><button type="submit" className="btn btn-primary">{t('Подать апелляцию')}</button></div></form></>;
  else if (data.kind === 'settings') content = <><p className="modal-description">{t('Укажите адрес сервера вашей команды. Ключи AI и ссылка организаторов остаются на сервере.')}</p><form id="settings-form" className="form-stack"><fieldset><legend>{t('Источник данных')}</legend><div className="form-stack"><label><input type="radio" name="mode" value="api" defaultChecked={!data.demo}/> {t('Сервер команды')}</label><label><input type="radio" name="mode" value="demo" defaultChecked={data.demo}/> {t('Учебный пример без AI')}</label></div></fieldset><label>{t('Базовый адрес API')}<input name="baseUrl" defaultValue={data.baseUrl} placeholder="http://127.0.0.1:8000/api"/></label><p className="muted small">{t('Для сервера на том же адресе используйте /api. Учебные изменения сохраняются только в этом браузере.')}</p><div className="form-actions"><Cancel/><button className="btn btn-primary" type="submit">{t('Подключиться')}</button></div></form></>;
  else if (data.kind === 'import') content = <><p className="modal-description">{t('Сервер получит диалоги по group_id. Для контрольного набора введите значение от организаторов.')}</p><form id="import-form" className="form-stack"><label>{t('Группа набора')}<input name="groupId" required maxLength={100} defaultValue="DEV" autoComplete="off"/></label>{data.demo && <div className="notice">{t('Учебный режим не загружает набор организаторов. Для импорта подключите сервер команды.')}</div>}<div className="form-actions"><Cancel/><button className="btn btn-primary" type="submit">{t(data.demo ? 'Проверить учебный запрос' : 'Импортировать набор')}</button></div></form></>;
  else content = <><p className="modal-description">{t('Диалогов: {count}. Оценка пройдёт в фоне, прогресс появится над рабочим экраном.', { count: data.count })}</p><form id="evaluate-form" className="form-stack"><label>{t('Чек-лист')}<select name="checklistId" defaultValue={data.selectedChecklist}>{data.checklists.map(item => <option key={`${item.id}@${item.version}`} value={item.id}>{item.name} · v{item.version}</option>)}</select></label><div id="evaluate-estimate" aria-live="polite"><Slot name="evaluate-estimate"/></div><label className="confirm-option"><input name="confirm" type="checkbox" required/>{t(data.demo ? 'Понимаю, что это учебная оценка без AI' : 'Подтверждаю запуск AI-оценки. Если сервер использует платный API, возможны расходы')}</label><div className="form-actions"><Cancel/><button type="submit" className="btn btn-primary">{t(data.count === 1 ? 'Оценить диалог' : 'Оценить диалоги')}</button></div></form></>;
  return content;
}
function Cancel() { return <button type="button" className="btn" data-action="close-modal">{t('Отмена')}</button>; }
