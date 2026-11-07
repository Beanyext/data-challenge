import type { ReactNode } from 'react';
import type { Appeal, Checklist, DialogRecord, Evaluation, Filters } from './types';
import { Icon, EmptyState, channel, label, number } from './shared';
import { Slot } from './slots';
import { EvaluationView } from './result';

export function StatusBadge({ record }: { record: DialogRecord }) {
  const status = record.status || (record.evaluation_id ? 'completed' : 'pending');
  return <span className={`badge ${['completed', 'done', 'evaluated'].includes(status) ? 'badge-green' : status === 'failed' ? 'badge-red' : ''}`}><span className="mini-dot" aria-hidden="true"/>{label(status)}</span>;
}
export function DialogRows({ rows, selected }: { rows: DialogRecord[]; selected: Set<string> }) {
  return <>{rows.map(record => <tr key={`${record.conversation_id}:${selected.has(record.conversation_id)}`} className={selected.has(record.conversation_id) ? 'selected' : ''}>
    <td><input type="checkbox" data-select={record.conversation_id} aria-label={`Выбрать ${record.conversation_id}`} defaultChecked={selected.has(record.conversation_id)}/></td>
    <td><button className="dialog-title" data-open={record.conversation_id}>{record.title || record.subject || record.transcript?.find(turn => turn.speaker === 'client')?.text || 'Диалог поддержки'}</button><span className="dialog-subtitle">{record.conversation_id}</span></td>
    <td><span className="channel-icon" aria-hidden="true"><Icon name={record.channel === 'voice call' ? 'phone' : 'dialogs'}/></span>{channel(record.channel)}</td>
    <td><span className="badge">{record.language}</span></td><td><StatusBadge record={record}/>{' '}{record.gross_error && <span className="badge badge-red" title="Грубая ошибка">!</span>}</td>
    <td className="score-cell">{number(record.total)} {typeof record.total === 'number' && <span>/ 100</span>}</td>
    <td><button className="icon-btn" data-open={record.conversation_id} aria-label={`Открыть ${record.conversation_id}`}><Icon name="chevron"/></button></td>
  </tr>)}</>;
}
export function DialogsView({ rows, completedCount, average, filters }: { rows: DialogRecord[]; completedCount: number; average: number | null; filters: Filters }) {
  const grossCount = rows.filter(row => row.gross_error).length;
  const stats = [{ title: 'Всего диалогов', value: rows.length, icon: 'dialogs', tone: '' }, { title: 'С оценкой', value: completedCount, icon: 'circleCheck', tone: 'green' }, { title: 'Средний балл', value: average, icon: 'chart', tone: '' }, { title: 'Грубые ошибки', value: grossCount, icon: 'alert', tone: grossCount ? 'red' : '' }];
  return <>
    <div className="page-heading" data-reveal><div><div className="eyebrow">КАЧЕСТВО КЛИЕНТСКОГО СЕРВИСА</div><h1>Диалоги</h1><p>Оценки, доказательства и решения — в одном рабочем пространстве.</p></div><div className="actions"><button className="btn" data-action="import"><Icon name="download"/>Импорт набора</button><button className="btn" data-action="upload"><Icon name="upload"/>Загрузить JSON</button></div></div>
    <section className="stats-strip" aria-label="Сводка по диалогам">{stats.map(stat => <div className="stat" key={stat.title} data-reveal><span className="stat-label">{stat.title}</span><span className="stat-icon"><Icon name={stat.icon}/></span><span className={`stat-value ${stat.tone}`}>{number(stat.value)}</span></div>)}</section>
    <section className="panel" data-reveal><div className="panel-heading"><h2>Все разговоры <span className="muted small">/ {rows.length}</span></h2><button id="evaluate-selected" className="btn btn-primary" data-action="evaluate-selected" disabled>Оценить выбранные <Icon name="arrow-right"/></button></div>
      <div className="filters"><label className="search-field"><span aria-hidden="true"><Icon name="search"/></span><span className="sr-only">Поиск диалога</span><input id="search-dialogs" type="search" placeholder="Найти по ID или содержимому" defaultValue={filters.query}/></label>
        <label><span className="sr-only">Канал</span><select data-filter="channel" defaultValue={filters.channel}><option value="">Все каналы</option><option value="agent chat">Чаты</option><option value="voice call">Звонки</option></select></label>
        <label><span className="sr-only">Язык</span><select data-filter="language" defaultValue={filters.language}><option value="">Все языки</option><option value="RU">Русский</option><option value="KZ">Қазақша</option><option value="EN">English</option></select></label>
        <label><span className="sr-only">Статус оценки</span><select data-filter="status" defaultValue={filters.status}><option value="">Все статусы</option><option value="completed">С оценкой</option><option value="pending">Без оценки</option><option value="gross">Грубая ошибка</option></select></label>
      </div><div className="table-scroll"><table><thead><tr><th><input id="select-all" type="checkbox" aria-label="Выбрать все видимые диалоги"/></th><th>Диалог</th><th>Канал</th><th>Язык</th><th>Статус</th><th>Балл</th><th><span className="sr-only">Открыть</span></th></tr></thead><tbody id="dialog-rows"><Slot name="dialog-rows"/></tbody></table></div>
      <div id="list-empty" hidden><Slot name="list-empty"/></div><div className="table-foot"><span id="visible-count"/><span>Оценка по выбранному чек-листу</span></div>
    </section>
  </>;
}

