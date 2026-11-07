import type { ReactNode } from 'react';
import type { Appeal, Checklist, DialogRecord, Evaluation, Filters } from './types';
import { Icon, EmptyState, channel, label, number } from './shared';
import { Slot } from './slots';
import { EvaluationView } from './result';
import { useState } from 'react';
import { ActiveFilters, DensitySwitch, readDensity, SelectionSummary } from './list-tools';
import { PrintButton, ReviewSummary } from './review-tools';
import { PrintReport } from './print-report';
import { translate as t } from './i18n';

export function StatusBadge({ record }: { record: DialogRecord }) {
  const status = record.status || (record.evaluation_id ? 'completed' : 'pending');
  return <span className={`badge ${['completed', 'done', 'evaluated'].includes(status) ? 'badge-green' : status === 'failed' ? 'badge-red' : ''}`}><span className="mini-dot" aria-hidden="true"/>{label(status)}</span>;
}
export function DialogRows({ rows, selected }: { rows: DialogRecord[]; selected: Set<string> }) {
  return <>{rows.map(record => <tr key={`${record.conversation_id}:${selected.has(record.conversation_id)}`} className={selected.has(record.conversation_id) ? 'selected' : ''}>
    <td><input type="checkbox" data-select={record.conversation_id} aria-label={t('Выбрать {id}', { id: record.conversation_id })} defaultChecked={selected.has(record.conversation_id)}/></td>
    <td><button className="dialog-title" data-open={record.conversation_id}>{record.title || record.subject || record.transcript?.find(turn => turn.speaker === 'client')?.text || t('Диалог поддержки')}</button><span className="dialog-subtitle">{record.conversation_id}</span></td>
    <td><span className="channel-icon" aria-hidden="true"><Icon name={record.channel === 'voice call' ? 'phone' : 'dialogs'}/></span>{channel(record.channel)}</td>
    <td><span className="badge">{record.language}</span></td><td><div className="row-statuses"><StatusBadge record={record}/>{record.gross_error && <span className="badge badge-red gross-error-badge"><Icon name="alert"/>{t('Грубая ошибка')}</span>}</div></td>
    <td className="score-cell">{number(record.total)} {typeof record.total === 'number' && <span>/ 100</span>}</td>
    <td><button className="icon-btn" data-open={record.conversation_id} aria-label={t('Открыть {id}', { id: record.conversation_id })}><Icon name="chevron"/></button></td>
  </tr>)}</>;
}
export function DialogsView({ rows, completedCount, average, filters }: { rows: DialogRecord[]; completedCount: number; average: number | null; filters: Filters }) {
  const [density, setDensity] = useState(readDensity);
  const grossCount = rows.filter(row => row.gross_error).length;
  const stats = [{ title: 'Всего диалогов', value: rows.length, icon: 'dialogs', tone: '' }, { title: 'С оценкой', value: completedCount, icon: 'circleCheck', tone: 'green' }, { title: 'Средний балл', value: average, icon: 'chart', tone: '' }, { title: 'Грубые ошибки', value: grossCount, icon: 'alert', tone: grossCount ? 'red' : '' }];
  return <>
    <div className="page-heading" data-reveal><div><div className="eyebrow">{t('КАЧЕСТВО КЛИЕНТСКОГО СЕРВИСА')}</div><h1>{t('Диалоги')}</h1><p>{t('Оценки, доказательства и решения — в одном рабочем пространстве.')}</p></div><div className="actions"><button className="btn" data-action="import"><Icon name="download"/>{t('Импорт набора')}</button><button className="btn" data-action="upload"><Icon name="upload"/>{t('Загрузить JSON')}</button></div></div>
    <section className="stats-strip" aria-label={t('Сводка по диалогам')}>{stats.map(stat => <div className="stat" key={stat.title} data-reveal><span className="stat-label">{t(stat.title)}</span><span className="stat-icon"><Icon name={stat.icon}/></span><span className={`stat-value ${stat.tone}`}>{number(stat.value)}</span></div>)}</section>
    <section className="panel dialog-list" data-density={density} data-reveal><div className="panel-heading"><h2>{t('Все разговоры')} <span className="muted small">/ {rows.length}</span></h2><DensitySwitch value={density} onChange={setDensity}/></div>
      <div className="filters"><label className="search-field"><span className="filter-label">{t('Поиск диалога')}</span><span className="search-input"><span aria-hidden="true"><Icon name="search"/></span><input id="search-dialogs" type="search" placeholder={t('Найти по ID или содержимому')} defaultValue={filters.query}/></span></label>
        <label><span className="filter-label">{t('Канал')}</span><select data-filter="channel" defaultValue={filters.channel}><option value="">{t('Все каналы')}</option><option value="agent chat">{t('Чаты')}</option><option value="voice call">{t('Звонки')}</option></select></label>
        <label><span className="filter-label">{t('Язык')}</span><select data-filter="language" defaultValue={filters.language}><option value="">{t('Все языки')}</option><option value="RU">{t('Русский')}</option><option value="KZ">{t('Қазақша')}</option><option value="EN">{t('English')}</option></select></label>
        <label><span className="filter-label">{t('Статус оценки')}</span><select data-filter="status" defaultValue={filters.status}><option value="">{t('Все статусы')}</option><option value="completed">{t('С оценкой')}</option><option value="pending">{t('Без оценки')}</option><option value="gross">{t('Грубая ошибка')}</option></select></label>
      </div><Slot name="active-filters" fallback={<ActiveFilters filters={filters}/>}/>
      <div className="list-toolbar"><Slot name="list-selection" fallback={<SelectionSummary count={0}/>}/><button id="evaluate-selected" className="btn btn-primary" data-action="evaluate-selected" disabled>{t('Оценить выбранные')} <Icon name="arrow-right"/></button></div>
      <div className="table-scroll" role="region" aria-label={t('Список диалогов')} tabIndex={0}><table><thead><tr><th data-select-label={t("\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u0432\u0441\u0435 \u0434\u0438\u0430\u043b\u043e\u0433\u0438")}><input id="select-all" type="checkbox" aria-label={t('Выбрать все видимые диалоги')}/></th><th>{t('Диалог')}</th><th>{t('Канал')}</th><th>{t('Язык')}</th><th>{t('Статус')}</th><th>{t('Балл')}</th><th><span className="sr-only">{t('Открыть')}</span></th></tr></thead><tbody id="dialog-rows"><Slot name="dialog-rows"/></tbody></table></div>
      <div id="list-empty" hidden><Slot name="list-empty"/></div><div className="table-foot"><span id="visible-count"/><span>{t('Оценка по выбранному чек-листу')}</span></div>
    </section>
  </>;
}