export function DialogView({ record, evaluation, checklist, checklists, appeals, demo, busy }: { record: DialogRecord; evaluation: Evaluation | null; checklist?: Checklist; checklists: Checklist[]; appeals: Appeal[]; demo: boolean; busy: boolean }) {
  const roles: Record<string, string> = { operator: 'Оператор', client: 'Клиент', bot: 'Бот', system: 'Система' };
  const transcript = record.transcript || [];
  return <>
    <a href="#dialogs" className="back-link"><Icon name="arrow-left"/> Все диалоги</a>
    <div className="detail-heading" data-reveal><div><h1>{record.title || 'Карточка диалога'}</h1><div className="detail-meta"><span className="muted small mono">{record.conversation_id}</span><span className="badge">{channel(record.channel)}</span><span className="badge">{record.language}</span><StatusBadge record={{ ...record, evaluation_id: evaluation?.id, total: evaluation?.total }}/></div></div><div className="detail-actions"><label><span className="sr-only">Чек-лист для оценки</span><select id="evaluation-checklist" defaultValue={evaluation?.checklist_id}>{checklists.map(item => <option key={`${item.id}@${item.version}`} value={item.id}>{item.name} · v{item.version}</option>)}</select></label><button className="btn btn-primary" data-action="evaluate-dialog" disabled={busy || !checklists.length}>{evaluation ? 'Оценить заново' : 'Оценить диалог'} <Icon name="arrow-right"/></button></div></div>
    <div className="split-view detail-top"><section className="panel" data-reveal><div className="panel-heading"><h2>Транскрипт</h2><span className="muted small">{transcript.length} реплик</span></div>
      {record.channel === 'voice call' && <div className="audio-block" id="audio-block"><Slot name="audio-block" fallback={<><button className="btn btn-small" data-action="audio">Загрузить запись</button><p className="audio-caption">Запись загружается по свежей ссылке.</p></>}/></div>}
      <div className="quiet-line">Оценивается оператор. Бот и система дают контекст.</div><div className="transcript" id="transcript">{transcript.map((turn, index) => <article id={`turn-${index}`} className={`turn turn-${Object.hasOwn(roles, turn.speaker) ? turn.speaker : 'system'}`} tabIndex={-1} key={index}><div className="turn-meta"><strong>{roles[turn.speaker] || turn.speaker}</strong><span>№ {index + 1} · {turn.timestamp}</span></div><p>{turn.text}</p></article>)}</div>
    </section><section className="panel" id="evaluation-panel" data-reveal><EvaluationView evaluation={evaluation} checklist={checklist} appeals={appeals} dialog={record} demo={demo}/></section></div>
  </>;
}
export function LoadingView() { return <div className="panel loading" aria-label="Загрузка" aria-busy="true"><div className="skeleton wide"/><div className="skeleton"/><div className="skeleton"/><div className="skeleton wide"/></div>; }
export function ErrorView({ message }: { message: string }) { return <><div className="page-heading" data-reveal><div><h1>Нет подключения к данным</h1><p>Интерфейс работает, но сервер пока не ответил.</p></div></div><section className="panel" data-reveal><EmptyState title="Не удалось получить данные" text={message} actions={<><button className="btn btn-primary" data-action="retry">Повторить</button><button className="btn" data-action="settings">Настроить API</button><button className="btn btn-ghost" data-action="demo">Открыть учебный пример</button></>}/></section></>; }