export function DialogView({ record, evaluation, checklist, checklists, appeals, demo, busy }: { record: DialogRecord; evaluation: Evaluation | null; checklist?: Checklist; checklists: Checklist[]; appeals: Appeal[]; demo: boolean; busy: boolean }) {
  const roles: Record<string, string> = { operator: t('Оператор'), client: t('Клиент'), bot: t('Бот'), system: t('Система') };
  const transcript = record.transcript || [];
  return <><div className="dialog-workspace">
    <a href="#dialogs" className="back-link"><Icon name="arrow-left"/> {t('Все диалоги')}</a>
    <div className="detail-heading" data-reveal><div><h1>{record.title || t('Карточка диалога')}</h1><div className="detail-meta"><span className="muted small mono">{record.conversation_id}</span><span className="badge">{channel(record.channel)}</span><span className="badge">{record.language}</span><StatusBadge record={{ ...record, evaluation_id: evaluation?.id, total: evaluation?.total }}/></div></div><div className="detail-actions"><PrintButton/><label><span className="sr-only">{t('Чек-лист для оценки')}</span><select id="evaluation-checklist" defaultValue={evaluation?.checklist_id}>{checklists.map(item => <option key={`${item.id}@${item.version}`} value={item.id}>{item.name} · v{item.version}</option>)}</select></label><button className="btn btn-primary" data-action="evaluate-dialog" disabled={busy || !checklists.length}>{t(evaluation ? 'Оценить заново' : 'Оценить диалог')} <Icon name="arrow-right"/></button></div></div>
    {evaluation && <ReviewSummary evaluation={evaluation}/>}
    <div className="split-view detail-top"><section className="panel" data-reveal><div className="panel-heading"><h2>{t('Транскрипт')}</h2><span className="muted small">{t('{count} реплик', { count: transcript.length })}</span></div>
      {record.channel === 'voice call' && <div className="audio-block" id="audio-block"><Slot name="audio-block" fallback={<><button className="btn btn-small" data-action="audio">{t('Загрузить запись')}</button><p className="audio-caption">{t('Запись загружается по свежей ссылке.')}</p></>}/></div>}
      <div className="quiet-line">{t('Оценивается оператор. Бот и система дают контекст.')}</div><div className="transcript" id="transcript">{transcript.map((turn, index) => <article id={`turn-${index}`} className={`turn turn-${Object.hasOwn(roles, turn.speaker) ? turn.speaker : 'system'}`} tabIndex={-1} key={index}><div className="turn-meta"><strong>{roles[turn.speaker] || turn.speaker}</strong><span>№ {index + 1} · {turn.timestamp}</span><span className="turn-evidence-label">{t('Доказательство')}</span></div><p>{turn.text}</p></article>)}</div>
    </section><section className="panel" id="evaluation-panel" data-reveal><EvaluationView evaluation={evaluation} checklist={checklist} appeals={appeals} dialog={record} demo={demo}/></section></div>
  </div><PrintReport record={record} evaluation={evaluation} checklist={checklist} appeals={appeals} demo={demo}/></>;
}
export function LoadingView() { return <div className="panel loading" aria-label={t('Загрузка')} aria-busy="true"><div className="skeleton wide"/><div className="skeleton"/><div className="skeleton"/><div className="skeleton wide"/></div>; }
export function ErrorView({ message }: { message: string }) { return <><div className="page-heading" data-reveal><div><h1>{t('Нет подключения к данным')}</h1><p>{t('Интерфейс работает, но сервер пока не ответил.')}</p></div></div><section className="panel" data-reveal><EmptyState title={t('Не удалось получить данные')} text={message} actions={<><button className="btn btn-primary" data-action="retry">{t('Повторить')}</button><button className="btn" data-action="settings">{t('Настроить API')}</button><button className="btn btn-ghost" data-action="demo">{t('Открыть учебный пример')}</button></>}/></section></>; }