export type ModalProps = { kind: 'appeal'; criterionId: string; title: string } | { kind: 'settings'; demo: boolean; baseUrl: string } | { kind: 'import'; demo: boolean } | { kind: 'evaluate'; count: number; selectedChecklist?: string; checklists: Checklist[]; demo: boolean };
export function ModalContents({ data }: { data: ModalProps }) {
  let content: ReactNode;
  if (data.kind === 'appeal') content = <><p className="modal-description">{data.title}. Проверяющий увидит комментарий вместе с оценкой и фрагментом диалога.</p><form id="appeal-form" data-criterion-id={data.criterionId} className="form-stack"><label>Почему вы не согласны<textarea name="comment" required maxLength={4000} placeholder="Укажите, какой фрагмент стоит проверить" rows={4}/></label><div className="form-actions"><Cancel/><button type="submit" className="btn btn-primary">Подать апелляцию</button></div></form></>;
  else if (data.kind === 'settings') content = <><p className="modal-description">Укажите адрес сервера вашей команды. Ключи AI и ссылка организаторов остаются на сервере.</p><form id="settings-form" className="form-stack"><fieldset><legend>Источник данных</legend><div className="form-stack"><label><input type="radio" name="mode" value="api" defaultChecked={!data.demo}/> Сервер команды</label><label><input type="radio" name="mode" value="demo" defaultChecked={data.demo}/> Учебный пример без AI</label></div></fieldset><label>Базовый адрес API<input name="baseUrl" defaultValue={data.baseUrl} placeholder="http://127.0.0.1:8000/api"/></label><p className="muted small">Для сервера на том же адресе используйте /api. Учебные изменения сохраняются только в этом браузере.</p><div className="form-actions"><Cancel/><button className="btn btn-primary" type="submit">Подключиться</button></div></form></>;
  else if (data.kind === 'import') content = <><p className="modal-description">Сервер получит диалоги по group_id. Для контрольного набора введите значение от организаторов.</p><form id="import-form" className="form-stack"><label>Группа набора<input name="groupId" required maxLength={100} defaultValue="DEV" autoComplete="off"/></label>{data.demo && <div className="notice">Учебный режим не загружает набор организаторов. Для импорта подключите сервер команды.</div>}<div className="form-actions"><Cancel/><button className="btn btn-primary" type="submit">{data.demo ? 'Проверить учебный запрос' : 'Импортировать набор'}</button></div></form></>;
  else content = <><p className="modal-description">Диалогов: {data.count}. Оценка пройдёт в фоне, прогресс появится над рабочим экраном.</p><form id="evaluate-form" className="form-stack"><label>Чек-лист<select name="checklistId" defaultValue={data.selectedChecklist}>{data.checklists.map(item => <option key={`${item.id}@${item.version}`} value={item.id}>{item.name} · v{item.version}</option>)}</select></label><label><input name="confirm" type="checkbox" required/>{data.demo ? 'Понимаю, что это учебная оценка без AI' : 'Подтверждаю запуск AI-оценки. Если сервер использует платный API, возможны расходы'}</label><div className="form-actions"><Cancel/><button type="submit" className="btn btn-primary">Оценить {data.count === 1 ? 'диалог' : 'диалоги'}</button></div></form></>;
  return content;
}
function Cancel() { return <button type="button" className="btn" data-action="close-modal">Отмена</button>; }