export type ModalProps = { kind: 'appeal'; criterionId: string; title: string } | { kind: 'settings'; demo: boolean; baseUrl: string } | { kind: 'import'; demo: boolean } | { kind: 'evaluate'; count: number; selectedChecklist?: string; checklists: Checklist[]; demo: boolean };
export function ModalContents({ data }: { data: ModalProps }) {
  let content: ReactNode;
  if (data.kind === 'appeal') content = <><p className="modal-description">{data.title}. {t('Проверяющий увидит комментарий вместе с оценкой и фрагментом диалога.')}</p><form id="appeal-form" data-criterion-id={data.criterionId} className="form-stack"><label>{t('Почему вы не согласны')}<textarea name="comment" required maxLength={4000} placeholder={t('Укажите, какой фрагмент стоит проверить')} rows={4}/></label><div className="form-actions"><Cancel/><button type="submit" className="btn btn-primary">{t('Подать апелляцию')}</button></div></form></>;
  else if (data.kind === 'settings') content = <><p className="modal-description">{t('Укажите адрес сервера вашей команды. Ключи AI и ссылка организаторов остаются на сервере.')}</p><form id="settings-form" className="form-stack"><fieldset><legend>{t('Источник данных')}</legend><div className="form-stack"><label><input type="radio" name="mode" value="api" defaultChecked={!data.demo}/> {t('Сервер команды')}</label><label><input type="radio" name="mode" value="demo" defaultChecked={data.demo}/> {t('Учебный пример без AI')}</label></div></fieldset><label>{t('Базовый адрес API')}<input name="baseUrl" defaultValue={data.baseUrl} placeholder="http://127.0.0.1:8000/api"/></label><p className="muted small">{t('Для сервера на том же адресе используйте /api. Учебные изменения сохраняются только в этом браузере.')}</p><div className="form-actions"><Cancel/><button className="btn btn-primary" type="submit">{t('Подключиться')}</button></div></form></>;
  else if (data.kind === 'import') content = <><p className="modal-description">{t('Сервер получит диалоги по group_id. Для контрольного набора введите значение от организаторов.')}</p><form id="import-form" className="form-stack"><label>{t('Группа набора')}<input name="groupId" required maxLength={100} defaultValue="DEV" autoComplete="off"/></label>{data.demo && <div className="notice">{t('Учебный режим не загружает набор организаторов. Для импорта подключите сервер команды.')}</div>}<div className="form-actions"><Cancel/><button className="btn btn-primary" type="submit">{t(data.demo ? 'Проверить учебный запрос' : 'Импортировать набор')}</button></div></form></>;
  else content = <><p className="modal-description">{t('Диалогов: {count}. Оценка пройдёт в фоне, прогресс появится над рабочим экраном.', { count: data.count })}</p><form id="evaluate-form" className="form-stack"><label>{t('Чек-лист')}<select name="checklistId" defaultValue={data.selectedChecklist}>{data.checklists.map(item => <option key={`${item.id}@${item.version}`} value={item.id}>{item.name} · v{item.version}</option>)}</select></label><label><input name="confirm" type="checkbox" required/>{t(data.demo ? 'Понимаю, что это учебная оценка без AI' : 'Подтверждаю запуск AI-оценки. Если сервер использует платный API, возможны расходы')}</label><div className="form-actions"><Cancel/><button type="submit" className="btn btn-primary">{t(data.count === 1 ? 'Оценить диалог' : 'Оценить диалоги')}</button></div></form></>;
  return content;
}
function Cancel() { return <button type="button" className="btn" data-action="close-modal">{t('Отмена')}</button>; }
